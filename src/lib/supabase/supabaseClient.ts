import { createClient } from "@supabase/supabase-js"
import { envVars } from "@/constants/envVars"

const supabaseUrl: any = envVars.supabaseUrl
const supabaseKey: any = envVars.supabaseKey
const supabase = createClient(supabaseUrl, supabaseKey)

export { supabase }
