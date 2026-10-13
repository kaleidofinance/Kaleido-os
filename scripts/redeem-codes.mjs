// Create and list $kPoint redeem codes (redeemed on /rewards).
//
//   node scripts/redeem-codes.mjs create <points> [--count N] [--uses N] [--days N] [--prefix KLD] [--note "..."]
//     e.g. create 500 --count 20            → 20 single-use codes worth 500 each
//          create 1000 --uses 100 --days 7  → one code, 100 wallets, expires in 7 days
//   node scripts/redeem-codes.mjs list
//   node scripts/redeem-codes.mjs disable <CODE>
//
// Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }),
);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
const api = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/redeem_codes`;
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };
const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const group = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join("");

if (cmd === "create") {
  const points = Number(rest[0]);
  if (!(points > 0)) { console.error("points required"); process.exit(1); }
  const count = Number(opt("count", 1)), uses = Number(opt("uses", 1)), days = opt("days");
  const prefix = String(opt("prefix", "KLD")).toUpperCase();
  const rows = Array.from({ length: count }, () => ({
    code: `${prefix}-${group()}-${group()}-${group()}`,
    points, max_uses: uses, note: opt("note", null),
    expires_at: days ? new Date(Date.now() + Number(days) * 86400000).toISOString() : null,
  }));
  const r = await fetch(api, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(rows) });
  const out = await r.json();
  if (!r.ok) { console.error(r.status, out); process.exit(1); }
  for (const c of out) console.log(c.code, `${c.points} pts`, `${c.max_uses} use(s)`, c.expires_at ? `until ${c.expires_at.slice(0, 10)}` : "");
} else if (cmd === "list") {
  const r = await fetch(`${api}?select=code,points,uses,max_uses,expires_at,active,note&order=created_at.desc&limit=100`, { headers: H });
  console.table(await r.json());
} else if (cmd === "disable" && rest[0]) {
  const r = await fetch(`${api}?code=eq.${encodeURIComponent(rest[0].toUpperCase())}`, { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ active: false }) });
  console.log(r.status, await r.text());
} else {
  console.log("Usage: create <points> [--count N] [--uses N] [--days N] [--prefix X] [--note ..] | list | disable <CODE>");
}
