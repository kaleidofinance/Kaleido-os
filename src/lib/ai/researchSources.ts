import { isIP } from "node:net";

const MAX_SOURCES = 3;
const MAX_URL_LENGTH = 2_048;
const MAX_BODY_BYTES = 120_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_REDIRECTS = 3;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  )
    return true;

  if (isIP(host) !== 4) return false;
  const octets = host.split(".").map(Number);
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export function validateResearchUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname || isPrivateHost(url.hostname)) {
      return null;
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function readLimitedBody(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new Error("response exceeds the research size limit");
  if (!response.body) return (await response.text()).slice(0, MAX_TEXT_CHARS);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BODY_BYTES) throw new Error("response exceeds the research size limit");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes).slice(0, MAX_TEXT_CHARS);
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (match?.[1] ? visibleText(match[1]) : fallback).slice(0, 160) || fallback;
}

async function fetchPublic(url: string): Promise<{ url: string; title: string; text: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "text/html, text/plain, application/json;q=0.8" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = validateResearchUrl(location ? new URL(location, current).toString() : null);
      if (!next || hop === MAX_REDIRECTS) throw new Error("unsafe or excessive redirect");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`source returned HTTP ${response.status}`);
    const html = await readLimitedBody(response);
    return { url: current, title: pageTitle(html, new URL(current).hostname), text: visibleText(html) };
  }
  throw new Error("unsafe or excessive redirect");
}

export interface ResearchSourceResult {
  sources: Array<{ url: string; title: string; text: string; observedAt: string }>;
  failed: Array<{ url: string; reason: string }>;
}

export async function researchSources(rawUrls: unknown): Promise<ResearchSourceResult> {
  const urls = Array.isArray(rawUrls)
    ? Array.from(new Set(rawUrls.map(validateResearchUrl).filter((url): url is string => Boolean(url)))).slice(0, MAX_SOURCES)
    : [];
  const failed: ResearchSourceResult["failed"] = [];
  if (urls.length === 0) return { sources: [], failed: [{ url: "", reason: "Provide one to three public HTTPS URLs." }] };
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const source = await fetchPublic(url);
        return { ok: true as const, source };
      } catch (error) {
        return { ok: false as const, url, reason: error instanceof Error ? error.message : "source fetch failed" };
      }
    }),
  );
  const sources = results.filter((result): result is { ok: true; source: Awaited<ReturnType<typeof fetchPublic>> } => result.ok).map(({ source }) => ({ ...source, observedAt: new Date().toISOString() }));
  failed.push(...results.filter((result): result is { ok: false; url: string; reason: string } => !result.ok).map(({ url, reason }) => ({ url, reason })));
  return { sources, failed };
}
