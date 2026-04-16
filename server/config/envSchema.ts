import { z } from "zod"

export const envSchema = z.object({
  RPC_URL: z.string().url(),
  PRIVATE_KEY: z.string(),
  DIAMOND_CONTRACT_ADDRESS: z.string(),
  POLL_INTERVAL: z
    .string()
    .regex(/^\d+$/)
    .transform((val) => parseInt(val))
    .refine((val) => val > 0, { message: "POLL_INTERVAL must be positive" }),
  MAX_RETRIES: z
    .string()
    .regex(/^\d+$/)
    .transform((val) => parseInt(val))
    .refine((val) => val >= 0, { message: "MAX_RETRIES must be 0 or more" }),
  RETRY_DELAY_MS: z
    .string()
    .regex(/^\d+$/)
    .transform((val) => parseInt(val))
    .refine((val) => val >= 0, { message: "RETRY_DELAY_MS must be 0 or more" }),
  METRICS_PORT: z
    .string()
    .regex(/^\d+$/)
    .transform((val) => parseInt(val))
    .refine((val) => val > 0 && val < 65536, { message: "METRICS_PORT must be a valid port number" }),
  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  TELEGRAM_BOT_TOKEN: z.string(),
  TELEGRAM_CHAT_ID: z.string(),
  PYTH_ORACLE_ADDRESS: z.string(),
  ETH_PYTH_FEED_ID: z.string(),
  USDC_PYTH_FEED_ID: z.string(),
  SUPABASE_URL: z.string(),
  SUPABASE_KEY: z.string(),
  // QUICKNODE_KEY: z.string(),
  // ALCHEMY_KEY: z.string(),
  // THIRDWEB_KEY: z.string(),
})
