import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Server-only.
 *
 * The browser client in supabaseClient.ts uses the anon key, which Next inlines
 * into the JS bundle — 20260801000000_lock_activity_writes.sql exists precisely
 * because anything that key can write is untrusted. Quota accounting cannot live
 * behind it: a user who can increment their own counter has no quota.
 *
 * SUPABASE_SERVICE_ROLE_KEY is therefore read without a NEXT_PUBLIC_ prefix, so
 * it stays out of the bundle, and this module must only ever be imported from
 * route handlers. The import guard below turns a mistake into a loud server-side
 * error rather than a silent key leak.
 */

if (typeof window !== "undefined") {
  throw new Error(
    "serverClient.ts was imported in the browser. It carries the service-role key and must stay server-only.",
  );
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Null when unconfigured rather than throwing, matching supabaseClient.ts:
 * a missing key should disable the feature that needs it, not take down every
 * route that happens to import this module.
 */
export const supabaseAdmin: SupabaseClient | null =
  url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export const isAdminConfigured = Boolean(url && serviceKey);
