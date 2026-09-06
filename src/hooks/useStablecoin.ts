"use client";

import { useState, useEffect } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { toast } from "sonner";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { ethers, MaxUint256 } from "ethers";
import erc20Abi from "@/abi/ERC20Abi.json";
import kfUSDAbi from "@/contracts/kfUSD.json";
import kafUSDAbi from "@/contracts/kafUSD.json";
import yieldTreasuryAbi from "@/contracts/YieldTreasury.json";
import {
  MOCK_DATA,
  MOCK_STABLE_BALANCES,
  MOCK_STABLE_IDLE,
  MOCK_STABLE_REWARDS,
  MOCK_STABLE_STATS,
  MOCK_STABLE_WITHDRAWAL,
} from "@/lib/mock";

// The address table moved to src/constants/registry.ts and became per-chain:
// stableContracts(chainId) projects it out of DEPLOYMENTS. It had to leave this
// file because of the "use client" directive above it — a route handler
// importing it from here would pull thirdweb/react and sonner into the server
// bundle, and the shared intent builder needs these addresses on both sides.
//
// No longer re-exported. There is nothing chain-independent left to re-export:
// the old flat STABLE_CONTRACTS was Abstract-testnet only, so every consumer
// now has to say which chain it means.
import { stableContracts } from "@/constants/registry";

/** The six keys stableContracts() projects, for indexing it by a form value. */
type StableKey = keyof ReturnType<typeof stableContracts>;

export interface TokenBalance {
  USDC: string;
  USDT: string;
  USDe: string;
  kfUSD: string;
  kafUSD: string;
}

export interface StableStats {
  /**
   * Total kfUSD minted, as a currency string with its "$" and separators —
   * "$2,530,118.40".
   *
   * Null when unread, for the same reason as the four fields below it: a failed
   * read is not a measurement of zero. This one and `totalStableDeposited` have
   * no view consumer today; they are nulled with the rest so that whoever wires
   * one up inherits the distinction rather than a "0" that reads as fact.
   */
  tvl: string | null;
  /** Collateral summed at par, "$"-prefixed as `tvl` is. Null as for `tvl`. */
  totalStableDeposited: string | null;
  /**
   * kfUSD outstanding, grouped but with **no** "$" — it is a token count, not a
   * dollar amount, so the prefix belongs to whichever view wants one.
   *
   * Null when unread. This was seeded "0" while `backingRatio` beside it was
   * null, so a failed read put a confident "Supply $0.00" next to "Backing —"
   * in the same strip, and the reader could not tell "the supply is zero" from
   * "we could not read the supply" — the exact ambiguity the nullable fields
   * were introduced to remove. Zero supply is a real and reachable state of
   * this protocol (it is where it starts), which is precisely why it must not
   * share a representation with a failure.
   */
  kfUSDSupply: string | null;
  /**
   * Collateral as a percent of kfUSD outstanding — "100", never "100%".
   *
   * Was the literal string "100%", with a comment saying to calculate it from
   * total collateral over supply. So the peg header asserted full backing
   * unconditionally, including on an under-collateralised or empty protocol,
   * and the two call sites that appended their own "%" rendered "100%%".
   * Null when supply is zero, where the ratio is undefined rather than perfect.
   */
  backingRatio: string | null;
  /**
   * Trailing yield rate as a bare number of percent — "7.42", never "7.42%".
   *
   * Null when it has not been read yet, or when there is not enough history to
   * annualise honestly. Both consumers previously appended their own "%" to a
   * string that already carried one and rendered "5.00%%"; the suffix now
   * belongs to the view, and null is the signal to render a dash instead of a
   * number nobody measured.
   */
  totalYieldAPY: string | null;
  /**
   * Live kfUSD mint fee as a percent string — 5 bps arrives as "0.05".
   *
   * Nullable because these were previously seeded to "0" and nothing consumed
   * them, so the mint and redeem forms hardcoded "None" and a 1:1 rate. A zero
   * that means "not read yet" is indistinguishable from a genuinely free mint,
   * and the form has to be able to tell those apart before it can quote a
   * number at all.
   */
  mintFee: string | null;
  /** Live kfUSD redeem fee as a percent string. Null as for mintFee. */
  redeemFee: string | null;
}

