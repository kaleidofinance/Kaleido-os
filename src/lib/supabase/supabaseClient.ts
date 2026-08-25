import { createClient } from "@supabase/supabase-js";
import { envVars } from "@/constants/envVars";

const supabaseUrl = envVars.supabaseUrl;
const supabaseKey = envVars.supabaseKey;

// createClient throws synchronously when the URL is empty, which would take the
// whole app down at import time. A missing Supabase config should degrade the
// features that need it (leaderboard, activity logging) — not white-screen the
// entire OS on boot. When the env is set (production, configured dev) the real
// client is used unchanged; otherwise we fall back to a placeholder so the app
// still renders, and Supabase-backed calls fail at call time instead.
const isConfigured = Boolean(supabaseUrl && supabaseKey);

if (!isConfigured && typeof window === "undefined") {
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_KEY are not set — " +
      "Supabase features are disabled. Set them in .env to enable them.",
  );
}

const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseKey || "placeholder-anon-key",
);

export { supabase, isConfigured as isSupabaseConfigured };
