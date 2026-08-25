import {
  getKLDVaultContract,
  getKaleidoContract,
  getStKLDContract,
} from "@/config/contracts";
import { readOnlyProvider, READ_ONLY_CHAIN_ID } from "@/config/provider";
import {
  getContracts,
  NATIVE_SENTINEL,
  STAKING_CONTRACTS,
} from "@/constants/registry";
import { ethers } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { toast } from "sonner";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import {
  dataAtom,
  data2Atom,
  data3Atom,
  data4Atom,
  collateralValAtom,
  etherPriceAtom,
  usdcPriceAtom,
  AVAAtom,
  AVA2Atom,
  availBalAtom,
  totalPooledKLDAtom,
  userKldDepositAtom,
  totalStakersAtom,
  totalSharesAtom,
  userstKldBalanceAtom,
  timeLeftAtom,
  hasWithdrawalRequestAtom,
  totalReferralsAtom,
  AVA4Atom,
  AVA5Atom,
} from "@/constants/atom";
import { useAtom } from "jotai";
import { sendHealthFactorWarning } from "@/lib/notifications/emit";

// Extend Window interface for health factor notification flag
declare global {
  interface Window {
    __kaleido_healthfactor_warned?: boolean;
    __kaleido_last_health_warning?: number;
  }
}

/**
 * Contract health factors are PRECISION-scaled (1e18) — ProtocolFacet's
 * getHealthFactor documents a healthy position as ">= 1e18". data2 keeps the
 * raw figure because its consumers scale it themselves; only the comparisons
 * and the user-facing warning below need real units.
 */
const HEALTH_SCALE = 1e-18;

/**
 * `getUsdValue(token, 1, 0)` prices one whole token, at 18 decimals.
 *
 * The four call sites below divided by a bare 1e16, which matched the old
 * contract: getUsdValue inverted the Pyth exponent conversion and so returned
 * 10**(-2*expo) — 1e16 for the -8 feeds registered today, and something else for
 * any other exponent. ProtocolFacet._priceScaled18 now pins the scale at 1e18
 * regardless of the feed, so this is a unit rather than a coincidence.
 */
const USD_SCALE = 1e18;

/**
 * The lending tokens, on the chain whose diamond this hook actually reads.
 *
 * Every collateral and price read below goes through `getKaleidoContract(
 * readOnlyProvider, READ_ONLY_CHAIN_ID)`, but the token addresses handed to it
 * came from the flat `constants/utils/addresses` table (since deleted) —
 * Abstract-testnet literals, and Abstract is not a chain we deploy to any more.
 * Against the read chain's diamond those are simply addresses it has never heard
 * of, and the two failure modes differ:
 *
 *  - `gets_addressToCollateralDeposited` is a mapping read, so it returned 0
 *    without reverting. Every USDC, USDT and kfUSD collateral figure in the app
 *    read as zero for accounts that had deposited, and the reads *looked*
 *    successful, so nothing fell into a catch and no atom was cleared.
 *  - `getUsdValue` reverts for a token with no registered feed, so `usdcPrice`
 *    became null — and because the collateral total below refuses to publish
 *    unless every input is known, `collateralVal` was null for everyone. That is
 *    the "—" on /portfolio.
 *
 * Pinned to the read chain rather than the wallet's: the diamond is a single
 * `envVars.lendbitDiamondAddress` and the Supabase mirror tables have no chainId
 * column, so lending is single-chain by schema today. A wallet-chain address here
 * would ask the Sepolia diamond about a Base Sepolia token.
 *
 * Module-level because `getContracts` is a pure projection of a static table and
 * the read chain cannot change at runtime.
 */
const LENDING = getContracts(READ_ONLY_CHAIN_ID);

/**
 * The stKLD token this vault actually issues.
 *
 * Read off the vault rather than taken from STAKING_CONTRACTS.stKLD. The
 * vault comes from NEXT_PUBLIC_KLD_VAULT_ADDRESS, so a hardcoded token that
 * disagreed with whatever vault that env var points at would silently report a
 * different pool's balances — the same drift that left this file calling
 * functions the vault never had. Falls back to the constant when the vault has
 * no token set, since setStKLD is a post-deploy step.
 *
 * Module-level because both effects below need it: the protocol-wide one for
 * `getTotalShares`, the account-scoped one for `balanceOf`.
 */
