/**
 * Deploy the testnet faucet and fund it.
 *
 *   npx hardhat run scripts/deploy-faucet.js --network sepolia
 *   npx hardhat run scripts/deploy-faucet.js --network bscTestnet
 *
 * To add assets to a faucet that is already deployed:
 *
 *   FAUCET_EXTEND=1 npx hardhat run scripts/deploy-faucet.js --network arcTestnet
 *
 * To check the plan against a live chain without deploying or moving anything —
 * addresses, decimals, the literal checks, and the full funding plan including
 * every shortfall:
 *
 *   FAUCET_DRY_RUN=1 npx hardhat run scripts/deploy-faucet.js --network arcTestnet
 *
 * ── What it lists ───────────────────────────────────────────────────────────
 *
 * Every asset the app can trade or lend on the chain, which is up to six and is
 * NOT the same set on each. This used to be one flat `["USDC","USDT","USDe"]`
 * read from the stablecoin record, and that shape could not express the two facts
 * that matter:
 *
 *   The wrapped native is a tradable asset on all five chains and was in none of
 *   them. Every V2 pair routes through it, so a faucet without it hands out three
 *   dollars that can only be swapped for each other.
 *
 *   Arc carries two more — EURC and cirBTC — because Circle's own testnet faucet
 *   issues them there and the app lists both. A per-chain plan can say that; a
 *   shared constant cannot.
 *
 * So FAUCET_PLANS below is keyed by chainId, the same shape MOCK_PLANS in
 * deploy-mock-tokens.js uses and for the same reason: an absent chain is refused
 * rather than defaulted.
 *
 * ── Where the addresses come from ───────────────────────────────────────────
 *
 *   from: "stablecoin"  deployment-stablecoin-<network>.json — the test stables
 *   from: "dex"         deployment-dex-<network>.json `contracts.wrappedNative`
 *   from: "kld"         deployment-kld-<network>.json `contracts.KLD` — the
 *                       protocol token, ours, on its home chain. Kept apart from
 *                       "stablecoin" because it lives in its own record, and from
 *                       "literal" because that source means "third-party address
 *                       we never deployed", which is the signal /faucet uses to
 *                       decide a row should link out to somebody else's issuer.
 *   from: "literal"     third-party contracts in no record of ours (Arc's EURC
 *                       and cirBTC). These carry expectSymbol/expectDecimals and
 *                       are verified on-chain before listing — see below.
 *   from: "native"      the chain's own gas token, listed under the sentinel
 *                       address(1). No record and no decimals()/symbol() to read
 *                       — address(1) is the ecrecover precompile — so its address,
 *                       18 decimals and symbol come from the plan, not a call. It
 *                       is the FIRST asset on every chain because a wallet with no
 *                       gas cannot pay for the transaction that claims any of the
 *                       others; see the note on the native funding strategy.
 *
 * The native sentinel is distinct from the wrapped native above it: WETH/WBNB/
 * WUSDC are ERC20s a tester lends and LPs with, address(1) is raw gas. Both are
 * listed, and a fresh wallet claims the native first to afford the rest.
 *
 * The first two are the same files gen-registry.mjs folds into the registry, so
 * the faucet cannot hand out a USDC the app does not know about. That is precisely
 * the failure a hand-copied address produces, silently, because a wrong address is
 * still twenty well-formed bytes.
 *
 * A literal has no such backstop, and on Arc that is a live hazard rather than a
 * theoretical one: ArcScan's token search returns ten contracts whose symbol is
 * some case of "cirBTC", including a "Mock cirBTC" at 6 decimals. So symbol and
 * decimals do not identify the contract, but they do catch a typo, and a literal
 * whose on-chain symbol or decimals disagree with the plan is refused rather than
 * listed. Registering the wrong cirBTC at the wrong scaling is a 1e10 error, and
 * 1e10 on a BTC-denominated asset is the whole position.
 *
 * Decimals are read from every token regardless of source, never assumed. USDC and
 * USDT are 6, USDe and the wrapped natives 18, cirBTC 8 — a drip scaled by the
 * wrong power of ten is a successful transaction that pays out a millionth of what
 * the page says, and `decimals()` costs one eth_call to rule out.
 *
 * KLD used to be deliberately absent, because no contract in smart-contract/
 * contracts minted it. That changed on 2026-08-27: KLD.sol is deployed on all five
 * testnets, and on each of them `deploy-kld.js` stocked the faucet and called
 * setDrip itself as its last step — so the token has been claimable on Arc and BSC
 * since that run, listed by a script that records the fact in the KLD record's
 * `faucet` leg and never in the faucet's own. This plan now carries it (`from:
 * "kld"`) so the two records agree; an extend run reconciles an already-listed
 * asset into the record rather than listing it twice.
 *
 * kfUSD and kafUSD are absent for a different reason: they are not assets a tester
 * should be given. You obtain kfUSD by depositing collateral and minting it, and
 * kafUSD by staking kfUSD — those flows ARE the product being tested, and handing
 * out the output would skip the thing under test.
 *
 * ── Funding ─────────────────────────────────────────────────────────────────
 *
 * The faucet pays out of its own balance, so it needs stock. Five strategies,
 * chosen per asset rather than attempted blindly:
 *
 *   mint      MockERC20 (public mint) and USDT.sol / USDe.sol (onlyOwner, and the
 *             deployer is the owner, holding 1e9 of each from construction).
 *   wrap      The wrapped natives. WETH9 has no mint at all, and the deployer
 *             holds zero of every one of them (measured on all five chains
 *             2026-08-24), so the only way to obtain any is to deposit() native
 *             and transfer the result in. Bounded by the reserve — the script must
 *             never spend the gas it still needs for the transactions after it —
 *             and by nothing else, because native spent here is the faucet's only
 *             source of the asset.
 *   transfer  Anything we can neither mint nor wrap: Circle's real USDC on
 *             Sepolia and Base Sepolia, and EURC and cirBTC on Arc. Sends up to
 *             the target from whatever the deployer holds.
 *   alias     Arc's USDC at 0x3600…0000 only. Measured on-chain: the deployer's
 *             balanceOf reads 18.532512 against a native balance of
 *             18.53251241577010882 — it is ONE balance viewed at 6 decimals
 *             instead of 18. So funding USDC on Arc spends the gas budget, and it
 *             shares the same reserve as wrapping for the same reason.
 *   native    The gas token itself (the address(1) sentinel). Stocked by a plain
 *             value transfer to the faucet, which its receive() accepts. Like wrap
 *             and alias it is paid out of the native balance and so draws on the
 *             same reserve-bounded budget, split evenly with them — the faucet
 *             cannot hand out gas it needs to keep for its own remaining
 *             transactions. On the chains whose deployer is nearly empty this
 *             funds to zero and is reported short, which is not broken: the asset
 *             is listed and reads empty on /faucet until someone sends it native.
 *
 * Funding is never a reason to abort a deploy. The address has to reach the
 * registry either way, topping up is a plain transfer anyone can do later, and an
 * unfunded asset is not broken — it is listed, /faucet shows it as empty, and
 * `claim` reverts with InsufficientContractBalance until someone sends it tokens.
 * The summary prints the exact shortfall per asset so it is obvious what to send.
 *
 * ── Extending a live faucet (FAUCET_EXTEND=1) ───────────────────────────────
 *
 * The listing on chain is read first and is the authority. A planned asset then
 * falls into one of three buckets, and the difference between the last two is the
 * whole reason this path is more than a `setDrips` call:
 *
 *   fresh       not listed on chain. Listed and funded, exactly as a deploy would.
 *   reconciled  listed on chain but absent from the record — because something
 *               else listed it. `deploy-kld.js` does precisely this, and Arc's and
 *               BSC's faucets have handed out KLD since 2026-08-27 while their
 *               records described six assets and four. These are recorded from
 *               chain state (drip and stock read back through `assetInfo`, never
 *               from the plan) and NOT funded: re-running the funding for an asset
 *               that already has stock would silently double it, and re-`setDrips`
 *               would undo a deliberate pause. The plan's drip is cold-deploy
 *               sizing; a disagreement with the chain is reported, not applied.
 *   blocked     listed nowhere and unlistable on this faucet's bytecode. One real
 *               case: the native sentinel on a faucet deployed before `receive()`
 *               existed (Arc and BSC). Listing address(1) there would create a row
 *               whose claim reverts inside `_pay` — it would call
 *               IERC20(address(1)).safeTransfer, i.e. the ecrecover precompile —
 *               and the funding send would revert too, for want of a receive().
 *               Detected from the deployed bytecode rather than from a chain id.
 *
 * Everything the record already carried and the plan no longer mentions is carried
 * forward untouched, as are top-level keys written by the sibling scripts
 * (`lastTopup`, `lastDripFix`, `lastUsdcSwitch`) and the original deploy
 * `timestamp` — an extend adds `extendedAt` rather than overwriting when the
 * faucet was born.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

const { waitForCode } = require("./libraries/rpc.js");

/**
 * Per-chain asset plan.
 *
 * An allowlist, not a mainnet denylist, and for the same reason MOCK_PLANS in
 * deploy-mock-tokens.js is one: a faucet gives away tokens to anyone who asks, so
 * the failure mode of a defaulted chain is a contract on mainnet holding real
 * assets behind a public claim function. `ChainContracts.faucet` is documented
 * "Testnet only" and this is what enforces it.
 *
 * `drip` is in human units and is sized to what a tester needs per claim, not to
 * what the deployer happens to hold today — the stock is a funding question and
 * the summary reports it separately. `stockDrips` is how many claims' worth to
 * try to stock, defaulting to DEFAULT_STOCK_DRIPS.
 *
 * `nativeReserve` is human units of native the script will not spend on wrapping
 * or on Arc's aliased USDC. It is an operational float for the scripts that run
 * after this one, NOT an estimate of this run's gas: the run's own cost is priced
 * live and taken as a floor under it (see `gasFloor`), so a gas spike raises the
 * reserve on its own and the number here does not have to be guessed upward to
 * survive one. Each value below is set against the measured 40-transaction cost on
 * that chain, recorded in `gasFloor`.
 */
