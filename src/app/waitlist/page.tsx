import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * /waitlist retired 2026-09-24 — the Season 1 task program moved in-app to
 * /rewards. This 307s there, preserving a referral `?ref=` so the campaign links
 * already in the wild (and the OG card) keep working.
 */
export default function WaitlistRedirect({
  searchParams,
}: {
  searchParams?: { ref?: string | string[] };
}) {
  const raw = searchParams?.ref;
  const ref = Array.isArray(raw) ? raw[0] : raw;
  redirect(ref ? `/rewards?ref=${encodeURIComponent(ref)}` : "/rewards");
}
