import { redirect } from "next/navigation";

/**
 * Trade's default mode is Agent — Luca is the front door to the OS.
 *
 * In production the bare /trade path is redirected to /trade/agent by a real
 * 307 in next.config.mjs's redirects(), which wins over this page. This
 * component is therefore a fallback: it documents the default and still
 * resolves /trade should that config entry ever be removed.
 */
export default function TradeIndex() {
  redirect("/trade/agent");
}