const FAUCET_PLANS = {
  11155111: {
    label: "Sepolia",
    nativeReserve: 0.03, // 3.6x the measured 0.0083 floor
    assets: [
      { key: "NATIVE", from: "native", symbol: "ETH", drip: 0.05, stockDrips: 20 },
      { key: "USDC", from: "stablecoin", drip: 10_000 },
      { key: "USDT", from: "stablecoin", drip: 10_000 },
      { key: "USDe", from: "stablecoin", drip: 10_000 },
      { key: "WETH", from: "dex", drip: 1, fund: "wrap", stockDrips: 10 },
      /* Already listed and stocked by deploy-kld.js on every chain — see the Arc
         entry below and the header's note on reconciled assets. */
      { key: "KLD", from: "kld", drip: 1000, stockDrips: 5000 },
    ],
  },

  84532: {
    label: "Base Sepolia",
    nativeReserve: 0.0005, // 10x the measured 0.000048 floor
    assets: [
      { key: "NATIVE", from: "native", symbol: "ETH", drip: 0.02, stockDrips: 20 },
      { key: "USDC", from: "stablecoin", drip: 10_000 },
      { key: "USDT", from: "stablecoin", drip: 10_000 },
      { key: "USDe", from: "stablecoin", drip: 10_000 },
      { key: "WETH", from: "dex", drip: 1, fund: "wrap", stockDrips: 10 },
      { key: "KLD", from: "kld", drip: 1000, stockDrips: 5000 },
    ],
  },

  97: {
    label: "BSC Testnet",
    nativeReserve: 0.005, // 6x the measured 0.0008 floor
    assets: [
      { key: "NATIVE", from: "native", symbol: "BNB", drip: 0.02, stockDrips: 20 },
      { key: "USDC", from: "stablecoin", drip: 10_000 },
      { key: "USDT", from: "stablecoin", drip: 10_000 },
      { key: "USDe", from: "stablecoin", drip: 10_000 },
      /*
       * `0xae13d989…` is the canonical BSC testnet wrapper, not ours, so it is
       * listed PAUSED at drip 0 and never stocked: a tester gets WBNB by wrapping
       * tBNB, which is one call they can make themselves, and stocking it would
       * spend the scarcest thing on this chain to save a step nobody is stuck on.
       * Same rule and same mechanism as Arc's EURC/cirBTC below.
       */
      { key: "WBNB", from: "dex", drip: 0, fund: "wrap", stockDrips: 10 },
      { key: "KLD", from: "kld", drip: 1000, stockDrips: 5000 },
    ],
  },

  46630: {
    label: "Robinhood Chain Testnet",
    nativeReserve: 0.002, // 25x the measured 0.00008 floor
    assets: [
      { key: "NATIVE", from: "native", symbol: "ETH", drip: 0.01, stockDrips: 20 },
      { key: "USDC", from: "stablecoin", drip: 10_000 },
      { key: "USDT", from: "stablecoin", drip: 10_000 },
      { key: "USDe", from: "stablecoin", drip: 10_000 },
      { key: "WETH", from: "dex", drip: 1, fund: "wrap", stockDrips: 10 },
      { key: "KLD", from: "kld", drip: 1000, stockDrips: 5000 },
    ],
  },

  5042002: {
    label: "Arc Testnet",
    /*
     * Denominated in USDC rather than in a fraction of an ether, because on Arc
     * the native currency IS USDC. Six times the measured 0.168 floor — Arc's 21
     * gwei is by far the highest gas price of the five, which is why this is the
     * largest reserve in absolute terms and still the same multiple as BSC's.
     *
     * Whatever is above it is split between the aliased USDC and the WUSDC wrap,
     * which share one balance because they ARE one balance.
     */
    nativeReserve: 1,
    assets: [
      /*
       * Native gas on Arc IS USDC (18dp underneath, the same balance the aliased
       * ERC20 below views at 6dp). Its key stays "NATIVE", not "USDC", so it does
       * not collide with the aliased-USDC entry in the per-asset funding map; only
       * its display symbol is USDC. It draws on the same balance as that entry and
       * the WUSDC wrap, so all three split the reserve-bounded budget three ways.
       */
      {
        key: "NATIVE",
        from: "native",
        symbol: "USDC",
        drip: 0.5,
        stockDrips: 20,
      },
      /*
       * 10 claims' worth rather than the default 100, for the two that come out of
       * the gas balance. Not because asking for more would starve the deploy — the
       * reserve prevents that — but because these two are the only assets whose
       * stock cannot be topped up without spending the thing that pays for
       * transactions on this chain, so a target of 100,000 would report a shortfall
       * of 100,000 forever and say nothing useful.
       */
      {
        key: "USDC",
        from: "stablecoin",
        drip: 100,
        fund: "alias",
        stockDrips: 10,
      },
      { key: "USDT", from: "stablecoin", drip: 10_000 },
      { key: "USDe", from: "stablecoin", drip: 10_000 },
      { key: "WUSDC", from: "dex", drip: 100, fund: "wrap", stockDrips: 10 },
      /*
       * Ours, and the reason /stake is reachable by a wallet that has only ever
       * used the faucet. Already listed on chain — `deploy-kld.js` stocked 5M and
       * called setDrip as its last step on 2026-08-27 — so on this chain the entry
       * exists to reconcile the record, not to list anything. The numbers are the
       * live ones so that a cold deploy elsewhere reproduces today's state: 1000
       * per claim, 5000 claims' worth. KLD's supply is minted in full at deploy, so
       * `mint` reverts and the stock comes out of what the deployer holds.
       */
      { key: "KLD", from: "kld", drip: 1000, stockDrips: 5000 },
      {
        /*
         * Circle's, not ours, so it is listed PAUSED and never stocked — drip 0 is
         * the contract's own retirement state (`_setDrip` still lists it, and
         * `_eligibility` then returns NOT_LISTED). It stays in the plan because the
         * app trades it and /faucet routes the paused row to faucet.circle.com via
         * ISSUER_FAUCETS; it is at 0 here because the standing rule is that we hand
         * out only what we deployed, and a cold-deploy drip of 1.0 would quietly
         * re-enable it the next time this chain is deployed from scratch.
         */
        key: "EURC",
        from: "literal",
        address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
        expectSymbol: "EURC",
        expectDecimals: 6,
        drip: 0,
        stockDrips: 10,
      },
      {
        /*
         * 8 decimals, matching WBTC and not the 18 an EVM token is assumed to
         * have. See the header on why expectSymbol alone would not be enough here
         * and why both are checked. Paused for the same reason as EURC above.
         */
        key: "cirBTC",
        from: "literal",
        address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
        expectSymbol: "cirBTC",
        expectDecimals: 8,
        drip: 0,
        stockDrips: 10,
      },
    ],
  },
};

