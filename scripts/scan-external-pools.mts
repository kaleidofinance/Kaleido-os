import { buildExternalPoolRefreshReport } from "../src/lib/market/externalPoolReport";
import { EXTERNAL_POOL_SCAN_PAIRS } from "../src/lib/market/externalPoolScanPairs";
import { chainTokenByAddress } from "../src/constants/tokens";

const report = await buildExternalPoolRefreshReport(EXTERNAL_POOL_SCAN_PAIRS, {
  clientId: process.env.KYBER_CLIENT_ID,
  isKnownToken: (chainId, address) => Boolean(chainTokenByAddress(chainId, address)),
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.routeObservations === 0) process.exitCode = 2;
