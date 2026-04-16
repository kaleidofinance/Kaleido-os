import { atom } from "jotai"
import { Ordertype, ActiveTable, AmountFilter } from "@/constants/types/index"

// UI and Filter Atoms
export const selectedTokenAtom = atom<string>("All Tokens")
export const selectedOrderAtom = atom<Ordertype>("All Orders")
export const activeTableAtom = atom<ActiveTable>("borrow")
export const filtervolumebyOrder = atom<string>("Highest")

export const isTokenDropdownOpenAtom = atom<boolean>(false)
export const orderstatusopenAtom = atom<boolean>(false)
export const loadingBorrowAtom = atom<boolean>(true)
export const interestAtom = atom<number>(100)
export const selectedVolumeRangesAtom = atom<{ min: number; max: number }[]>([])

export const currentPageAtom = atom<number>(1)
export const filterbyAmountAtom = atom<AmountFilter | undefined>(undefined)
export const filterbyUserOrderAtom = atom<any>(null)
export const filterbyDurationAtom = atom<any>(null)
export const filterByOwnerAtom = atom<boolean>(false)
export const filterByOverdue = atom<boolean>()
export const searchByIdAtom = atom<string>("")

// Protocol Data Atoms
export const dataAtom = atom<bigint | null>(null)
export const data2Atom = atom<number | undefined>(undefined)
export const data3Atom = atom<number | undefined>(undefined)
export const data4Atom = atom<number | undefined>(undefined)
export const data5Atom = atom<number | undefined>(undefined)

export const collateralValAtom = atom<number | string | null>(null)
export const etherPriceAtom = atom<any>(null)
export const usdcPriceAtom = atom<any>(null)

export const AVAAtom = atom<any>(null)
export const AVA2Atom = atom<any>(null)
export const AVA3Atom = atom<any>(null)
export const AVA4Atom = atom<any>(null)
export const AVA5Atom = atom<any>(null)
export const availBalAtom = atom<any>(null)

// Vault + Staking Data
export const totalPooledKLDAtom = atom<string>("")
export const userKldDepositAtom = atom<string>("")
export const totalStakersAtom = atom<number>(0)
export const totalSharesAtom = atom<string | undefined>(undefined)
export const userstKldBalanceAtom = atom<string | undefined>(undefined)
export const timeLeftAtom = atom<number>(0)

// Referral System
export const totalReferralsAtom = atom<number | null>(null)
export const referralPointAtom = atom<number | null>(null)
