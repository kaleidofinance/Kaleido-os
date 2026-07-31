import { redirect } from "next/navigation";

/** Trade's default mode is Swap — the most familiar entry point. */
export default function TradeIndex() {
  redirect("/v2/trade/swap");
}
