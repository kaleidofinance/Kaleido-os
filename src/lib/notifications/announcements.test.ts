/** Run: npx tsx src/lib/notifications/announcements.test.ts */
import { unseenAnnouncements, FIRST_VISIT_MAX, type Announcement } from "./announcements";
import { categorise } from "./taxonomy";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, d = "") => {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${d ? " — " + d : ""}`); }
};

const NOW = Date.parse("2026-10-03T12:00:00Z");
const day = 86_400_000;
const a = (id: number, ageDays: number): Announcement => ({
  id, title: `t${id}`, body: "b", url: null,
  publishedAt: new Date(NOW - ageDays * day).toISOString(),
});

{
  const r = unseenAnnouncements([a(5, 1), a(4, 2), a(3, 30)], 3, NOW);
  check("known browser gets everything newer than its marker", r.show.map((x) => x.id).join() === "4,5");
  check("marker advances to the newest id", r.nextSeen === 5);
}
{
  const r = unseenAnnouncements([a(5, 1), a(4, 2)], 5, NOW);
  check("nothing new → nothing shown", r.show.length === 0 && r.nextSeen === 5);
}
{
  const r = unseenAnnouncements([a(9, 1), a(8, 2), a(7, 3), a(6, 4), a(2, 40)], null, NOW);
  check(`first visit shows at most ${FIRST_VISIT_MAX}, oldest first`, r.show.map((x) => x.id).join() === "7,8,9");
  check("first visit skips anything older than a week", !r.show.some((x) => x.id === 2));
  check("first visit marks everything seen", r.nextSeen === 9);
}
{
  const r = unseenAnnouncements([a(1, 60)], null, NOW);
  check("first visit with only old news shows nothing but sets the marker", r.show.length === 0 && r.nextSeen === 1);
}
{
  const r = unseenAnnouncements([], null, NOW);
  check("no announcements, no marker written", r.show.length === 0 && r.nextSeen === null);
}
check("product updates file under System", categorise("product_update") === "system");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
