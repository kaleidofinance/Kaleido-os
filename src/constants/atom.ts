import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Ordertype, ActiveTable, AmountFilter } from "@/constants/types/index";

/**
 * Testnet visibility — the one shared switch behind "we are on mainnet now".
 *
 * Winding the private testnet down for the Arc mainnet launch means the app
 * opens on mainnet networks and the testnet-only surfaces (the faucet tab and
 * page) step aside. It is a wind-down, not a removal: a tester flips this back on
 * from the network switcher and everything testnet returns — which is why it is a
 * persisted per-browser preference and not a build flag. The choice has to
 * survive a reload for the toggle to mean anything.
 *
 * `false` = mainnet (the default the launch runs on). One key, one source of
 * truth: the network switcher, the nav's faucet tab and the /faucet page all read
 * and write THIS atom. Before it, the switcher's toggle was local component state
 * that nothing else could see, which is exactly why flipping it changed no other
 * page. `atomWithStorage` reads storage after mount rather than on init, so the
 * server pass and the first client render agree on `false` and a persisted `true`
 * applies a beat later without a hydration mismatch. Consume it through
 * `useTestnetMode()` (hooks/v2), never by importing this atom into a component —
 * the hook is the seam a future settings surface writes through too.
 *
 * THE KEY IS VERSIONED (`.v2`), and that suffix is a one-time reset, not decoration.
 * Testers who used the private testnet have `kaleido.showTestnets: true` saved in
 * their browser from that phase, so they would keep landing on testnet after the
 * mainnet launch — the opposite of the default. Bumping the key orphans that old
 * value: every browser has no `.v2` entry yet, so everyone falls back to `false`
 * (mainnet, toggle off) on their next load, and anyone who still wants testnet
 * simply flips it again (now stored under `.v2`). Bump the suffix again only for
 * another deliberate global reset of this preference.
 */
export const showTestnetsAtom = atomWithStorage<boolean>(
  "kaleido.showTestnets.v2",
  false,
);

// UI and Filter Atoms
export const selectedTokenAtom = atom<string>("All Tokens");
export const selectedOrderAtom = atom<Ordertype>("All Orders");
export const activeTableAtom = atom<ActiveTable>("borrow");
export const filtervolumebyOrder = atom<string>("Highest");

export const isTokenDropdownOpenAtom = atom<boolean>(false);
export const orderstatusopenAtom = atom<boolean>(false);
export const loadingBorrowAtom = atom<boolean>(true);
export const interestAtom = atom<number>(100);
export const selectedVolumeRangesAtom = atom<{ min: number; max: number }[]>(
  [],
);

export const currentPageAtom = atom<number>(1);
export const filterbyAmountAtom = atom<AmountFilter | undefined>(undefined);
export const filterbyUserOrderAtom = atom<any>(null);
export const filterbyDurationAtom = atom<any>(null);
export const filterByOwnerAtom = atom<boolean>(false);
export const filterByOverdue = atom<boolean>();
export const searchByIdAtom = atom<string>("");

// Protocol Data Atoms
export const dataAtom = atom<bigint | null>(null);
/* The raw 1e18-scaled health factor, with two non-numeric readings: `undefined`
   is "the read has not landed or failed", and `Infinity` is the contract's no-debt
   sentinel, normalised from `type(uint256).max` by its only writer. Consumers must
   check finiteness before showing it — see NO_DEBT_SENTINEL in
   useGetValueAndHealth.ts. */
export const data2Atom = atom<number | undefined>(undefined);
export const data3Atom = atom<number | undefined>(undefined);
export const data4Atom = atom<number | undefined>(undefined);
// data5Atom and AVA3Atom held USDR collateral. USDR has no deployment on any of
// the five live chains, so useGetValueAndHealth stopped reading it and both atoms
// lost every writer and reader. Removed rather than left as permanent nulls.

export const collateralValAtom = atom<number | string | null>(null);
export const etherPriceAtom = atom<any>(null);
export const usdcPriceAtom = atom<any>(null);

export const AVAAtom = atom<any>(null);
export const AVA2Atom = atom<any>(null);
export const AVA4Atom = atom<any>(null);
export const AVA5Atom = atom<any>(null);
export const availBalAtom = atom<any>(null);

// Vault + Staking Data
export const totalPooledKLDAtom = atom<string>("");
export const userKldDepositAtom = atom<string>("");
export const totalStakersAtom = atom<number>(0);
export const totalSharesAtom = atom<string | undefined>(undefined);
export const userstKldBalanceAtom = atom<string | undefined>(undefined);
export const timeLeftAtom = atom<number>(0);
/**
 * True while the user has an open withdrawal request.
 *
 * Distinct from timeLeft being 0, which also means "cooldown elapsed, withdraw
 * now". Without this the stake page cannot tell the two apart, so it enables
 * Unstake for users who never requested — and the vault reverts
 * NoWithdrawalRequest.
 */
export const hasWithdrawalRequestAtom = atom<boolean>(false);

// Referral System
export const totalReferralsAtom = atom<number | null>(null);
/* `referralPointAtom` was here. It held a point total the browser computed for
   itself — see the block it was deleted from in useGetValueAndHealth.ts for the
   four reasons that number could not be trusted. Point balances are read from
   `point_leaderboard` through /api/leaderboard, never held in a client atom:
   an atom is writable by whatever imports it, and a writable point balance is
   the thing docs/points-system.md §1 exists to prevent. */