/** Claims' worth to stock when an asset does not override it. */
const DEFAULT_STOCK_DRIPS = 100;
const DEFAULT_COOLDOWN_SECONDS = 60 * 60;

/**
 * The native gas token's sentinel. MUST equal KaleidoTokenFaucet.NATIVE_TOKEN,
 * Constants.NATIVE_TOKEN and the frontend's NATIVE_SENTINEL.lending, so a wallet
 * that claims native here names the same asset it deposits as collateral there.
 * Deliberately NOT the DEX's 0xEeee… convention. Every native asset in the wave
 * is 18 decimals — the balance underneath, even where an ERC20 alias views it at
 * 6 (Arc's USDC).
 */
const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000001";
const NATIVE_DECIMALS = 18;

/**
 * The custom error only the native-capable build of the faucet carries.
 *
 * `receive()` and the native branch of `_pay` landed on 2026-08-27, after Arc's
 * and BSC's faucets were deployed, and neither can be upgraded in place —
 * FAUCET_EXTEND adds listings, not code. On those two, listing the native sentinel
 * would produce a row that reverts on claim: `_pay` would fall through to
 * `IERC20(address(1)).safeTransfer`, i.e. a transfer against the ecrecover
 * precompile. So an extend run asks the deployed bytecode rather than a chain id.
 *
 * Measured 2026-08-30: the pre-native runtime is 4560 bytes and the current one
 * 5343, and only the latter contains this selector. Reading the bytecode is
 * cheaper than probing with a 1 wei eth_call and it answers the `_pay` question a
 * `receive()` probe cannot — a contract could accept value and still be unable to
 * pay it out.
 */
