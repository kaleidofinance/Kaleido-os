"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isAddress } from "ethers";
import { useRegisterReferral } from "@/hooks/useRegisterReferral";
import { useActiveAccount } from "thirdweb/react";

function ReferralHandler() {
  const searchParams = useSearchParams();
  // const [referralStored, setReferralStored] = useLocalStorage<string | null>("referralUpliner", null)
  const [referralStored, setReferralStored] = useState<string | null>(null);
  const { registerUpliner } = useRegisterReferral();
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  // console.log("✅ referralStored initially:", referralStored)
  useEffect(() => {
    const referral = searchParams.get("referral");

    if (
      !referral ||
      !isAddress(referral) ||
      referral.toLowerCase() === address?.toLowerCase()
    )
      return;

    if (referral !== referralStored) {
      setReferralStored(referral);
    }
  }, [searchParams, address, referralStored, setReferralStored]);

  useEffect(() => {
    if (
      !referralStored ||
      referralStored.toLowerCase() === address?.toLowerCase()
    )
      return;
    registerUpliner(referralStored);
  }, [referralStored, registerUpliner, address]);

  return null;
}

export default function ExposedReferralHandler() {
  /**
   * The fallback is `null` on purpose, and it matters.
   *
   * ReferralHandler renders nothing — it is a pure side effect that reads
   * ?referral and calls registerUpliner. The Suspense boundary exists only
   * because useSearchParams() requires one to prerender, not because there is
   * anything to show while it waits.
   *
   * This previously rendered <LoadingScreen />: a full-viewport
   * `absolute inset-0 z-50 bg-black` overlay. Because ClientProviders mounts
   * this at the root, that overlay covered the whole app on the first paint of
   * every route, then vanished on hydration — a black flash in dark mode and a
   * black rectangle over a bone page in light mode. A fallback for an invisible
   * component should itself be invisible.
   */
  return (
    <Suspense fallback={null}>
      <ReferralHandler />
    </Suspense>
  );
}
