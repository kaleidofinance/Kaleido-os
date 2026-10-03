import { fromServer, mergeActivity, isTxHash, groupByDay, tidyTitle, type ActivityItem } from "./activity";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
};

const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");

const server = fromServer([
  { kind: "swap", chainId: 5042, txHash: H(1).toUpperCase().replace("0X", "0x"), at: "2026-10-01T10:00:00Z" },
  { kind: "swap", chainId: 5042, txHash: H(2), at: "2026-10-02T10:00:00Z" },
  { kind: "checkin", chainId: null, txHash: "checkin:0xabc:2026-10-02", at: "2026-10-02T08:00:00Z" },
  { kind: "swap", chainId: 5042, txHash: H(3), at: "not a date" },
]);
check("drops rows with a bad timestamp", server.length === 3);
check("synthetic check-in hash becomes null", server.find((s) => s.title === "Daily check-in")?.hash === null);
check("hashes are lowercased", server.every((s) => !s.hash || s.hash === s.hash.toLowerCase()));
check("known kinds get a title", server[0].title === "Swap on Kaleido");

const device: ActivityItem[] = [
  { id: "d1", title: "Swap 10 USDC → EURC", chainId: 5042, hash: H(2), at: Date.parse("2026-10-02T10:00:01Z"), status: "confirmed", source: "device" },
  { id: "d2", title: "Lend 50 USDC", chainId: 5042, hash: H(9), at: Date.parse("2026-09-30T10:00:00Z"), status: "reverted", source: "device" },
];
const merged = mergeActivity(server, device);
check("dedupes a hash seen on both sides", merged.filter((m) => m.hash === H(2)).length === 1);
check("device entry wins the dedupe", merged.find((m) => m.hash === H(2))?.title === "Swap 10 USDC → EURC");
check("keeps everything else", merged.length === 4);
check("newest first", merged[0].hash === H(2) && merged[merged.length - 1].hash === H(9));
check("limit applies", mergeActivity(server, device, 2).length === 2);
check("isTxHash rejects synthetic ids", !isTxHash("checkin:0xabc") && isTxHash(H(5)));

// grouping by day
{
  const now = new Date(2026, 9, 3, 15, 0).getTime();
  const mk = (id: string, at: number): ActivityItem => ({ id, title: id, chainId: 5042, hash: null, at, status: "confirmed", source: "server" });
  const g = groupByDay(
    [mk("a", now - 60_000), mk("b", now - 3_600_000), mk("c", now - 86_400_000), mk("d", new Date(2026, 8, 26).getTime())],
    now,
  );
  check("groups into Today / Yesterday / a date", g.map((x) => x.label).join("|") === "Today|Yesterday|Sat, Sep 26");
  check("today holds both of today's items, in order", g[0].items.map((x) => x.id).join("") === "ab");
  check("a past year shows the year", groupByDay([mk("e", new Date(2025, 0, 2).getTime())], now)[0].label.includes("2025"));
}
check("tidyTitle trims a long raw amount", tidyTitle("Swap 2.362785936882168666 LIFT for COOL") === "Swap 2.36279 LIFT for COOL");
check("tidyTitle keeps short amounts", tidyTitle("Swap 0.00246701 cirBTC for USDC") === "Swap 0.00246701 cirBTC for USDC" || tidyTitle("Swap 0.00246701 cirBTC for USDC") === "Swap 0.00246701 cirBTC for USDC");
check("tidyTitle keeps whole numbers", tidyTitle("Lend 1000 USDC") === "Lend 1000 USDC");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
