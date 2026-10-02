import { fromServer, mergeActivity, isTxHash, type ActivityItem } from "./activity";

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