const NATIVE_ERROR_SIGNATURE = "KaleidoTokenFaucet_NativeTransferFailed()";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function deposit() payable",
];

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got ${raw}`);
  }
  return n;
}

function readRecord(name, chainId, why) {
  if (!fs.existsSync(name)) {
    throw new Error(`${name} not found. ${why}`);
  }
  const record = JSON.parse(fs.readFileSync(name, "utf8"));
  if (Number(record.chainId) !== chainId) {
    throw new Error(
      `${name} records chainId ${record.chainId}, but this run is on ` +
        `${chainId}. One of the two is pointed at the wrong network — refusing ` +
        "to list another chain's token addresses."
    );
  }
  return record;
}

/**
 * Whether the faucet actually sitting at this address can hand out native gas.
 *
 * The artifact's own bytecode is the control: if the selector is missing from the
 * build this script just compiled, a `false` from the live code would mean nothing
 * — the error could have been renamed — and the run would silently stop listing
 * native on every chain. So an absent control throws rather than answering.
 */
async function faucetHandlesNative(faucetAddress, artifactBytecode) {
  const selector = ethers.id(NATIVE_ERROR_SIGNATURE).slice(2, 10);
  if (!artifactBytecode.includes(selector)) {
    throw new Error(
      `The compiled KaleidoTokenFaucet does not carry ${NATIVE_ERROR_SIGNATURE} ` +
        `(${selector}), so it cannot be used to tell a native-capable deployment ` +
        "from a pre-native one. Was the error renamed? Fix this probe before " +
        "extending a live faucet — guessing wrong lists a gas row that reverts."
    );
  }
  const code = await ethers.provider.getCode(faucetAddress);
  return code.includes(selector);
}

/*
 * Native the run must keep back for its own transactions, priced live.
 *
 * A hardcoded reserve is a guess about a gas price, and the guesses here were wrong
 * by one to three orders of magnitude. Measured 2026-08-24, forty transactions cost
 * 0.0083 ETH on Sepolia, 0.0008 BNB on BSC, 0.00008 ETH on Robinhood and 0.000048
 * ETH on Base Sepolia, against reserves of 0.05, 0.05, 0.05 and 0.005. Robinhood's
 * was 625x the gas it protected and Base Sepolia's was two thirds of the entire
 * balance — and since the deployer holds zero of every wrapped native, every unit
 * held back was a unit of WETH the faucet did not get.
 *
 * So the reserve is now the greater of the plan's float and this: the plan says how
 * much to leave for later scripts, this says how much this run cannot do without,
 * and a gas spike raises the second without anyone editing the first.
 *
 * Forty transactions at 200k gas is headroom rather than an estimate. The run is a
 * deploy plus at most two calls per funded asset — under 3M gas on the widest chain
 * — so this is roughly 2.5x the whole thing.
 */
const RESERVE_TX_COUNT = 40n;
const RESERVE_GAS_PER_TX = 200_000n;

function gasFloor(feeData) {
  /* maxFeePerGas over gasPrice where both exist: on an EIP-1559 chain it is the
   * ceiling the node would actually accept, which is the conservative side for a
   * floor. Zero if the node reports neither, in which case the plan's float is the
   * only bound and the log says so. */
  const price = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  return price * RESERVE_GAS_PER_TX * RESERVE_TX_COUNT;
}

/**
 * How much native the script may spend, and how much of it each asset that draws
 * on it gets.
 *
 * Wrapping, Arc's aliased USDC and the native drip come out of the SAME balance
 * — the ERC20 at 0x3600…0000 is a 6-decimal view of the native one, deposit()
 * spends native directly, and the native drip is a plain send of it. A single
 * running budget would therefore be first-come-first-served, and on Arc that is
 * not hypothetical: USDC is listed before WUSDC, its target is larger than the
 * whole budget, and it would take all of it and leave the wrapped native at zero.
 * Which asset wins would depend on the order of the array, which is a
 * presentation detail.
 *
 * An equal share per drawer is order-independent and predictable. A share that
 * goes unspent is not redistributed — that would reintroduce the ordering
 * dependence in a subtler form, and the shortfall is reported either way, so the
 * fix is to send more rather than to divide more cleverly. On the four chains with
 * a single drawer this is the whole budget and changes nothing.
 */
function nativeBudget(listed, plan, nativeBalance, floor) {
  const stated = ethers.parseEther(String(plan.nativeReserve ?? 0));
  const reserve = stated > floor ? stated : floor;
  const spendable = nativeBalance > reserve ? nativeBalance - reserve : 0n;
  const drawers = listed.filter(
    (a) => a.fund === "wrap" || a.fund === "alias" || a.fund === "native"
  ).length;
  return {
    reserve,
    boundBy: stated >= floor ? "plan float" : "live gas price",
    spendable,
    drawers,
    share: drawers > 0 ? spendable / BigInt(drawers) : 0n,
  };
}

/**
 * Decides how each asset would be funded, moving nothing.
 *
 * Split out from the execution below so `FAUCET_DRY_RUN=1` reports the same
 * decisions the real run will act on. A dry run that stopped at address
 * resolution could not check the part with the arithmetic in it — the share
 * split, the 18dp assumption behind the wrap, the 1e12 rescale on the alias — and
 * that is the half where being wrong costs tokens rather than a re-run.
 *
 * Mintability is probed with a static call rather than by attempting the mint and
 * catching: MockERC20's mint is public, USDT.sol's and USDe.sol's are onlyOwner,
 * and Circle's tokens have no mint at all, so which of the three an address is
 * cannot be known from the plan. `recipient` is the faucet on a real run and the
 * deployer on a dry run — none of the three gate on the recipient, so the answer
 * is the same either way.
 */
async function planFunding(listed, { deployer, recipient, share, reserve }) {
  const decisions = [];

  for (const a of listed) {
    const push = (method, amount, note) =>
      decisions.push({
        asset: a,
        method,
        amount,
        short: a.target > amount ? a.target - amount : 0n,
        note: note ?? null,
      });

    if (a.target === 0n) {
      push("none", 0n, "nothing requested");
      continue;
    }

    /* -- the native gas token: a plain send, capped by the shared budget ---- */
    if (a.fund === "native") {
      /* Both the target and the share are native wei (18dp), and the share is
       * already `(nativeBalance - reserve) / drawers`, so a send capped at it can
       * never dip into the reserve or overspend — no balanceOf check needed, the
       * budget IS the balance. */
      const send = a.target < share ? a.target : share;
      if (send === 0n) {
        push(
          "unfunded",
          0n,
          `no native above the ${ethers.formatEther(reserve)} reserve left to send`
        );
        continue;
      }
      push("native", send);
      continue;
    }

    /* -- wrapped native: deposit() then transfer in ------------------------- */
    if (a.fund === "wrap") {
      /* The share is native (18dp) while the target is in the token's own
       * decimals. Every wrapped native in the wave is 18dp, so these coincide —
       * but assert it rather than assume, because a 6-decimal wrapper would make
       * the share off by 1e12. */
      if (a.decimals !== 18) {
        throw new Error(
          `${a.key} is a wrapped native with ${a.decimals} decimals. The wrap ` +
            "budget is denominated in native wei, so this needs an explicit " +
            "conversion before it can be funded here."
        );
      }
      const wrap = a.target < share ? a.target : share;
      if (wrap === 0n) {
        push(
          "unfunded",
          0n,
          `no native above the ${ethers.formatEther(
            reserve
          )} reserve left to wrap`
        );
        continue;
      }
      push("wrap", wrap);
      continue;
    }

    /* -- Arc's aliased USDC: a transfer that spends the gas budget ---------- */
    if (a.fund === "alias") {
      const held = await a.token.balanceOf(deployer);
      /* The share is native wei (18dp); this token is a 6-decimal view of the
       * same balance, so compare in the token's own units. */
      const cap = share / 10n ** BigInt(18 - a.decimals);
      let send = a.target < cap ? a.target : cap;
      if (send > held) send = held;
      if (send === 0n) {
        push(
          "unfunded",
          0n,
          `the chain's gas token, and the ${ethers.formatEther(reserve)} ` +
            "reserve leaves nothing to send"
        );
        continue;
      }
      push("alias", send, "spends the gas budget");
      continue;
    }

    /* -- mint if we can, else transfer what we hold ------------------------- */
    const mintable = await a.token.mint
      .staticCall(recipient, a.target)
      .then(() => true)
      .catch(() => false);
    if (mintable) {
      push("mint", a.target);
      continue;
    }

    const held = await a.token.balanceOf(deployer);
    const send = held < a.target ? held : a.target;
    if (send === 0n) {
      push("unfunded", 0n, "not mintable by us and the deployer holds none");
      continue;
    }
    push("transfer", send, held < a.target ? "all the deployer holds" : null);
  }

  return decisions;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  const plan = FAUCET_PLANS[chainId];
  if (!plan) {
    throw new Error(
      `Chain ${chainId} (${net}) has no faucet plan.\n` +
        "The faucet hands tokens to any caller, so it belongs on testnets only — " +
        `ChainContracts.faucet is documented "Testnet only". Add the chain to ` +
        "FAUCET_PLANS deliberately if this really is a new testnet."
    );
  }

  const extend = process.env.FAUCET_EXTEND === "1";
  const outName = `deployment-faucet-${net}.json`;
  const exists = fs.existsSync(outName);

  if (exists && !extend && process.env.FORCE_REDEPLOY !== "1") {
    throw new Error(
      `${outName} already exists. A second faucet on this chain splits the ` +
        "funding across two contracts and the registry can only carry one, so " +
        "half the stock becomes unreachable.\nTo ADD assets to the existing " +
        "faucet, pass FAUCET_EXTEND=1 — it calls setDrips for anything not yet " +
        "listed and funds it, leaving the address and the existing stock alone." +
        "\nTo REPLACE it: withdraw() the old one's balances first, then delete " +
        "the record and pass FORCE_REDEPLOY=1."
    );
  }
  if (extend && !exists) {
    throw new Error(
      `FAUCET_EXTEND=1 but ${outName} does not exist — there is no faucet on ` +
        "this chain to extend. Run without it to deploy one."
    );
  }

  console.log(
    `${extend ? "Extending" : "Deploying"} the token faucet on ${plan.label}`
  );
  console.log("  network:  ", net, `(chainId ${chainId})`);
  console.log("  deployer: ", deployer.address);
  const nativeBalance = await ethers.provider.getBalance(deployer.address);
  console.log("  balance:  ", ethers.formatEther(nativeBalance));

  /* ── 1. Resolve the asset list ──────────────────────────────────────────── */

  const needsStable = plan.assets.some((a) => a.from === "stablecoin");
  const needsDex = plan.assets.some((a) => a.from === "dex");
  const needsKld = plan.assets.some((a) => a.from === "kld");

  const stable = needsStable
    ? readRecord(
        `deployment-stablecoin-${net}.json`,
        chainId,
        "The faucet lists the test stables that deploy was run for, so " +
          "deploy-stablecoin.js has to have run on this chain first."
      )
    : null;
  const dex = needsDex
    ? readRecord(
        `deployment-dex-${net}.json`,
        chainId,
        "The wrapped native is read from the DEX record rather than hardcoded " +
          "here, so deploy-dex.js has to have run on this chain first."
      )
    : null;
  const kldRecord = needsKld
    ? readRecord(
        `deployment-kld-${net}.json`,
        chainId,
        "KLD is read from its own deployment record, so deploy-kld.js has to " +
          "have run on this chain first. On a satellite chain the token arrives " +
          "by bridge and the record is still written, so this file existing is " +
          "the right precondition either way."
      )
    : null;

  console.log(`\n1. Resolving ${plan.assets.length} asset(s)`);
  const cooldown = numberFromEnv("FAUCET_COOLDOWN", DEFAULT_COOLDOWN_SECONDS);
  const assets = [];

  for (const spec of plan.assets) {
    /*
     * Native is the sentinel address(1), which is the ecrecover precompile: a
     * decimals()/symbol()/balanceOf() staticcall against it does not revert, it
     * returns decodable garbage. So it is resolved from the plan — fixed address,
     * 18 decimals, the plan's symbol — and never touches the ERC20 path below.
     */
    if (spec.from === "native") {
      const drip = ethers.parseUnits(String(spec.drip), NATIVE_DECIMALS);
      const stockDrips = BigInt(spec.stockDrips ?? DEFAULT_STOCK_DRIPS);
      assets.push({
        ...spec,
        address: NATIVE_SENTINEL,
        symbol: spec.symbol ?? "NATIVE",
        decimals: NATIVE_DECIMALS,
        drip,
        target: drip * stockDrips,
        token: null,
        fund: "native",
      });
      console.log(
        `   ${spec.key.padEnd(7)} ${NATIVE_SENTINEL}  (native gas, ` +
          `${spec.symbol}, ${NATIVE_DECIMALS} dp) — drip ${spec.drip}, ` +
          `stock ${stockDrips} ×  [native]`
      );
      continue;
    }

    let address;
    if (spec.from === "stablecoin") {
      address = stable.contracts?.[spec.key];
    } else if (spec.from === "dex") {
      address = dex.contracts?.wrappedNative;
    } else if (spec.from === "kld") {
      address = kldRecord.contracts?.KLD;
    } else if (spec.from === "literal") {
      address = spec.address;
    } else {
      throw new Error(`${spec.key}: unknown source "${spec.from}"`);
    }

    if (!address) {
      console.log(
        `   ${spec.key.padEnd(7)} absent from its ${spec.from} record — skipped`
      );
      continue;
    }

    const token = new ethers.Contract(address, ERC20_ABI, deployer);
    const [decimals, symbol] = await Promise.all([
      token.decimals().then(Number),
      token.symbol().catch(() => null),
    ]);

    /* A literal has no deployment record vouching for it — see the header. */
    if (spec.from === "literal") {
      if (
        spec.expectDecimals !== undefined &&
        decimals !== spec.expectDecimals
      ) {
        throw new Error(
          `${spec.key} at ${address} reports ${decimals} decimals, expected ` +
            `${spec.expectDecimals}. Refusing to list it: Arc carries several ` +
            "contracts per symbol at different scalings, and the wrong one is a " +
            "1e" +
            Math.abs(decimals - spec.expectDecimals) +
            " error on every claim."
        );
      }
      if (
        spec.expectSymbol !== undefined &&
        String(symbol).toLowerCase() !== spec.expectSymbol.toLowerCase()
      ) {
        throw new Error(
          `${spec.key} at ${address} reports symbol "${symbol}", expected ` +
            `"${spec.expectSymbol}". Refusing to list it — this address is not ` +
            "the token the plan means."
        );
      }
    }

    const drip = ethers.parseUnits(String(spec.drip), decimals);
    const stockDrips = BigInt(spec.stockDrips ?? DEFAULT_STOCK_DRIPS);
    assets.push({
      ...spec,
      address,
      symbol: symbol ?? spec.key,
      decimals,
      drip,
      target: drip * stockDrips,
      token,
      fund: spec.fund ?? "auto",
    });
    console.log(
      `   ${spec.key.padEnd(7)} ${address}  (${symbol}, ${decimals} dp) — ` +
        `drip ${spec.drip.toLocaleString("en-US")}, ` +
        `stock ${stockDrips} ×  [${spec.fund ?? "auto"}]`
    );
  }

  if (assets.length === 0) {
    throw new Error(
      "None of the planned assets resolved to an address. There is nothing to " +
        "hand out, and a faucet with no assets is not worth an address."
    );
  }

  /* ── 1b. On an extend, ask the live faucet what it already lists ─────────── */

  /*
   * Read before deciding, and read before the dry run, so that
   * `FAUCET_EXTEND=1 FAUCET_DRY_RUN=1` rehearses the extend rather than a fresh
   * deploy. The classification is the whole substance of an extend — see the
   * header on fresh / reconciled / blocked — and a dry run that reported the
   * fresh-deploy plan instead would say this run will move tokens it will not
   * touch, which is the one thing a rehearsal must not do.
   */
  const Faucet = await ethers.getContractFactory("KaleidoTokenFaucet");
  let previous = null;
  let faucetAddress = null;
  let faucet = null;
  let fresh = assets;
  let reconcile = [];
  let blocked = [];
  const live = new Map();

  if (extend) {
    previous = JSON.parse(fs.readFileSync(outName, "utf8"));
    faucetAddress = previous.contracts?.faucet;
    if (!faucetAddress) {
      throw new Error(`${outName} carries no contracts.faucet address.`);
    }
    faucet = Faucet.attach(faucetAddress);
    console.log(`\n1b. Reading the faucet at ${faucetAddress}`);

    /* assetInfo rather than assets(i) in a loop: one call for the addresses, the
     * drips AND the stock, which is what a reconciled entry has to be built from. */
    const info = await faucet.assetInfo(deployer.address);
    for (let i = 0; i < info.tokens.length; i++) {
      live.set(info.tokens[i].toLowerCase(), {
        address: info.tokens[i],
        drip: info.amounts[i],
        stock: info.balances[i],
      });
    }
    const recorded = new Set(
      (previous.config?.assets ?? []).map((a) =>
        String(a.address).toLowerCase()
      )
    );
    console.log(
      `   ${live.size} asset(s) listed on chain, ${recorded.size} in ${outName}`
    );

    const nativeReady = await faucetHandlesNative(faucetAddress, Faucet.bytecode);
    fresh = [];
    for (const a of assets) {
      if (live.has(a.address.toLowerCase())) {
        if (!recorded.has(a.address.toLowerCase())) reconcile.push(a);
        continue;
      }
      if (a.fund === "native" && !nativeReady) {
        blocked.push(a);
        continue;
      }
      fresh.push(a);
    }

    if (blocked.length > 0) {
      console.log(
        `\n   ! this faucet predates native support — no receive(), and _pay has ` +
          `\n     no native branch, so listing the sentinel would create a row ` +
          `\n     whose claim reverts against the ecrecover precompile. Skipping: ` +
          `\n     ${blocked.map((a) => `${a.key} (${a.symbol})`).join(", ")}` +
          `\n     Gas here comes from the chain's own faucet, or from an ERC20 ` +
          `\n     alias of the native balance where the chain has one (Arc's ` +
          `\n     0x3600…0000). Only FORCE_REDEPLOY changes the code, and that ` +
          `\n     strands the stock this faucet already holds.`
      );
    }
    if (reconcile.length > 0) {
      console.log(
        `\n   ${reconcile.length} asset(s) listed on chain but absent from the ` +
          `record: ${reconcile.map((a) => a.key).join(", ")}` +
          "\n     Recorded from chain state below — not listed again, not funded."
      );
      for (const a of reconcile) {
        const l = live.get(a.address.toLowerCase());
        if (l.drip !== a.drip) {
          console.log(
            `     ${a.key.padEnd(7)} live drip ${ethers.formatUnits(
              l.drip,
              a.decimals
            )} vs plan ${ethers.formatUnits(a.drip, a.decimals)} — recording ` +
              "the live one (the plan is cold-deploy sizing)"
          );
        }
      }
    }
  }

  /*
   * Stop here on a dry run.
   *
   * Everything above is read-only — record lookups, decimals(), symbol(), the
   * literal checks and the live listing — and it is where the mistakes live: a
   * renamed key in a deployment record, a chain whose DEX record has no
   * wrappedNative, or an Arc literal pointing at one of the several impostor
   * contracts sharing its symbol.
   *
   * The funding plan is read-only too, and is reported here for the same reason:
   * it is the half with the arithmetic in it. `mint` vs `transfer` per asset, the
   * native share split, and every shortfall are all decided before anything moves,
   * so a dry run says exactly what the real run will do and what it will be short
   * of — including, on an extend, that it will move nothing at all.
   */
  if (process.env.FAUCET_DRY_RUN === "1") {
    const floor = gasFloor(await ethers.provider.getFeeData());
    const budget = nativeBudget(fresh, plan, nativeBalance, floor);
    const decisions = await planFunding(fresh, {
      deployer: deployer.address,
      recipient: deployer.address,
      share: budget.share,
      reserve: budget.reserve,
    });

    console.log("\nDRY RUN — nothing deployed, nothing moved.");
    if (extend) {
      console.log(
        `\n   extend: ${fresh.length} to list and fund, ${reconcile.length} to ` +
          `record from chain state, ${blocked.length} skipped, ` +
          `${live.size - reconcile.length} left alone.`
      );
      if (fresh.length === 0) {
        console.log(
          "   No transaction would be sent — the record is the only thing that " +
            "\n   would change."
        );
      }
    }
    if (budget.drawers > 0) {
      console.log(
        `\n   reserve ${ethers.formatEther(budget.reserve)} ` +
          `(${budget.boundBy}; plan float ${plan.nativeReserve}, ` +
          `gas floor ${ethers.formatEther(floor)})`
      );
      console.log(
        `   ${budget.drawers} asset(s) draw on the native balance: ` +
          `${ethers.formatEther(budget.spendable)} spendable, ` +
          `${ethers.formatEther(budget.share)} each`
      );
    }

    if (decisions.length > 0) {
      console.log(
        "\n   asset    would stock            of target            how"
      );
    }
    for (const d of decisions) {
      const { asset: a } = d;
      console.log(
        `   ${a.symbol.padEnd(8)} ` +
          `${ethers.formatUnits(d.amount, a.decimals).padEnd(20)} ` +
          `${ethers.formatUnits(a.target, a.decimals).padEnd(20)} ` +
          `${d.method}${d.note ? ` — ${d.note}` : ""}`
      );
    }

    for (const a of reconcile) {
      const l = live.get(a.address.toLowerCase());
      console.log(
        `   ${a.symbol.padEnd(8)} ${ethers
          .formatUnits(l.stock, a.decimals)
          .padEnd(20)} ${"—".padEnd(20)} already stocked, drip ` +
          `${ethers.formatUnits(l.drip, a.decimals)} — record only`
      );
    }

    const short = decisions.filter((d) => d.short > 0n);
    if (short.length > 0) {
      console.log("\n   Short of target — send to the faucet once deployed:");
      for (const d of short) {
        console.log(
          `     ${ethers.formatUnits(d.short, d.asset.decimals)} ${
            d.asset.symbol
          }`
        );
      }
    }

    console.log(
      `\n${assets.length} of ${plan.assets.length} planned asset(s) resolved on ` +
        `${plan.label}. Re-run without FAUCET_DRY_RUN to ` +
        `${extend ? "extend" : "deploy"}.`
    );
    return;
  }

  /* ── 2. Deploy, or list what the extend found fresh ──────────────────────── */

  let listed = fresh;

  if (extend) {
    console.log(`\n2. Extending the faucet at ${faucetAddress}`);

    if (fresh.length === 0) {
      console.log(
        "   nothing to list — every planned asset this faucet can pay is " +
          "already on chain"
      );
    } else {
      console.log(
        `   listing ${fresh.length} new asset(s): ` +
          fresh.map((a) => a.symbol).join(", ")
      );
      /* No retry on a timeout. A ConnectTimeout is a client-side event and the
       * transaction may well have landed; a blind resend is how an asset gets its
       * drip set twice. If this throws, re-read assetInfo before acting. */
      const tx = await faucet.setDrips(
        fresh.map((a) => a.address),
        fresh.map((a) => a.drip)
      );
      console.log(`   tx ${tx.hash}`);
      await tx.wait();
    }
  } else {
    console.log(`\n2. Deploying KaleidoTokenFaucet (cooldown ${cooldown}s)`);
    faucet = await Faucet.deploy(
      assets.map((a) => a.address),
      assets.map((a) => a.drip),
      cooldown
    );
    await faucet.waitForDeployment();
    faucetAddress = await faucet.getAddress();
    await waitForCode(ethers.provider, faucetAddress, "KaleidoTokenFaucet");
    console.log(`   deployed ${faucetAddress}`);

    /* Read the list back off the contract rather than trusting the constructor
     * args. A silently truncated list would mean the page renders four assets
     * while the deploy log claims six. */
    const onChainCount = Number(await faucet.assetCount());
    if (onChainCount !== assets.length) {
      throw new Error(
        `Faucet lists ${onChainCount} asset(s), expected ${assets.length}.`
      );
    }
  }

  /* ── 3. Fund ───────────────────────────────────────────────────────────── */

  /* Only what was just listed. Anything already on chain has whatever stock it
   * has, and re-running the funding for it would silently double it — which is
   * exactly what a reconciled asset would suffer, since those are already stocked
   * by whoever listed them. */
  console.log(`\n3. Funding ${listed.length} asset(s)`);

  const floor = gasFloor(await ethers.provider.getFeeData());
  const budget = nativeBudget(listed, plan, nativeBalance, floor);
  if (budget.drawers > 1) {
    console.log(
      `   ${budget.drawers} assets draw on the native balance; ` +
        `${ethers.formatEther(budget.share)} each after a ` +
        `${ethers.formatEther(budget.reserve)} reserve (${budget.boundBy})`
    );
  }

  /* Decide everything first, then move. The decisions are the same ones
   * FAUCET_DRY_RUN printed, so a dry run is a rehearsal rather than a summary of
   * a different code path. */
  const decisions = await planFunding(listed, {
    deployer: deployer.address,
    recipient: faucetAddress,
    share: budget.share,
    reserve: budget.reserve,
  });

  const funding = {};
  for (const d of decisions) {
    const a = d.asset;
    const human = (v) => ethers.formatUnits(v, a.decimals);
    funding[a.key] = {
      method: d.method,
      amount: human(d.amount),
      target: human(a.target),
      short: d.short > 0n ? human(d.short) : null,
    };

    if (d.method === "none" || d.method === "unfunded") {
      console.log(
        `   ${a.key.padEnd(7)} ${
          d.method === "none" ? "nothing requested" : `NOT FUNDED — ${d.note}`
        }` +
          (d.method === "unfunded"
            ? `. Send ${a.symbol} to ${faucetAddress} to switch it on.`
            : "")
      );
      continue;
    }

    if (d.method === "wrap") {
      await (await a.token.deposit({ value: d.amount })).wait();
      await (await a.token.transfer(faucetAddress, d.amount)).wait();
    } else if (d.method === "mint") {
      await (await a.token.mint(faucetAddress, d.amount)).wait();
    } else if (d.method === "native") {
      /* A plain value transfer the faucet's receive() accepts — the native token
       * has no contract to call, it IS the value. */
      await (
        await deployer.sendTransaction({ to: faucetAddress, value: d.amount })
      ).wait();
    } else {
      /* alias and transfer are both a plain transfer from the deployer; they
       * differ only in which balance they drain, which planFunding accounted for. */
      await (await a.token.transfer(faucetAddress, d.amount)).wait();
    }

    console.log(
      `   ${a.key.padEnd(7)} ${d.method} ${human(d.amount)} ${a.symbol}` +
        (d.note ? ` (${d.note})` : "") +
        (d.short > 0n ? `  — ${human(d.short)} short of target` : "")
    );
  }

  /* ── 4. Record ─────────────────────────────────────────────────────────── */

  /* On an extend run, carry forward the assets that were already listed so the
   * record stays a complete description of the faucet rather than a diff. */
  const carried = extend
    ? (previous.config?.assets ?? []).filter(
        (old) =>
          !listed.some(
            (a) => a.address.toLowerCase() === String(old.address).toLowerCase()
          )
      )
    : [];

  /*
   * Listed on chain, absent from the record — recorded from what the chain says
   * rather than from the plan.
   *
   * The plan's drip is cold-deploy sizing and can be years out of date by the time
   * anyone runs an extend; the live drip is what a claimer gets. Writing the plan's
   * number here is the exact bug that had Arc's record advertising a 100.0 USDC
   * drip for six days after the chain moved to 0.25. `funding.method` says
   * "preexisting" for the same reason: this run did not move the stock and has no
   * standing to claim how it got there.
   */
  const reconciled = reconcile.map((a) => {
    const l = live.get(a.address.toLowerCase());
    return {
      key: a.key,
      address: a.address,
      symbol: a.symbol,
      decimals: a.decimals,
      dripHuman: ethers.formatUnits(l.drip, a.decimals),
      drip: l.drip.toString(),
      source: a.from,
      funding: {
        method: "preexisting",
        stocked: ethers.formatUnits(l.stock, a.decimals),
        claimsLeft: l.drip > 0n ? Number(l.stock / l.drip) : 0,
        note: "listed and stocked by another script — read back from the chain, not funded by this run",
      },
    };
  });

  /*
   * Top-level keys this script owns. Everything else in an existing record was
   * written by a sibling — topup-faucet.js's `lastTopup`, fix-faucet-drips.js's
   * `lastDripFix`, switch-usdc-to-mock.js's `lastUsdcSwitch` — and dropping them
   * would make an extend look like it undid work those scripts did. `timestamp`
   * is when the faucet was deployed and stays that; an extend adds `extendedAt`.
   */
  const OWNED_KEYS = [
    "network",
    "chainId",
    "deployer",
    "timestamp",
    "extendedAt",
    "contracts",
    "config",
    "sources",
  ];
  const foreignKeys = extend
    ? Object.fromEntries(
        Object.entries(previous).filter(([k]) => !OWNED_KEYS.includes(k))
      )
    : {};
  const now = new Date().toISOString();

  const record = {
    network: net,
    chainId,
    deployer: deployer.address,
    timestamp: extend ? previous.timestamp ?? now : now,
    ...(extend ? { extendedAt: now } : {}),
    contracts: { faucet: faucetAddress },
    config: {
      cooldownSeconds: extend
        ? previous.config?.cooldownSeconds ?? cooldown
        : cooldown,
      assets: [
        ...carried,
        ...reconciled,
        ...listed.map((a) => ({
          key: a.key,
          address: a.address,
          symbol: a.symbol,
          decimals: a.decimals,
          dripHuman: ethers.formatUnits(a.drip, a.decimals),
          drip: a.drip.toString(),
          source: a.from,
          funding: funding[a.key],
        })),
      ],
    },
    sources: {
      stablecoin: needsStable ? `deployment-stablecoin-${net}.json` : null,
      dex: needsDex ? `deployment-dex-${net}.json` : null,
      ...(needsKld ? { kld: `deployment-kld-${net}.json` } : {}),
    },
    ...foreignKeys,
  };
  fs.writeFileSync(outName, JSON.stringify(record, null, 2));

  console.log("\n============================================================");
  console.log("FAUCET SUMMARY");
  console.log("============================================================");
  console.log(`  address   ${faucetAddress}`);
  console.log(`  cooldown  ${record.config.cooldownSeconds}s`);
  const shortfalls = [];
  for (const a of listed) {
    const f = funding[a.key];
    console.log(
      `  ${a.symbol.padEnd(7)} drip ${ethers.formatUnits(a.drip, a.decimals)}` +
        `  stocked ${f.amount} of ${f.target} (${f.method})`
    );
    if (f.short) shortfalls.push(`${f.short} ${a.symbol}`);
  }
  for (const a of reconciled) {
    console.log(
      `  ${a.symbol.padEnd(7)} drip ${a.dripHuman}  stocked ${
        a.funding.stocked
      } (${a.funding.claimsLeft} claims left, recorded not funded)`
    );
  }
  if (shortfalls.length > 0) {
    console.log(
      `\n  Short of target, send to ${faucetAddress} to top up:\n    ` +
        shortfalls.join("\n    ")
    );
    console.log(
      "  Nothing is broken by this — a short asset is listed and simply reads " +
        "\n  as empty on /faucet until it has stock."
    );
  }
  if (blocked.length > 0) {
    console.log(
      `\n  Not listed: ${blocked
        .map((a) => a.symbol)
        .join(", ")} — this faucet's bytecode cannot pay ` +
        "\n  native gas (see above). The row would revert on claim, so it is left off."
    );
  }
  if (extend) {
    console.log(
      `\nSaved ${outName}. The faucet address is unchanged, so no ` +
        "`npm run gen:registry` is\nneeded — the registry carries the address, " +
        "not the asset list, which /faucet\nreads live from the contract."
    );
  } else {
    console.log(
      `\nSaved ${outName}. Now run \`npm run gen:registry\` from the repo root so ` +
        `\nDEPLOYMENTS[${chainId}].faucet carries this address — /faucet and Luca's ` +
        "\nclaimTestTokens tool both read it from there, not from an env var."
    );
  }
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
