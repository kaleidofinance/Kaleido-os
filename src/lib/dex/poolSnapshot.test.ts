import { shouldAcceptPoolSnapshot } from "./poolSnapshot";

const row = (i: number) => ({ chainId: 1, address: `0x${String(i).padStart(40, "0")}` }) as never;
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));

const cases: Array<[string, boolean]> = [
  ["accepts the first non-empty snapshot", shouldAcceptPoolSnapshot(null, rows(1))],
  ["rejects an empty replacement", !shouldAcceptPoolSnapshot(rows(4), [])],
  ["rejects a mostly missing replacement", !shouldAcceptPoolSnapshot(rows(10), rows(3))],
  ["accepts a normal refresh", shouldAcceptPoolSnapshot(rows(10), rows(8))],
];

let failed = 0;
for (const [name, ok] of cases) {
  if (!ok) {
    failed += 1;
    console.error(`not ok - ${name}`);
  } else console.log(`ok - ${name}`);
}
if (failed) process.exit(1);
console.log(`${cases.length} passed, 0 failed`);
