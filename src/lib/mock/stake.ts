import type { StakeV2 } from "@/hooks/v2/useStakeV2";

/**
 * Demo staking position.
 *
 * Typed as a `Pick` of the real return so the compiler enforces field-by-field
 * agreement, and so adding a read field to `StakeV2` does not silently leave
 * this fixture behind. Only read fields are listed: every write — stake,
 * unstake, requestWithdrawal, cancelWithdrawal — stays wired to the real
 * contract call, because whether that wiring exists is the thing being audited.
 *
 * `stakedBalance` is a display string (the real hook stringifies the formatted
 * balance atom), while `totalStaked`, `stakers` and `yieldIndex` are numbers.
 *
 * `yieldIndex` is pooled KLD over stKLD shares, so it starts at 1.0 and only
 * rises; 1.0842 means a share minted at genesis is now worth 8.42% more KLD.
 * A value below 1.0 would describe a loss the contract cannot produce.
 *
 * There is an open withdrawal request mid-cooldown — `hasRequest` with a live
 * `cooldownLeft` — because that is the state where the page has to disable
 * staking, show a countdown, and offer Cancel. The idle state shows none of
 * that, so an idle-only fixture would leave three controls unexercised.
 *
 * `cooldownLeft` is a fixed number of seconds (2d 5h), never derived from the
 * clock: this renders inside a server-rendered tree and a clock-derived value
 * differs between the server pass and hydration.
 */
export const MOCK_STAKE: Pick<
  StakeV2,
  | "stakedBalance"
  | "totalStaked"
  | "stakers"
  | "yieldIndex"
  | "hasRequest"
  | "cooldownLeft"
  | "cooldownActive"
> = {
  stakedBalance: "1284.5512",
  totalStaked: 8_412_337.42,
  stakers: 1_284,
  yieldIndex: 1.0842,
  hasRequest: true,
  cooldownLeft: 190_800,
  cooldownActive: true,
};
