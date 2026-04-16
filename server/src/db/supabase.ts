import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"
import { envSchema } from "../../config/envSchema"
dotenv.config()

const parsedEnv = envSchema.safeParse(process.env)
if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.format())
  process.exit(1)
}

const CONFIG = parsedEnv.data

const SUPABASE_URL = CONFIG.SUPABASE_URL!
const SUPABASE_ANON_KEY = CONFIG.SUPABASE_KEY!

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