export interface WithdrawalInfo {
  hasWithdrawal: boolean;
  unlockTime: string; // Formatted as "5d 12h 30m" or "0" if no withdrawal
  /**
   * The kafUSD recorded by requestWithdrawal, formatted; "0" when none.
   *
   * completeWithdrawal takes no amount — it burns withdrawalAmount[msg.sender]
   * (kafUSD.sol:166). So once a request exists this is the only amount that can
   * come out, whatever the form happens to have in it.
   */
  pendingAmount: string;
  /**
   * Whether completeWithdrawal would clear its cooldown require. This was
   * previously carried by `unlockTime === "Ready"`, which left the page matching
   * a display string to decide whether a transaction was legal.
   */
  isReady: boolean;
  /**
   * kfUSD this address has locked, formatted — assetLockBalances[user][kfUSD].
   *
   * completeWithdrawal requires this to cover the requested amount
   * (kafUSD.sol:185), and kafUSD is a plain transferable ERC20, so a balance can
   * exceed what its holder actually locked. Requesting against the balance alone
   * queues a withdrawal that can never complete, however long the notice runs.
   */
  lockedAmount: string;
}

export interface RewardToken {
  symbol: string;
  amount: string;
  valueUSD: string;
}

export interface UserRewards {
  totalRewards: string; // Formatted as "$X.XX"
  breakdown: RewardToken[];
}

