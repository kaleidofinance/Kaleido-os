import { resolveQuotaIdentity } from "./quotaIdentity";

async function main() {
  const anonymous = await resolveQuotaIdentity({});
  if (anonymous.authenticated || anonymous.address) throw new Error("anonymous identity should remain anonymous");
  const invalid = await resolveQuotaIdentity({ address: "0x0000000000000000000000000000000000000001", signature: "x", signedAt: Date.now() - 99999999 });
  if (!invalid.error) throw new Error("stale signed sessions must be rejected");
  console.log("Quota identity checks passed.");
}

void main();
