/**
 * Kaleido AgentRouter relay — a Cloudflare Worker that moves our egress.
 *
 * WHY THIS EXISTS
 *
 * `agentrouter.org` rejects Vercel's egress specifically. A request from a
 * Vercel function gets the gateway's SPA — `<!doctype …` at **HTTP 200**, so
 * `res.ok` passes and the JSON parse is what fails — while the byte-identical
 * request, same key, same user-agent, same model, answers with JSON from a
 * developer machine. Measured 2026-09-01: production Luca failed in ~3s with
 * `[chat] provider failed: SyntaxError: Unexpected token '<'` while both the
 * production and local keys returned 200 from a laptop. It is not the key, the
 * model, or a regression in our code.
 *
 * Cloudflare's egress *is* accepted (first confirmed 2026-08-31 for the sibling
 * kincad project, which runs this same relay). So this Worker is a free,
 * always-on bridge that needs no machine at home. If the gateway ever tightens
 * its checks this can change: hit `/healthz`, then POST a real completion and
 * confirm you get JSON and not `<!doctype`.
 *
 * It holds no key. The app forwards `Authorization`/`x-api-key` and
 * AgentRouter's own key gate still applies — the relay changes where the
 * request comes from and nothing else.
 *
 * HOW KALEIDO POINTS AT IT (the path shape matters, and differs per provider)
 *
 * `ClaudeProvider` fetches `${baseUrl}/v1/messages` and `OpenAIProvider` fetches
 * `${baseUrl}/chat/completions`, so the two env vars carry different suffixes.
 * With a prefix set, in Vercel:
 *
 *   AGENTROUTER_BASE_URL        = https://<host>/<prefix>
 *   AGENTROUTER_OPENAI_BASE_URL = https://<host>/<prefix>/v1
 *
 * Do NOT put `/v1` on the first one — the Claude provider adds it, and
 * `/v1/v1/messages` is a 404 the gateway will answer with HTML, which is the
 * very symptom this relay exists to remove.
 *
 * WORKER VARIABLES (Settings → Variables, or `wrangler secret put`)
 *
 *   RELAY_PATH_PREFIX  a shared secret: requests must sit under `/<prefix>/`,
 *                      which is stripped before forwarding, so the Worker URL is
 *                      not an open proxy onto someone else's paid gateway.
 *   RELAY_USER_AGENT   force this user-agent on every forwarded call. Optional
 *                      for us — Kaleido already sends the one AgentRouter
 *                      authorises. Not hardcoded, so this Worker ships no
 *                      impersonation nobody chose.
 */

const UPSTREAM = "https://agentrouter.org";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/healthz")
    ) {
      return new Response("kaleido agentrouter relay: ok\n", {
        headers: { "content-type": "text/plain" },
      });
    }

    let path = url.pathname;
    const prefix = env.RELAY_PATH_PREFIX
      ? "/" + env.RELAY_PATH_PREFIX.replace(/^\/+|\/+$/g, "")
      : "";
    if (prefix) {
      if (url.pathname !== prefix && !url.pathname.startsWith(prefix + "/")) {
        return new Response("not found\n", { status: 404 });
      }
      path = url.pathname.slice(prefix.length) || "/";
    }

    /* Copy the incoming headers, then drop the ones that must not ride along:
       the Worker's own host, stale length/encoding (fetch recomputes both), and
       every Cloudflare or forwarding header that would announce this as proxied
       datacenter traffic — which is the thing being worked around. */
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) {
      const k = key.toLowerCase();
      if (
        k === "host" ||
        k === "content-length" ||
        k === "accept-encoding" ||
        k === "x-real-ip" ||
        k.startsWith("cf-") ||
        k.startsWith("x-forwarded")
      ) {
        headers.delete(key);
      }
    }
    if (env.RELAY_USER_AGENT) headers.set("user-agent", env.RELAY_USER_AGENT);

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + path + url.search, {
        method: request.method,
        headers,
        body,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: `relay failed: ${err && err.message ? err.message : String(err)}`,
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }

    /* Streamed turns must stay streamed: `chatStream` decides whether to read
       SSE by looking for `event-stream` in the content-type, so buffering here
       would silently demote every streamed answer to a buffered one. Pass the
       body straight through and preserve the upstream content-type. */
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") || "application/json",
        ...(upstream.headers.get("cache-control")
          ? { "cache-control": upstream.headers.get("cache-control") }
          : {}),
      },
    });
  },
};
