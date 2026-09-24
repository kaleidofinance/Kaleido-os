"use client";

import { useLifiPending } from "@/hooks/v2/useLifiPending";

/** Mount once in the app shell; the hook performs destination reconciliation. */
export default function LifiLifecycleWatcher() {
  useLifiPending();
  return null;
}
