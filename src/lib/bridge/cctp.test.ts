// Checks on the CCTP V2 burn-leg resolver. Run with tsx.
//
// Everything here is pure — no network — so the whole surface the planner and
// the auditor depend on is exercised directly: the verified domain/address
// constants, the corridor and target guards, the kill-switch, and that
// buildCctpBurnRoute encodes a depositForBurn whose arguments match a Standard
// Transfer (maxFee 0, finalized threshold, permissionless destination caller,
// the recipient left-padded to bytes32).
import { ethers } from "ethers";
import {
  TOKEN_MESSENGER_V2,
  MESSAGE_TRANSMITTER_V2,
  CCTP_DOMAINS,
  CCTP_USDC,
  CCTP_ENABLED,
  isCctpDomainChain,
  isCctpCorridor,
  isKnownCctpTarget,
  buildCctpBurnRoute,
} from "./cctp.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const ARC = 5042;
const BASE = 8453;
const ETH = 1;
const BNB = 56;
const USER = "0x1111111111111111111111111111111111111111";
const BASE_DEST = { id: BASE, shortName: "Base" };

const iTm = new ethers.Interface([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64)",
]);
const isErr = (r) => typeof r === "object" && r !== null && "error" in r;

console.log("\n— verified constants —");
check("Arc domain is 26", CCTP_DOMAINS[ARC] === 26);
check("Base domain is 6", CCTP_DOMAINS[BASE] === 6);
check("Ethereum domain is 0", CCTP_DOMAINS[ETH] === 0);
check(
  "TokenMessengerV2 is the deterministic V2 address",
  TOKEN_MESSENGER_V2.toLowerCase() ===
    "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d".toLowerCase(),
);
check(
  "MessageTransmitterV2 is the deterministic V2 address",
  MESSAGE_TRANSMITTER_V2.toLowerCase() ===
    "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64".toLowerCase(),
);
check(
  "Arc burn token is the 6-dec USDC alias",
  CCTP_USDC[ARC].toLowerCase() ===
    "0x3600000000000000000000000000000000000000",
);

console.log("\n— kill-switch —");
check("CCTP corridors are LIVE — the mint completer shipped", CCTP_ENABLED === true);

console.log("\n— domain + corridor guards —");
check("Arc is a CCTP chain", isCctpDomainChain(ARC));
check("Base is a CCTP chain", isCctpDomainChain(BASE));
check("BNB is not a CCTP chain", !isCctpDomainChain(BNB));
check("undefined is not a CCTP chain", !isCctpDomainChain(undefined));
check("Arc→Base is a CCTP corridor", isCctpCorridor(ARC, BASE));
check("Base→Arc is a CCTP corridor", isCctpCorridor(BASE, ARC));
check("Arc→Arc is not a corridor", !isCctpCorridor(ARC, ARC));
check("Arc→BNB is not a CCTP corridor", !isCctpCorridor(ARC, BNB));

console.log("\n— target allow-list —");
check("TokenMessengerV2 is a known target", isKnownCctpTarget(TOKEN_MESSENGER_V2));
check(
  "the allow-list is case-insensitive",
  isKnownCctpTarget(TOKEN_MESSENGER_V2.toLowerCase()),
);
check("MessageTransmitter is not the burn target", !isKnownCctpTarget(MESSAGE_TRANSMITTER_V2));
check("an empty address is not a target", !isKnownCctpTarget(""));

console.log("\n— buildCctpBurnRoute: happy path (Arc→Base, 100 USDC) —");
const ok = buildCctpBurnRoute({
  fromChainId: ARC,
  dest: BASE_DEST,
  asset: "USDC",
  amount: "100",
  decimals: 6,
  isNative: false,
  tokenAddress: CCTP_USDC[ARC],
  userAddress: USER,
});
check("it resolves (no error)", !isErr(ok), isErr(ok) ? ok.error : "");
if (!isErr(ok)) {
  check("provider is cctp", ok.provider === "cctp");
  check("to is TokenMessengerV2", ok.provider && ok.to === TOKEN_MESSENGER_V2);
  check("no native value on a token burn", ok.value === "0");
  check("spender is TokenMessengerV2 (== to)", ok.spender === ok.to);
  check("destination chain carried through", ok.toChainId === BASE);
  const [amount, domain, recipient, burnToken, destCaller, maxFee, threshold] =
    iTm.decodeFunctionData("depositForBurn", ok.data);
  check("amount is 100 USDC in base units", amount === ethers.parseUnits("100", 6));
  check("destinationDomain is Base's (6)", Number(domain) === 6);
  check(
    "mintRecipient is the user left-padded to bytes32",
    recipient === ethers.zeroPadValue(USER, 32),
  );
  check(
    "burnToken is Arc's USDC alias",
    String(burnToken).toLowerCase() === CCTP_USDC[ARC].toLowerCase(),
  );
  check("destinationCaller is zero (permissionless)", destCaller === ethers.ZeroHash);
  check("maxFee is 0 (Standard Transfer, no fee)", maxFee === 0n);
  check("minFinalityThreshold is 2000 (finalized)", Number(threshold) === 2000);
}

console.log("\n— buildCctpBurnRoute: fail-closed refusals —");
const refuse = (name, params) => {
  const r = buildCctpBurnRoute({
    fromChainId: ARC,
    dest: BASE_DEST,
    asset: "USDC",
    amount: "100",
    decimals: 6,
    isNative: false,
    tokenAddress: CCTP_USDC[ARC],
    userAddress: USER,
    ...params,
  });
  check(name, isErr(r), isErr(r) ? "" : "expected an error");
};
refuse("refuses a non-USDC asset", { asset: "ETH" });
refuse("refuses a native-flagged leg", { isNative: true });
refuse("refuses a non-CCTP destination (BNB)", { dest: { id: BNB, shortName: "BNB" } });
refuse("refuses a same-chain corridor", { dest: { id: ARC, shortName: "Arc" } });
refuse("refuses a token that isn't the burn token", {
  tokenAddress: "0x0000000000000000000000000000000000000dEaD",
});
refuse("refuses zero amount", { amount: "0" });
refuse("refuses above the per-message cap", { amount: "10000001" });
refuse("refuses a bad user address", { userAddress: "not-an-address" });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