/** "5d 12h 30m" from a millisecond span. Floors, so it never over-promises. */
const formatDuration = (ms: number) => {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${days}d ${hours}h ${minutes}m`;
};

export function useStablecoin() {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const [balances, setBalances] = useState<TokenBalance>({
    USDC: "0",
    USDT: "0",
    USDe: "0",
    kfUSD: "0",
    kafUSD: "0",
  });
  /* Every field null, because nothing has been read yet. The three figures used
     to open at "0", which meant the strip rendered a complete, confident set of
     zeroes for the whole of the first paint and then replaced them — indist-
     inguishable, while it lasted, from a protocol with nothing in it. */
  const [stats, setStats] = useState<StableStats>({
    tvl: null,
    totalStableDeposited: null,
    kfUSDSupply: null,
    backingRatio: null,
    totalYieldAPY: null,
    mintFee: null,
    redeemFee: null,
  });
  const [withdrawalInfo, setWithdrawalInfo] = useState<WithdrawalInfo>({
    hasWithdrawal: false,
    unlockTime: "7d 0h 0m",
    pendingAmount: "0",
    isReady: false,
    lockedAmount: "0",
  });
  const [userRewards, setUserRewards] = useState<UserRewards>({
    totalRewards: "$0.00",
    breakdown: [],
  });
  const [idleBalances, setIdleBalances] = useState({
    USDC: "0",
    USDT: "0",
    USDe: "0",
  });
  const [isLoading, setIsLoading] = useState(false);

  /**
   * The six addresses this hook needs on the wallet's chain, or null when the
   * stablecoin is not deployed there.
   *
   * Every field of stableContracts() is `string | undefined` — a chain without a
   * deployment reports undefined rather than a stale Abstract address — so the
   * narrowing has to happen somewhere, and doing it once per call beats a
   * non-null assertion at each of the thirty-odd use sites.
   *
   * All six or none, checked together, because that is how they ship: kfUSD is
   * deployed alongside kafUSD, the YieldTreasury and its three collateral mocks
   * in one script, and all five deployed chains carry all six. So this returning
   * null means "not on this chain", never "half-configured" — and each caller
   * turns that into the same unknown/empty state it already shows for a failed
   * read, rather than a zero that reads as a measurement.
   */
  const stableAddresses = (): Record<StableKey, string> | null => {
    const { USDC, USDT, USDe, kfUSD, kafUSD, YieldTreasury } = stableContracts(
      activeChain?.id,
    );
    if (!USDC || !USDT || !USDe || !kfUSD || !kafUSD || !YieldTreasury) {
      return null;
    }
    return { USDC, USDT, USDe, kfUSD, kafUSD, YieldTreasury };
  };

  /** Shared by the seven write actions: no addresses means nothing to sign. */
  const requireAddresses = (): Record<StableKey, string> | null => {
    const a = stableAddresses();
    if (!a) {
      toast.error("kfUSD isn't available on this network");
      return null;
    }
    return a;
  };

  // Get ethers signer
  const getSigner = async () => {
    if (!activeChain || !activeAccount) {
      throw new Error("Chain or account not available");
    }

    // Use thirdweb's ethers6Adapter instead of creating new provider
    const signer = ethers6Adapter.signer.toEthers({
      client,
      chain: activeChain,
      account: activeAccount,
    });

    if (!signer) {
      throw new Error("Signer not available");
    }
    return signer;
  };

  // Fetch balances
  const fetchBalances = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      return;
    }

    /*
     * Demo mode, once per fetcher rather than once in the effect below.
     *
     * Every read here is re-run after a write and, for the withdrawal notice,
     * once a minute by an interval — so a single seam in the mount effect would
     * be overwritten by the first refetch and the page would quietly empty out
     * a minute after loading. Branching inside each fetcher covers all three
     * entry points.
     *
     * Deliberately after the wallet guard, so a disconnected visitor still sees
     * the real zeroes and the real empty states. Delete with src/lib/mock.
     */
    if (MOCK_DATA) {
      setBalances(MOCK_STABLE_BALANCES);
      return;
    }

    /* Not deployed on this chain: the real balances are zero, and saying so is
     * a measurement rather than a guess. No toast — switching to a chain the
     * stablecoin is not on is a navigation, not an error. */
    const a = stableAddresses();
    if (!a) {
      setBalances({ USDC: "0", USDT: "0", USDe: "0", kfUSD: "0", kafUSD: "0" });
      return;
    }

    try {
      setIsLoading(true);
      const signer = await getSigner();

      // Helper function to get ERC20 balance
      const getBalance = async (
        tokenAddress: string,
        decimals: number = 18,
      ) => {
        const contract = new ethers.Contract(tokenAddress, erc20Abi, signer);
        const balance = await contract.balanceOf(activeAccount!.address!);
        return ethers.formatUnits(balance, decimals);
      };

      // Fetch all balances
      const [usdcBal, usdtBal, usdeBal, kfusdBal, kafusdBal] =
        await Promise.all([
          getBalance(a.USDC, 6),
          getBalance(a.USDT, 6),
          getBalance(a.USDe, 18),
          getBalance(a.kfUSD, 18),
          getBalance(a.kafUSD, 18),
        ]);

      setBalances({
        USDC: usdcBal,
        USDT: usdtBal,
        USDe: usdeBal,
        kfUSD: kfusdBal,
        kafUSD: kafusdBal,
      });
    } catch (error) {
      console.error("Error fetching balances:", error);
      toast.error("Failed to fetch balances");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch user rewards (total yield earned - actual claimable amount)
  const fetchUserRewards = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      setUserRewards({ totalRewards: "$0.00", breakdown: [] });
      return;
    }

    /* Demo mode — see fetchBalances. Delete with src/lib/mock. */
    if (MOCK_DATA) {
      setUserRewards(MOCK_STABLE_REWARDS);
      return;
    }

    /* No YieldTreasury on this chain means no yield to claim — an empty
     * breakdown, which is what this already shows for a wallet with none. */
    const a = stableAddresses();
    if (!a) {
      setUserRewards({ totalRewards: "$0.00", breakdown: [] });
      return;
    }

    try {
      const signer = await getSigner();
      const yieldTreasuryContract = new ethers.Contract(
        a.YieldTreasury,
        yieldTreasuryAbi.abi,
        signer,
      );

      // Get total user yield across all assets
      // calculateTotalUserYield returns (address[] assets, uint256[] amounts)
      const [assets, amounts] = await yieldTreasuryContract
        .calculateTotalUserYield(activeAccount.address)
        .catch(() => [[], []]);

      // Calculate total USD value and collect breakdown
      let totalYieldValue = 0;
      const rewardBreakdown: RewardToken[] = [];

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const amount = amounts[i];

        if (amount === BigInt(0)) continue;

        // Find token symbol and decimals
        let symbol = "UNKNOWN";
        let decimals = 18;

        // Check this chain's stablecoin addresses first for common tokens
        for (const [key, value] of Object.entries(a)) {
          if (value.toLowerCase() === asset.toLowerCase()) {
            symbol = key;
            break;
          }
        }

        try {
          const assetContract = new ethers.Contract(asset, erc20Abi, signer);
          if (symbol === "UNKNOWN") {
            symbol = await assetContract.symbol().catch(() => "???");
          }
          decimals = await assetContract.decimals().catch(() => 18);
        } catch (error) {
          console.error(`Error fetching info for asset ${asset}:`, error);
        }

        const amountNum = parseFloat(ethers.formatUnits(amount, decimals));
        totalYieldValue += amountNum;

        rewardBreakdown.push({
          symbol,
          amount: amountNum.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          }),
          valueUSD: amountNum.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          }),
        });
      }

      // Format as currency
      const formattedRewards = totalYieldValue.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      setUserRewards({
        totalRewards: formattedRewards,
        breakdown: rewardBreakdown,
      });
    } catch (error) {
      console.error("Error fetching user rewards:", error);
      setUserRewards({ totalRewards: "$0.00", breakdown: [] });
    }
  };

  // Fetch withdrawal info (unlock time)
  const fetchWithdrawalInfo = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      setWithdrawalInfo({
        hasWithdrawal: false,
        unlockTime: "Anytime",
        pendingAmount: "0",
        isReady: false,
        lockedAmount: "0",
      });
      return;
    }

    /* Demo mode — see fetchBalances. `unlockTime` is a fixed string rather than
     * a countdown for the usual reason: nothing here may derive from the clock.
     * Delete with src/lib/mock. */
    if (MOCK_DATA) {
      setWithdrawalInfo(MOCK_STABLE_WITHDRAWAL);
      return;
    }

    /* No kafUSD here, so there is no queue to be in and nothing locked. Matches
     * the disconnected-wallet state above rather than inventing a cooldown. */
    const a = stableAddresses();
    if (!a) {
      setWithdrawalInfo({
        hasWithdrawal: false,
        unlockTime: "Anytime",
        pendingAmount: "0",
        isReady: false,
        lockedAmount: "0",
      });
      return;
    }

    try {
      const signer = await getSigner();
      const kafUSDContract = new ethers.Contract(
        a.kafUSD,
        kafUSDAbi.abi,
        signer,
      );

      // Fetch withdrawal request time and cooldown period. getUserAssetBalance
      // is the ceiling completeWithdrawal enforces — see WithdrawalInfo above.
      const [
        withdrawalRequestTime,
        cooldownPeriod,
        withdrawalAmount,
        lockedBalance,
      ] = await Promise.all([
        kafUSDContract.withdrawalRequestTime(activeAccount.address),
        kafUSDContract.cooldownPeriod(),
        kafUSDContract.withdrawalAmount(activeAccount.address),
        kafUSDContract.getUserAssetBalance(activeAccount.address, a.kfUSD),
      ]);

      // Timestamps are small enough to narrow to Number without loss.
      const requestTimeNum = Number(withdrawalRequestTime);
      const cooldownNum = Number(cooldownPeriod);

      // The amounts stay BigInt — they're 18-decimal wei.
      const zero = 0n;
      const hasWithdrawal =
        BigInt(withdrawalAmount) > zero && BigInt(withdrawalRequestTime) > zero;
      const pendingAmount = ethers.formatUnits(withdrawalAmount, 18);
      const lockedAmount = ethers.formatUnits(lockedBalance, 18);

      if (!hasWithdrawal) {
        // No withdrawal request yet — show the notice a request would start.
        setWithdrawalInfo({
          hasWithdrawal: false,
          unlockTime: formatDuration(cooldownNum * 1000),
          pendingAmount,
          isReady: false,
          lockedAmount,
        });
        return;
      }

      // Calculate unlock time: withdrawalRequestTime + cooldownPeriod
      // Contract returns timestamps in seconds, convert to milliseconds for JavaScript
      const unlockTimeMs = requestTimeNum * 1000 + cooldownNum * 1000;
      const timeLeft = unlockTimeMs - Date.now();

      setWithdrawalInfo({
        hasWithdrawal: true,
        unlockTime: timeLeft <= 0 ? "Ready" : formatDuration(timeLeft),
        pendingAmount,
        isReady: timeLeft <= 0,
        lockedAmount,
      });
    } catch (error) {
      console.error("Error fetching withdrawal info:", error);
      setWithdrawalInfo({
        hasWithdrawal: false,
        unlockTime: "Anytime",
        pendingAmount: "0",
        isReady: false,
        lockedAmount: "0",
      });
    }
  };

  // Fetch idle balances for redemption liquidity check
  const fetchIdleBalances = async () => {
    if (!activeAccount?.address || !activeChain?.id) {
      setIdleBalances({ USDC: "0", USDT: "0", USDe: "0" });
      return;
    }

    /* Demo mode — see fetchBalances. USDT sits at "0.0" on purpose: the redeem
     * form has to be able to tell an illiquid output token from a liquid one.
     * Delete with src/lib/mock. */
    if (MOCK_DATA) {
      setIdleBalances(MOCK_STABLE_IDLE);
      return;
    }

    /* No kfUSD vault on this chain, so there is no idle liquidity to redeem
     * against — the same zeroes the failed-read path below reports. */
    const a = stableAddresses();
    if (!a) {
      setIdleBalances({ USDC: "0", USDT: "0", USDe: "0" });
      return;
    }

    try {
      const signer = await getSigner();
      const kfUSDContract = new ethers.Contract(a.kfUSD, kfUSDAbi.abi, signer);

      const [usdcBalances, usdtBalances, usdeBalances] = await Promise.all([
        kfUSDContract.getBalances(a.USDC),
        kfUSDContract.getBalances(a.USDT),
        kfUSDContract.getBalances(a.USDe),
      ]);

      setIdleBalances({
        USDC: ethers.formatUnits(usdcBalances[0], 6), // USDC has 6 decimals
        USDT: ethers.formatUnits(usdtBalances[0], 6), // USDT has 6 decimals
        USDe: ethers.formatUnits(usdeBalances[0], 18), // USDe has 18 decimals
      });
    } catch (error) {
      console.error("Error fetching idle balances:", error);
      setIdleBalances({ USDC: "0", USDT: "0", USDe: "0" });
    }
  };

  // Fetch stats
  const fetchStats = async () => {
    if (!activeAccount?.address || !activeChain?.id) return;

    /* Demo mode — see fetchBalances. Delete with src/lib/mock. */
    if (MOCK_DATA) {
      setStats(MOCK_STABLE_STATS);
      return;
    }

    /* Nulls, not zeroes, exactly as the catch below does: on a chain with no
     * deployment there is nothing here to measure. Quoting a 0% mint fee would
     * tell the user their mint is free when there is no mint at all, and a "0"
     * supply would assert that no kfUSD exists — false, since it exists on the
     * chains that do have a deployment. This branch said as much already while
     * still seeding the three figures to "0"; now it means it. */
    const a = stableAddresses();
    if (!a) {
      setStats({
        tvl: null,
        totalStableDeposited: null,
        kfUSDSupply: null,
        backingRatio: null,
        totalYieldAPY: null,
        mintFee: null,
        redeemFee: null,
      });
      return;
    }

    try {
      const signer = await getSigner();

      const kfUSDContract = new ethers.Contract(a.kfUSD, kfUSDAbi.abi, signer);
      const kafUSDContract = new ethers.Contract(
        a.kafUSD,
        kafUSDAbi.abi,
        signer,
      );
      const yieldTreasuryContract = new ethers.Contract(
        a.YieldTreasury,
        yieldTreasuryAbi.abi,
        signer,
      );

      // Fetch all stats from contracts
      const [
        kfUSDTotalSupply,
        totalMinted,
        usdcCollateral,
        usdtCollateral,
        usdeCollateral,
        kafUSDTotalSupply,
        mintFee,
        redeemFee,
      ] = await Promise.all([
        kfUSDContract.totalSupply(),
        kfUSDContract.totalMinted(),
        kfUSDContract.collateralBalances(a.USDC),
        kfUSDContract.collateralBalances(a.USDT),
        kfUSDContract.collateralBalances(a.USDe),
        kafUSDContract.totalSupply(),
        kfUSDContract.mintFee(),
        kfUSDContract.redeemFee(),
      ]);

      /**
       * Trailing yield rate, measured rather than projected.
       *
       * What stood here was a projection assembled entirely from constants
       * invented at the keyboard: a $100,000 daily DEX volume, an 8% farming
       * APY, an assumption that half the collateral was deployed and that
       * monthly mint volume equalled total supply. It then clamped the result
       * with Math.max(5.0, ...), so the earn page advertised at least 5% APY
       * whatever the chain said — including on an empty protocol, where every
       * input to the projection was zero and the output was still 5%.
       *
       * The honest figure is what YieldTreasury has actually distributed, over
       * the window it has been distributing for:
       *
       *   rate = (cumulative yield / kafUSD supply) * (1 year / elapsed)
       *
       * Two limits here are deliberate rather than papered over. Only yield
       * paid in assets this hook can value at par is counted, because there is
       * no oracle in it and pricing a KLD reward at $1 would be the same class
       * of invention as the constants above. And nothing is annualised until a
       * week has accrued, because extrapolating a two-day window by 182 carries
       * no information. Below either bar this stays null and the UI shows a dash
       * rather than a promise.
       */
      let measuredAPY: number | null = null;
      try {
        const kafUSDSupplyNum = parseFloat(
          ethers.formatUnits(kafUSDTotalSupply, 18),
        );

        const supportedAssets: string[] = await yieldTreasuryContract
          .getSupportedYieldAssets()
          .catch(() => []);

        /* Assets valued at $1 with their decimals. Membership is the price
         * feed: an asset absent from here is skipped, not guessed at. */
        const parDecimals: Record<string, number> = {
          [a.USDC.toLowerCase()]: 6,
          [a.USDT.toLowerCase()]: 6,
          [a.USDe.toLowerCase()]: 18,
          [a.kfUSD.toLowerCase()]: 18,
        };

        let cumulativeYieldUSD = 0;
        /* Unix seconds of the earliest first-yield across assets, so the window
         * spans the whole distribution history rather than the newest asset. */
        let windowStart = 0;

        for (const asset of supportedAssets) {
          const decimals = parDecimals[asset.toLowerCase()];
          if (decimals === undefined) continue;

          try {
            const [cumulative, firstAt] = await Promise.all([
              yieldTreasuryContract.totalYieldPerAsset(asset),
              yieldTreasuryContract.firstYieldTimestamp(asset),
            ]);
            if (cumulative === BigInt(0) || firstAt === BigInt(0)) continue;

            cumulativeYieldUSD += parseFloat(
              ethers.formatUnits(cumulative, decimals),
            );
            const startedAt = Number(firstAt);
            if (windowStart === 0 || startedAt < windowStart) {
              windowStart = startedAt;
            }
          } catch (error) {
            console.error(`[stable] yield history for ${asset}:`, error);
          }
        }

        const secondsPerYear = 365 * 24 * 60 * 60;
        const minWindow = 7 * 24 * 60 * 60;
        const elapsed =
          windowStart === 0 ? 0 : Math.floor(Date.now() / 1000) - windowStart;

        if (
          kafUSDSupplyNum > 0 &&
          cumulativeYieldUSD > 0 &&
          elapsed >= minWindow
        ) {
          measuredAPY =
            (cumulativeYieldUSD / kafUSDSupplyNum) *
            (secondsPerYear / elapsed) *
            100;
        }
      } catch (error) {
        /* Unreadable history is unknown, not zero and not 5%. */
        console.error(
          "Error measuring the yield rate from YieldTreasury:",
          error,
        );
      }

      const kfSupplyRaw = ethers.formatUnits(kfUSDTotalSupply, 18);
      const kfSupplyNum = parseFloat(kfSupplyRaw);
      const totalMintedRaw = ethers.formatUnits(totalMinted, 18);
      const totalCollateralRaw =
        parseFloat(ethers.formatUnits(usdcCollateral, 6)) +
        parseFloat(ethers.formatUnits(usdtCollateral, 6)) +
        parseFloat(ethers.formatUnits(usdeCollateral, 18));

      // Format values
      const kfSupply = kfSupplyNum.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const totalStableDeposited = parseFloat(
        totalCollateralRaw.toString(),
      ).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const tvl = parseFloat(totalMintedRaw).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      const newStats: StableStats = {
        tvl: `$${tvl}`, // Total Value Locked = totalMinted
        totalStableDeposited: `$${totalStableDeposited}`, // Sum of all collateral deposits
        kfUSDSupply: kfSupply, // Current kfUSD total supply
        /* Measured, not asserted. Collateral is summed at par above, so this is
         * collateral USD over kfUSD outstanding. Undefined on zero supply. */
        backingRatio:
          kfSupplyNum > 0
            ? ((totalCollateralRaw / kfSupplyNum) * 100).toFixed(2)
            : null,
        // Bare number; the "%" is the view's. Null when unmeasurable.
        totalYieldAPY: measuredAPY === null ? null : measuredAPY.toFixed(2),
        mintFee: (Number(mintFee) / 100).toString(),
        redeemFee: (Number(redeemFee) / 100).toString(),
      };

      setStats(newStats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      /* Nulls, not zeroes — every field, which is what this block used to say
       * while setting three of them to "0". A failed read leaves the supply, the
       * two totals, both fees, the backing ratio and the yield rate all unknown.
       * Quoting either fee as 0 would have the mint form tell the user their mint
       * is free when it is not, and a "$0.00" supply beside a dashed backing
       * ratio is a figure the reader has no way to distrust. */
      setStats({
        tvl: null,
        totalStableDeposited: null,
        kfUSDSupply: null,
        backingRatio: null,
        totalYieldAPY: null,
        mintFee: null,
        redeemFee: null,
      });
    }
  };

  // Mint kfUSD
  const mintKfUSD = async (collateralToken: string, amount: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const a = requireAddresses();
    if (!a) return;

    const toastId = toast.loading("Processing mint transaction...");

    try {
      const signer = await getSigner();
      const collateralAddress: string | undefined =
        a[collateralToken as StableKey];

      if (!collateralAddress) {
        throw new Error(`Invalid collateral token: ${collateralToken}`);
      }

      // Get collateral and kfUSD contracts
      const collateralContract = new ethers.Contract(
        collateralAddress,
        erc20Abi,
        signer,
      );
      const kfUSDContract = new ethers.Contract(a.kfUSD, kfUSDAbi.abi, signer);

      // Parse amounts
      const collateralDecimals =
        collateralToken === "USDT" || collateralToken === "USDC" ? 6 : 18;
      const collateralAmount = ethers.parseUnits(amount, collateralDecimals);

      // Approve collateral
      const allowance = await collateralContract.allowance(
        activeAccount.address,
        a.kfUSD,
      );
      if (allowance < collateralAmount) {
        const approveTx = await collateralContract.approve(
          a.kfUSD,
          collateralAmount,
        );
        await approveTx.wait();
      }

      /* mintWithCollateral, not mint. The four-argument mint takes the kfUSD
       * amount as its own parameter and is onlyRole(MINTER_ROLE) precisely
       * because a caller who set both amounts could mint kfUSD the collateral
       * does not back — so it reverts for every ordinary wallet, which is what
       * left the whole Stable section unusable. This permissionless entry point
       * names only the collateral and derives the kfUSD at par on-chain (see
       * kfUSD.sol), so the amount the form quoted and the amount minted are the
       * same 1:1 the contract can honour on redeem. */
      const mintTx = await kfUSDContract.mintWithCollateral(
        collateralAddress,
        collateralAmount,
      );
      const receipt = await mintTx.wait();

      if (receipt.status) {
        toast.success("Successfully minted kfUSD!", { id: toastId });
        await fetchBalances();
        await fetchStats();
      }
    } catch (error: any) {
      console.error("Error minting kfUSD:", error);
      toast.error(error.message || "Failed to mint kfUSD", { id: toastId });
      throw error;
    }
  };

  // Redeem kfUSD
  const redeemKfUSD = async (amount: string, outputToken: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const a = requireAddresses();
    if (!a) return;

    const toastId = toast.loading("Processing redeem transaction...");

    try {
      const signer = await getSigner();
      const outputAddress: string | undefined = a[outputToken as StableKey];

      if (!outputAddress) {
        throw new Error(`Invalid output token: ${outputToken}`);
      }

      const kfUSDContract = new ethers.Contract(a.kfUSD, kfUSDAbi.abi, signer);
      const kfUSDAmount = ethers.parseUnits(amount, 18);

      // Approve kfUSD for redemption
      const allowance = await kfUSDContract.allowance(
        activeAccount.address,
        a.kfUSD,
      );
      if (allowance < kfUSDAmount) {
        const approveTx = await kfUSDContract.approve(a.kfUSD, kfUSDAmount);
        await approveTx.wait();
      }

      // Redeem kfUSD
      const redeemTx = await kfUSDContract.redeem(kfUSDAmount, outputAddress);
      const receipt = await redeemTx.wait();

      if (receipt.status) {
        toast.success("Successfully redeemed kfUSD!", { id: toastId });
        await fetchBalances();
        await fetchStats();
        return true;
      }
      return false;
    } catch (error: any) {
      console.error("Error redeeming kfUSD:", error);
      toast.error(error.message || "Failed to redeem kfUSD", { id: toastId });
      throw error;
    }
  };

  // Lock assets for kafUSD
  const lockAssets = async (assetToken: string, amount: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const a = requireAddresses();
    if (!a) return;

    const toastId = toast.loading("Processing lock transaction...");

    try {
      const signer = await getSigner();
      const assetAddress: string | undefined = a[assetToken as StableKey];

      if (!assetAddress) {
        throw new Error(`Invalid asset token: ${assetToken}`);
      }

      const kafUSDContract = new ethers.Contract(
        a.kafUSD,
        kafUSDAbi.abi,
        signer,
      );
      const assetContract = new ethers.Contract(assetAddress, erc20Abi, signer);
      // USDC and USDT have 6 decimals, USDe has 18 decimals
      const assetDecimals =
        assetToken === "USDT" || assetToken === "USDC" ? 6 : 18;
      const assetAmount = ethers.parseUnits(amount, assetDecimals);

      // Approve asset
      const allowance = await assetContract.allowance(
        activeAccount.address,
        a.kafUSD,
      );
      if (allowance < assetAmount) {
        const approveTx = await assetContract.approve(a.kafUSD, assetAmount);
        await approveTx.wait();
      }

      // Lock assets to kafUSD
      const lockTx = await kafUSDContract.lockAssets(assetAddress, assetAmount);
      const receipt = await lockTx.wait();

      if (receipt.status) {
        toast.success("Successfully locked assets!", { id: toastId });
        await fetchBalances();
        await fetchStats();
        await fetchUserRewards(); // Update rewards after locking
      }
    } catch (error: any) {
      console.error("Error locking assets:", error);
      toast.error(error.message || "Failed to lock assets", { id: toastId });
      throw error;
    }
  };

  // Request withdrawal from vault (initiates cooldown)
  //
  // The asset is named at request time now — the vault fixes the payout asset
  // when the request is made, not when it completes (kafUSD.sol requestWithdrawal).
  // This page only ever locks and withdraws kfUSD, so kfUSD is what it requests.
  const requestWithdrawal = async (amount: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const a = requireAddresses();
    if (!a) return;

    const toastId = toast.loading("Requesting withdrawal...");

    try {
      const signer = await getSigner();
      const kafUSDContract = new ethers.Contract(
        a.kafUSD,
        kafUSDAbi.abi,
        signer,
      );
      const kafUSDAmount = ethers.parseUnits(amount, 18);

      const requestTx = await kafUSDContract.requestWithdrawal(
        a.kfUSD,
        kafUSDAmount,
      );
      const receipt = await requestTx.wait();

      if (receipt.status) {
        toast.success(
          "Withdrawal requested! Please wait for the 7-day cooldown period.",
          { id: toastId },
        );
        await fetchBalances();
        await fetchWithdrawalInfo(); // Update withdrawal info after requesting
        await fetchUserRewards(); // Update rewards after requesting withdrawal
      }
    } catch (error: any) {
      console.error("Error requesting withdrawal:", error);
      toast.error(error.message || "Failed to request withdrawal", {
        id: toastId,
      });
      throw error;
    }
  };

  // Complete withdrawal after cooldown period.
  //
  // Takes no payout token any more — the vault pays out in the asset fixed at
  // request time (kafUSD.sol completeWithdrawal). The optional argument is kept
  // so existing callers that pass a symbol still type-check; it is not sent.
  const completeWithdrawal = async (_outputToken?: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const a = requireAddresses();
    if (!a) return;

    const toastId = toast.loading("Completing withdrawal...");

    try {
      const signer = await getSigner();

      const kafUSDContract = new ethers.Contract(
        a.kafUSD,
        kafUSDAbi.abi,
        signer,
      );
      const completeTx = await kafUSDContract.completeWithdrawal();
      const receipt = await completeTx.wait();

      if (receipt.status) {
        toast.success("Withdrawal completed successfully!", { id: toastId });
        await fetchBalances();
        await fetchStats();
        await fetchWithdrawalInfo(); // Update withdrawal info after completing
        await fetchUserRewards(); // Update rewards after completing withdrawal
      }
    } catch (error: any) {
      console.error("Error completing withdrawal:", error);
      toast.error(error.message || "Failed to complete withdrawal", {
        id: toastId,
      });
      throw error;
    }
  };

  // Claim yield without withdrawing
  const claimYield = async (assetToken: string) => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const a = requireAddresses();
    if (!a) return;

    const toastId = toast.loading(
      assetToken === "ALL" ? "Claiming all yield..." : "Claiming yield...",
    );

    try {
      const signer = await getSigner();
      const yieldTreasuryContract = new ethers.Contract(
        a.YieldTreasury,
        yieldTreasuryAbi.abi,
        signer,
      );

      let claimTx;
      if (assetToken === "ALL") {
        claimTx = await yieldTreasuryContract.claimAllYield();
      } else {
        const assetAddress: string | undefined = a[assetToken as StableKey];
        if (!assetAddress) {
          throw new Error(`Invalid asset token: ${assetToken}`);
        }
        claimTx = await yieldTreasuryContract.claimYield(assetAddress);
      }

      const receipt = await claimTx.wait();

      if (receipt.status) {
        toast.success(
          assetToken === "ALL"
            ? "All yield claimed successfully!"
            : "Yield claimed successfully!",
          { id: toastId },
        );
        await fetchBalances();
        await fetchStats();
        await fetchUserRewards(); // Update rewards after claiming
      }
    } catch (error: any) {
      console.error("Error claiming yield:", error);
      toast.error(error.message || "Failed to claim yield", { id: toastId });
      throw error;
    }
  };

  // Claim and compound yield (claims kfUSD yield from YieldTreasury)
  const claimAndCompound = async () => {
    if (!activeAccount?.address || !activeChain) {
      toast.error("Please connect your wallet");
      return;
    }

    const a = requireAddresses();
    if (!a) return;

    const toastId = toast.loading("Claiming and compounding yield...");

    try {
      const signer = await getSigner();
      const yieldTreasuryContract = new ethers.Contract(
        a.YieldTreasury,
        yieldTreasuryAbi.abi,
        signer,
      );

      // Claim kfUSD yield (which can then be locked in kafUSD to compound)
      const claimTx = await yieldTreasuryContract.claimAndCompound(a.kfUSD);
      const receipt = await claimTx.wait();

      if (receipt.status) {
        toast.success(
          "Yield claimed successfully! You can now lock it in kafUSD to compound.",
          { id: toastId },
        );
        await fetchBalances();
        await fetchStats();
        await fetchUserRewards(); // Update rewards after claiming
      }
    } catch (error: any) {
      console.error("Error claiming and compounding yield:", error);
      toast.error(error.message || "Failed to claim yield", { id: toastId });
      throw error;
    }
  };

  useEffect(() => {
    fetchBalances();
    fetchStats();
    fetchWithdrawalInfo();
    fetchUserRewards();
    fetchIdleBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.address, activeChain?.id]);

  // Update withdrawal info countdown every minute
  useEffect(() => {
    if (!withdrawalInfo.hasWithdrawal) return;

    const interval = setInterval(() => {
      fetchWithdrawalInfo();
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [withdrawalInfo.hasWithdrawal, activeAccount?.address, activeChain?.id]);

  return {
    balances,
    stats,
    withdrawalInfo,
    userRewards,
    idleBalances,
    isLoading,
    fetchBalances,
    fetchStats,
    fetchWithdrawalInfo,
    fetchUserRewards,
    fetchIdleBalances,
    mintKfUSD,
    redeemKfUSD,
    lockAssets,
    requestWithdrawal,
    completeWithdrawal,
    claimYield,
    claimAndCompound,
  };
}
