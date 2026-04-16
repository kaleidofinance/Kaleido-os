import { supabase } from "@/lib/supabase/supabaseClient"

export const upsertUser = async (walletAddress: string, username: string) => {
  const { data: existingUser, error: selectError } = await supabase
    .from("kaleido")
    .select("walletAddress")
    .eq("username", username)
    .single()

  if (selectError && selectError.code !== "PGRST116") {
    // console.error("Supabase select error:", selectError)
    return { data: null, error: selectError }
  }

  if (existingUser?.walletAddress) {
    // console.log(`Username ${username} already has a wallet address associated.`)
    return { data: existingUser, error: null }
  }

  const { data, error } = await supabase
    .from("kaleido")
    .upsert({ walletAddress, username }, { onConflict: "username" })
    .select()

  if (error) {
    // console.error("Supabase upsert error:", error)
  } else {
    // console.log("Upserted data:", data)
  }

  return { data, error }
}