async function resolveStKldAddress(
  vaultContract: ethers.Contract,
): Promise<string> {
  try {
    const fromVault = await vaultContract.stKLD();
    if (fromVault && fromVault !== ethers.ZeroAddress) return fromVault;
  } catch (error) {
    // Vault unreachable or not yet configured — keep the constant.
  }
  return STAKING_CONTRACTS.stKLD;
}

const useGetValueAndHealth = () => {
  const [isClient, setIsClient] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [data, setData] = useAtom(dataAtom);
  const [data3, setData3] = useAtom(data3Atom);
  const [data4, setData4] = useAtom(data4Atom);
  const [data2, setdata2] = useAtom(data2Atom);
  const [collateralVal, setCollateralVal] = useAtom(collateralValAtom);
  const [etherPrice, setEtherPrice] = useAtom(etherPriceAtom);
  const [usdcPrice, setUSDCPrice] = useAtom(usdcPriceAtom);
  const [AVA, setAVA] = useAtom(AVAAtom);
  const [AVA2, setAVA2] = useAtom(AVA2Atom);
  const [AVA4, setAVA4] = useAtom(AVA4Atom);
  const [AVA5, setAVA5] = useAtom(AVA5Atom);
  const [availBal, setAvailBal] = useAtom(availBalAtom);

  const [totalPooledKLD, setTotalPooledKLD] = useAtom(totalPooledKLDAtom);
  const [userKldDeposit, setUserKLDdeposit] = useAtom(userKldDepositAtom);
  const [totalStakers, setTotalStakers] = useAtom(totalStakersAtom);
  const [totalShares, setTotalShares] = useAtom(totalSharesAtom);
  const [userstKldBalance, setuserstKldBalance] = useAtom(userstKldBalanceAtom);
  const [timeLeft, setTimeLeft] = useAtom(timeLeftAtom);
  const [hasWithdrawalRequest, setHasWithdrawalRequest] = useAtom(
    hasWithdrawalRequestAtom,
  );
  const [totalReferrals, setTotalReferrals] = useAtom(totalReferralsAtom);

  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;

  // Set client-side mounting state
  useEffect(() => {
    setIsClient(true);
  }, []);

  /*
   * Protocol-wide staking figures. No wallet required.
   *
   * These three reads describe the vault, not the caller, and they already went
   * through `readOnlyProvider` — nothing about them ever needed a signer. They
   * were sitting inside the account-scoped effect below, which returns early
   * unless a wallet is connected, so every walletless visitor to /stake was
   * shown an empty vault: no pooled KLD, no shares, no stakers.
   *
   * On failure each atom is left alone rather than zeroed. An unreachable RPC is
   * not a measurement of an empty vault, and `totalPooledKLDAtom` starts as ""
   * precisely so a consumer can tell "not read yet" from "read, and it is zero".
   */
  useEffect(() => {
    if (!isClient) return;
    let cancelled = false;

    const fetchProtocolStaking = async () => {
      /* getKLDVaultContract throws when NEXT_PUBLIC_KLD_VAULT_ADDRESS is unset,
       * which is the normal state until the vault is deployed. */
      const vaultContract = (() => {
        try {
          return getKLDVaultContract(readOnlyProvider);
        } catch (error) {
          return null;
        }
      })();
      if (!vaultContract) return;

      try {
        const totalPooled = await vaultContract.getTotalPooledKld(
          STAKING_CONTRACTS.kld,
        );
        const formatted = ethers.formatUnits(totalPooled, 18);
        if (!cancelled) {
          setTotalPooledKLD(Number(formatted) > 0 ? formatted : "0");
        }
      } catch (error) {
        // Vault unreachable — leave the atom at whatever it last read.
      }

      try {
        // getTotalShares lives on stKLD and takes no argument. It was being
        // called on the vault with a token address, where it does not exist.
        const stKldContract = getStKLDContract(
          readOnlyProvider,
          await resolveStKldAddress(vaultContract),
        );
        const shares = await stKldContract.getTotalShares();
        const formatted = ethers.formatUnits(shares, 18);
        if (!cancelled) {
          setTotalShares(Number(formatted) > 0 ? formatted : "0");
        }
      } catch (error) {
        // stKLD unreachable or not yet set on the vault.
      }

      try {
        // A plain count, not a token amount — no formatUnits. Coerced because
        // ethers returns a BigInt and the atom is typed number; the dynamic
        // method is `any`, so TS would not have caught the mismatch.
        const stakerCount = Number(await vaultContract.getTotalStakers());
        if (!cancelled && Number.isFinite(stakerCount)) {
          setTotalStakers(stakerCount);
        }
      } catch (error) {
        // Vault unreachable — leave the count alone.
      }
    };

    fetchProtocolStaking();
    return () => {
      cancelled = true;
    };
  }, [
    isClient,
    refreshNonce,
    setTotalPooledKLD,
    setTotalShares,
    setTotalStakers,
  ]);

  useEffect(() => {
    const fetchUserStatus = async () => {
      // Only fetch data on client side to prevent hydration issues
      if (!isClient) return;
      if (!address) return;
      if (!activeChain) {
        toast.error("Chain not connected");
        return;
      }
      if (!activeAccount) {
        toast.error("invalid account");
        return;
      }
      const signer = ethers6Adapter.signer.toEthers({
        client,
        chain: activeChain,
        account: activeAccount,
      });

      try {
        const contract = getKaleidoContract(
          readOnlyProvider,
          READ_ONLY_CHAIN_ID,
        );
        const vaultContract = getKLDVaultContract(readOnlyProvider);
        /*
         * The vault exposes no per-user view, so the caller's stake comes from
         * the stKLD token itself. Protocol-wide totals are read in the effect
         * above, which needs no wallet.
         */
        const stKldContract = getStKLDContract(
          readOnlyProvider,
          await resolveStKldAddress(vaultContract),
        );
        /*
         * Two dead reads used to sit here, and one of them broke this whole
         * effect for every connected wallet.
         *
         * `await contract.getAllCollateralToken()` was unguarded, and `contract`
         * is the diamond on the read chain, which had no code on Abstract
         * testnet. An eth_call to a codeless address returns `0x`, and ethers
         * *throws* decoding that as `address[]` rather than returning an empty
         * array — so it jumped straight to the catch at the bottom of this try,
         * skipping the ~270 lines of reads below it and zeroing every per-user
         * figure in the app. Its result was assigned to a local that nothing
         * ever read.
         *
         * `getProtocolContract(readOnlyProvider)` was likewise assigned and
         * never used, and it threw when NEXT_PUBLIC_PROTOCOL_ADDRESS was unset —
         * a second way to lose the entire effect for no benefit. That left the
         * factory with no callers anywhere and it has since been deleted from
         * config/contracts.ts.
         *
         * Every read below is individually guarded, which is the design intent:
         * one unreachable view must not blank the other twenty. Do not add an
         * unguarded call to this scope.
         */

        /**
         * The caller's staked KLD. One read serves both atoms below.
         *
         * (It used to be kept in this local so the client-side point total
         * further down could reuse it without waiting a render for the atom.
         * That block is gone — see the note where it stood — so the local now
         * just avoids formatting the same balance twice.)
         */
        let stakedKld = "0";

        /*
         * Inputs to the collateral total at the end of this effect, captured as
         * each guarded read below succeeds. `null` means "not read", which is not
         * the same as zero, and the total refuses to publish unless all five are
         * known — see the comment there.
         *
         * These are locals rather than re-reads of the atoms because the total
         * used to re-fetch all five in a second, *unguarded* block: five
         * duplicate RPC calls per wallet load, and the other half of the cascade
         * described above. They deliberately stay null even where the display
         * atom beside them gets a value, since they answer "did this read
         * succeed", not "what should the page show".
         */
        let ethAmount: number | null = null;
        let usdcAmount: number | null = null;
        /* Default 0, not null: a chain without USDT/kfUSD cannot hold it, so it
         * contributes nothing to the total rather than suppressing it (the USDR
         * lesson further down). A token that IS on the chain but whose balance
         * read throws is set back to null, which correctly declines to publish. */
        let usdtAmount: number | null = 0;
        let kfusdAmount: number | null = 0;
        let ethPriceUsd: number | null = null;
        let usdcPriceUsd: number | null = null;
        let usdtPriceUsd: number | null = null;
        let kfusdPriceUsd: number | null = null;

        try {
          /*
           * A holder's stake is stKLD.balanceOf — the vault has no getUserDeposit,
           * so the previous call always threw and left both figures empty.
           *
           * One read serves both atoms because stKLD rebases: balanceOf returns
           * the pooled-KLD claim, not a share count, so "KLD deposited" and
           * "stKLD held" are the same number. userstKldBalance had no writer at
           * all besides the reset below, which is why every staker saw 0.
           */
          const stKldBalance = await stKldContract.balanceOf(address);
          const formatted = ethers.formatUnits(stKldBalance, 18);
          stakedKld = Number(formatted) > 0 ? formatted : "0";
          setUserKLDdeposit(stakedKld);
          setuserstKldBalance(stakedKld);
        } catch (error) {
          // console.error("error fetching staked KLD:", error)
        }

        /*
         * Withdrawal cooldown, and the open-request flag, in two separate try
         * blocks rather than one.
         *
         * They were sequential awaits inside a single try, and the second one
         * reverts on the currently-deployed vault: `hasWithdrawalRequest` is not
         * in that build's selector set at all (verified by eth_call —
         * `getWithdrawalTimeLeft` answers, `hasWithdrawalRequest`,
         * `supportedTokens` and `stKLD` revert with no data). So the flag was
         * never written, and on an account switch it kept the previous wallet's
         * value. Split, each atom now clears itself on its own failure.
         *
         * getWithdrawalTimeLeft returns 0 both for "never requested" and for
         * "cooldown elapsed", which is why the flag is read at all.
         */
        try {
          const timeleftforwithdrawal =
            await vaultContract.getWithdrawalTimeLeft(address);
          setTimeLeft(Number(timeleftforwithdrawal));
        } catch (error) {
          setTimeLeft(0);
        }

        try {
          const requested = await vaultContract.hasWithdrawalRequest(address);
          setHasWithdrawalRequest(Boolean(requested));
        } catch (error) {
          /* False, not left stale. This is the one atom where the unknown state
           * and the safe state coincide: hasWithdrawalRequestAtom is a plain
           * boolean, and /stake gates Unstake on it, so an unreadable flag must
           * read "no open request" rather than another account's "yes". */
          setHasWithdrawalRequest(false);
        }

        /*
         * Two more discarded reads used to sit in this effect —
         * `getUserCollateralTokens(address)` here and
         * `getUserActiveRequests(address)` below the collateral blocks. Both
         * assigned to a local that nothing read, both guarded, so unlike line
         * 256 they broke nothing; they just spent a round-trip each on a view
         * whose answer was thrown away. The first also shadowed the `res5` the
         * USDR block uses. `useGetActiveRequest` is the hook that actually reads
         * the caller's requests, and usePortfolio consumes it.
         */
        /*
         * Fetch account collateral values.
         *
         * One read feeds both atoms. `availBal` had its own identical
         * `getAccountCollateralValue(address)` call a few lines down — the same
         * view, the same argument, a second round-trip per wallet load — and its
         * catch wrote 0, which is the fabricated-zero bug this pass is removing.
         * Nothing consumes `availBal` today (it is returned from this hook and
         * read by no component), so the zero was invisible; it would not have
         * stayed invisible once something rendered it.
         */
        try {
          const res = await contract.getAccountCollateralValue(address);
          setData(res);
          setAvailBal(res);
        } catch (error) {
          setData(null);
          setAvailBal(null);
        }

        // Fetch ETH collateral
        try {
          const res3 = await contract.gets_addressToCollateralDeposited(
            address,
            NATIVE_SENTINEL.lending,
          );
          const ethCollateral = ethers.formatEther(res3);
          ethAmount = Number(ethCollateral);
          setData3(ethAmount);
          setAVA(ethAmount);
        } catch (error) {
          /* Cleared, not zeroed, and AVA is cleared too — it was left untouched
           * here, so switching from a funded wallet to one whose read fails kept
           * showing the previous account's collateral. */
          setData3(undefined);
          setAVA(null);
        }

        try {
          const healthFactor = await contract.getHealthFactor(address);
          // console.log("Health Factor:", healthFactor)
          setdata2(Number(healthFactor.toString()));
          // Notify if health factor is close to 1 (e.g., <= 1.05) and not already notified recently
          // Scaled to real units before comparing. The raw value is ~1e18, so
          // the `<= 1.05` test below could never be true and this warning has
          // never once fired; sendHealthFactorWarning also prints the figure.
          const hf = Number(healthFactor.toString()) * HEALTH_SCALE;
          const now = Date.now();
          const lastWarning = window.__kaleido_last_health_warning || 0;
          const warningCooldown = 5 * 60 * 1000; // 5 minutes cooldown

          if (hf > 0 && hf <= 1.05 && now - lastWarning > warningCooldown) {
            /*
             * Raised into the notification store, which categorises it "risk"
             * and runs the presence ladder. It used to go to
             * utils/notificationService.ts, which POSTed it to a hardcoded
             * localhost and wrote a row the store overwrote — so on top of the
             * unscaled comparison above, the alert had nowhere to land either.
             * No wallet check: getHealthFactor(address) above would have thrown
             * without one.
             */
            sendHealthFactorWarning(hf);
            window.__kaleido_healthfactor_warned = true;
            window.__kaleido_last_health_warning = now;
          }

          // Reset warning flag if health factor improves significantly
          if (hf > 1.2) {
            window.__kaleido_healthfactor_warned = false;
          }
        } catch (error) {
          /* `undefined`, not 0. data2Atom is `number | undefined` and
           * usePortfolio:206 already returns null for undefined — a health
           * factor of *zero* is a maximally-unhealthy position, so writing 0
           * here told the portfolio the account was liquidatable whenever the
           * read merely failed. */
          setdata2(undefined);
        }

        // Fetch USDC collateral
        try {
          if (!LENDING.usdc) throw new Error("no USDC on the read chain");
          const res4 = await contract.gets_addressToCollateralDeposited(
            address,
            LENDING.usdc,
          );
          const usdcCollateral = ethers.formatUnits(res4, 6);
          usdcAmount = Number(usdcCollateral);
          setData4(usdcAmount);
          setAVA2(usdcAmount);
        } catch (error) {
          setData4(undefined);
          setAVA2(null);
        }

        /*
         * The USDR collateral read is gone, along with the AVA3 and data5 atoms.
         *
         * USDR has no deployment record on any of the five live chains. It was
         * only ever one Abstract literal in the flat constants/utils/addresses
         * table, since deleted, which is why it is absent from
         * `borrowCurrencies` in constants/registry.ts — there is no address to
         * read it at, and no chain on which anyone could have deposited it. Left
         * in place it went on suppressing the collateral total below, whose guard
         * required all five inputs: a token that cannot resolve is not a
         * measurement of zero.
         *
         * If USDR is ever deployed, add it to `borrowCurrencies` and it returns
         * through the same registry path as USDC/USDT/kfUSD. It read at 6
         * decimals here, which was correct and is worth keeping if it comes back.
         */

        // Fetch kfUSD collateral
        try {
          if (LENDING.kfUSD) {
            const res6 = await contract.gets_addressToCollateralDeposited(
              address,
              LENDING.kfUSD,
            );
            kfusdAmount = Number(ethers.formatUnits(res6, 18));
            setAVA4(kfusdAmount);
          } else {
            // Not on this chain: kfusdAmount keeps its 0 default (contributes
            // nothing), atom reads "not read".
            kfusdAmount = 0;
            setAVA4(null);
          }
        } catch (error) {
          kfusdAmount = null;
          setAVA4(null);
        }

        // Fetch USDT collateral
        try {
          if (LENDING.usdt) {
            const res7 = await contract.gets_addressToCollateralDeposited(
              address,
              LENDING.usdt,
            );
            usdtAmount = Number(ethers.formatUnits(res7, 6));
            setAVA5(usdtAmount);
          } else {
            usdtAmount = 0;
            setAVA5(null);
          }
        } catch (error) {
          usdtAmount = null;
          setAVA5(null);
        }

        /*
         * Prices. On failure these are left `null`, never 0.
         *
         * Both atoms already default to null, and a price of 0 is not a missing
         * price — it renders as a confident "$0.00" everywhere a dash was meant,
         * which is the exact failure `DASH` in lib/format/figures.ts exists to
         * prevent. A zero also survives every consumer's guard: useCreateLending-
         * Request:53 tests `!price || price <= 0`, which null satisfies honestly.
         *
         * A successful read of <= 0 is treated the same way. `getUsdValue` cannot
         * legitimately price a whole token at zero, so that is an unregistered
         * feed or a truncation, not a measurement.
         */
        try {
          const res6 = await contract.getUsdValue(
            NATIVE_SENTINEL.lending,
            1,
            0,
          );
          const ethPrice = Number(res6.toString()) / USD_SCALE;
          if (Number.isFinite(ethPrice) && ethPrice > 0) {
            ethPriceUsd = ethPrice;
            setEtherPrice(ethPrice);
          } else {
            setEtherPrice(null);
          }
        } catch (error) {
          setEtherPrice(null);
        }

        try {
          if (!LENDING.usdc) throw new Error("no USDC on the read chain");
          const res7 = await contract.getUsdValue(LENDING.usdc, 1, 0);
          // Named to avoid shadowing the `usdcPrice` atom value destructured at
          // the top of this hook.
          const usdcSpot = Number(res7.toString()) / USD_SCALE;
          if (Number.isFinite(usdcSpot) && usdcSpot > 0) {
            usdcPriceUsd = usdcSpot;
            setUSDCPrice(usdcSpot);
          } else {
            setUSDCPrice(null);
          }
        } catch (error) {
          setUSDCPrice(null);
        }

        /*
         * USDT and kfUSD spot prices, for the collateral total below. Unlike ETH
         * and USDC these have no dedicated atom — nothing renders a USDT or kfUSD
         * price on its own — so the value stays a local. Same discipline as the
         * two above: a read that reverts (no feed registered on the read chain)
         * or returns <= 0 leaves the price null, and the total then declines to
         * publish for any account that actually holds the token, rather than
         * pricing real collateral wrong.
         */
        try {
          if (!LENDING.usdt) throw new Error("no USDT on the read chain");
          const res = await contract.getUsdValue(LENDING.usdt, 1, 0);
          const spot = Number(res.toString()) / USD_SCALE;
          if (Number.isFinite(spot) && spot > 0) usdtPriceUsd = spot;
        } catch (error) {
          usdtPriceUsd = null;
        }

        try {
          if (!LENDING.kfUSD) throw new Error("no kfUSD on the read chain");
          const res = await contract.getUsdValue(LENDING.kfUSD, 1, 0);
          const spot = Number(res.toString()) / USD_SCALE;
          if (Number.isFinite(spot) && spot > 0) kfusdPriceUsd = spot;
        } catch (error) {
          kfusdPriceUsd = null;
        }

        try {
          const contract = getKaleidoContract(
            readOnlyProvider,
            READ_ONLY_CHAIN_ID,
          );
          const refCount = await contract.getDownlinersCount(address);
          // console.log("Downliners count:", refCount)
          setTotalReferrals(Number(refCount));
        } catch (error) {
          // console.error("Error fetching downliners count:", error)
        }

        /*
         * The client-side point total used to be computed here and it is gone.
         *
         * Seventy lines that read a referral balance, counted the caller's rows
         * in `kaleido_listings` and `kaleido_requests`, counted V3 position NFTs,
         * counted messages in every `kaleido_conversation_*` key in
         * localStorage, and summed the lot into `referralPointAtom` with a
         * “Point Guard” console line. Four things were wrong with it, and the
         * fourth is why none of it could be repaired in place:
         *
         *  1. Its formula existed nowhere else. `min(listings, 5) * 100`,
         *     `* 250` per LP NFT, `* 10` per chat message: none of it comes from
         *     `point_source_rates`, so the figure disagreed with the points
         *     system it claimed to total. /api/leaderboard had grown its own
         *     copy of the same invented arithmetic, which is what a formula with
         *     no single home does next.
         *  2. The AI component was `localStorage`. A user could award themselves
         *     the cap by typing, or by writing the key directly, and a user who
         *     cleared their browser lost points they had earned.
         *  3. Counting NFTs and rows is not the same as valuing them, so a
         *     dust position scored exactly what a funded one did.
         *  4. A point balance computed in the browser is a point balance the
         *     browser decides. docs/points-system.md §1 opens on this and
         *     20260817000000 closed `point_balances` to anon reads to enforce
         *     it: the only trustworthy total is the one the server computed from
         *     transactions it fetched and decoded itself.
         *
         * Nothing consumed the atom — it was returned from this hook and read by
         * no component — so deleting it removes a wrong number rather than a
         * displayed one. /leaderboard shows the real balance, through
         * `point_leaderboard` and /api/leaderboard/me.
         */

        /*
         * Total collateral value across every token the protocol accepts as
         * collateral — ETH, USDC, USDT and kfUSD — computed from the reads above
         * rather than re-fetching them.
         *
         * This block used to repeat all the calls completely unguarded. That was
         * the second half of the dead-diamond cascade: with the diamond codeless
         * the first `await` here threw and landed in the catch below, so removing
         * only the earlier call would have fixed nothing. It also doubled this
         * effect's RPC traffic for values it had already read.
         *
         * Each token contributes only when its value is *known*: the balance read
         * succeeded, and either the balance is zero (no price needed) or the token
         * priced. A token the account holds but which did not price makes the
         * whole total unknowable — publishing a sum that silently drops it is the
         * exact failure this atom defaults to null to avoid (a confident dollar
         * figure quietly missing a position, worse than "—"). A token the account
         * does not hold — or that is not on this chain, hence the 0 defaults on
         * usdtAmount/kfusdAmount — contributes 0 regardless of whether its feed is
         * registered, so a missing USDT/kfUSD feed cannot blank an ETH-only
         * account. (USDR used to sit here too and suppressed the total for
         * everyone because it resolved on no chain; it was removed — see above.)
         *
         * kfUSD and USDT were read but excluded until 2026-08-25: the exclusion
         * predated the per-chain oracle work and was left flagged rather than
         * patched with a fabricated price. Both now price through the same
         * getUsdValue path as ETH/USDC.
         */
        /* Inlined arrow, not a hoisted helper, for the reason the guard was
         * inlined before: `amount`/`price` are `let`s assigned in the try blocks
         * above, and TypeScript narrows them through this conditional expression
         * but not through an aliased predicate. */
        const contribution = (
          amount: number | null,
          price: number | null,
        ): number | null =>
          amount === null
            ? null
            : amount === 0
              ? 0
              : price === null
                ? null
                : amount * price;

        const parts = [
          contribution(ethAmount, ethPriceUsd),
          contribution(usdcAmount, usdcPriceUsd),
          contribution(usdtAmount, usdtPriceUsd),
          contribution(kfusdAmount, kfusdPriceUsd),
        ];
        if (parts.every((p) => p !== null)) {
          const totalCollateralValue = parts.reduce<number>(
            (sum, p) => sum + (p ?? 0),
            0,
          );
          setCollateralVal(totalCollateralValue.toFixed(2));
        } else {
          setCollateralVal(null);
        }
      } catch (err) {
        /*
         * Reaching here now means the *setup* failed, not a read: the three
         * contract factories above throw when their env address is unset, and
         * nothing else in this try is unguarded. Every individual view has its
         * own catch.
         *
         * Account-scoped state only. The protocol-wide staking atoms are not
         * reset here: they are written by the effect above, which this failure
         * says nothing about, and zeroing them would let one failed account read
         * report the vault as empty to the whole app.
         *
         * Cleared to each atom's own "not read" value rather than to zero. The
         * atoms were declared with those states — data2/data3/data4 are
         * `number | undefined`, collateralVal and totalReferrals are nullable,
         * the price atoms default to null — and writing 0 destroyed the
         * distinction the declarations exist to carry: it reported a health
         * factor of zero, a $0.00 portfolio and a $0.00 ETH price as though they
         * had been measured. Clearing is still necessary, so that switching
         * accounts cannot leave the previous wallet's figures on screen.
         *
         * AVA4, AVA5 and availBal were missing from this list entirely, which is
         * exactly that staleness bug for kfUSD collateral, USDT collateral and
         * the available balance.
         */
        setuserstKldBalance(undefined);
        setUserKLDdeposit("");
        setdata2(undefined);
        setData(null);
        setData3(undefined);
        setData4(undefined);
        setCollateralVal(null);
        setEtherPrice(null);
        setUSDCPrice(null);
        setAVA(null);
        setAVA2(null);
        setAVA4(null);
        setAVA5(null);
        setAvailBal(null);

        setTimeLeft(0);
        setHasWithdrawalRequest(false);
        setTotalReferrals(null);
      }
    };

    if (activeAccount && address && isClient) {
      fetchUserStatus();
    }
  }, [address, activeAccount, isClient, refreshNonce]);

  // Bumping the nonce re-runs the fetch effect above. Consumers (useBorrowV2)
  // call this after a collateral deposit/withdraw so the position re-reads
  // instead of staying stale until the address changes or a full reload.
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  return {
    refresh,
    AVA4,
    AVA5,
    timeLeft,
    hasWithdrawalRequest,
    userstKldBalance,
    totalShares,
    totalPooledKLD,
    userKldDeposit,
    totalStakers,

    data,
    data2,
    data3,
    data4,
    collateralVal,
    etherPrice,
    usdcPrice,
    AVA,
    AVA2,
    availBal,
    totalReferrals,
  };
};

export default useGetValueAndHealth;
