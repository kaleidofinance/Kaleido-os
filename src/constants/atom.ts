import { atom } from "jotai";
import { Ordertype, ActiveTable, AmountFilter } from "@/constants/types/index";

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
