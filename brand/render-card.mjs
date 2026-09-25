// Render a Kaleido announcement card to a PNG from a small JSON data file.
//
//   node brand/render-card.mjs <data.json> [out.png] [WxH] [scale]
//
//   node brand/render-card.mjs my-card.json
//     -> brand/out/my-card.png  at 1200x630 @2x (2400x1260) — X / OG card size
//   node brand/render-card.mjs my-card.json card.png 1080x1080 2
//     -> a 2160x2160 square
//
// The data file is the ONLY thing you edit — see brand/README.md for the schema.
// This injects it into brand/announcement-card.html (unchanged) and screenshots
// with headless Chrome, exactly like brand/render.mjs. Fonts + assets are pulled
// from ../src and ../public, so run it from the repo root.

import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join, basename } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("No Chrome/Edge found. Edit CHROME_CANDIDATES in render-card.mjs.");
  process.exit(1);
}

const dataArg = process.argv[2];
if (!dataArg) {
  console.error("Usage: node brand/render-card.mjs <data.json> [out.png] [WxH] [scale]");
  process.exit(1);
}
const dataPath = resolve(dataArg);
if (!existsSync(dataPath)) {
  console.error(`Data file not found: ${dataPath}`);
  process.exit(1);
}

// Validate the JSON early so the failure is "your JSON is wrong", not a blank card.
let data;
try {
  data = JSON.parse(readFileSync(dataPath, "utf8"));
} catch (e) {
  console.error(`Could not parse ${dataArg} as JSON: ${e.message}`);
  process.exit(1);
}

const [w = 1200, h = 630] = (process.argv[4] || "1200x630").split("x").map(Number);
const scale = Number(process.argv[5] || 2);
const outDir = resolve(here, "out");
mkdirSync(outDir, { recursive: true });
const out = process.argv[3]
  ? resolve(process.argv[3])
  : join(outDir, `${basename(dataArg).replace(/\.json$/i, "")}.png`);

// Inject the data into the template (a copy — the template file is never edited).
const template = readFileSync(resolve(here, "announcement-card.html"), "utf8");
const marker = "/*__CARD__*/ {";
if (!template.includes(marker)) {
  console.error("Template marker not found — did announcement-card.html change?");
  process.exit(1);
}
const injected = template.replace(
  /window\.__CARD__ = window\.__CARD__ \|\| \/\*__CARD__\*\/ \{[\s\S]*?\};/,
  `window.__CARD__ = ${JSON.stringify(data)};`,
);
const tmp = join(here, `.card-${Date.now()}.html`);
writeFileSync(tmp, injected, "utf8");

const url = pathToFileURL(tmp).href;
const profile = resolve(here, ".render-cache");
const args = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  `--force-device-scale-factor=${scale}`,
  `--window-size=${w},${h}`,
  "--default-background-color=0a1512ff",
  "--allow-file-access-from-files",
  "--no-first-run",
  "--no-default-browser-check",
  "--virtual-time-budget=7000",
  `--user-data-dir=${profile}`,
  `--screenshot=${out}`,
  url,
];

console.log(`Rendering ${basename(dataArg)} @ ${scale}x  (${w * scale}×${h * scale})`);
const r = spawnSync(chrome, args, { stdio: "inherit", timeout: 60_000 });
try { rmSync(tmp); } catch {}

if (r.status === 0 && existsSync(out)) {
  const kb = (statSync(out).size / 1024).toFixed(0);
  console.log(`OK  ${out}  (${kb} KB)`);
} else {
  console.error(`FAILED  status=${r.status} signal=${r.signal ?? ""}`);
  process.exit(1);
}
