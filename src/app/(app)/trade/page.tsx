import { redirect } from "next/navigation";

/** Trade's default mode is Agent — Luca is the front door to the OS. */
export default function TradeIndex() {
  redirect("/trade/agent");
}
