// Post a product-update announcement to every Kaleido visitor's notification
// panel (and as a browser notification where allowed).
//
//   node scripts/announce.mjs "Daily check-in is live" "Earn +25 kPoint every day…" [https://kaleidofi.xyz/rewards]
//   node scripts/announce.mjs --list
//   node scripts/announce.mjs --hide <id>
//
// Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env. Each
// browser is told about an announcement once; hiding one stops new browsers
// from seeing it but can't recall it from those already notified.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env");
  process.exit(1);
}
const H = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };
const api = `${url}/rest/v1/announcements`;
const [a, b, c] = process.argv.slice(2);

if (a === "--list") {
  const r = await fetch(`${api}?select=id,title,published_at,active&order=id.desc&limit=20`, { headers: H });
  console.table(await r.json());
} else if (a === "--hide" && b) {
  const r = await fetch(`${api}?id=eq.${Number(b)}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ active: false }),
  });
  console.log(r.status, await r.text());
} else if (a && b) {
  const r = await fetch(api, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify({ title: a, body: b, url: c ?? null }),
  });
  const out = await r.json();
  if (!r.ok) {
    console.error(r.status, out);
    process.exit(1);
  }
  console.log(`Posted #${out[0].id}: "${out[0].title}" — visitors see it within ~5 minutes.`);
} else {
  console.log('Usage: node scripts/announce.mjs "Title" "Body" [url] | --list | --hide <id>');
}
