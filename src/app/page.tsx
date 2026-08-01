import { redirect } from "next/navigation";

/**
 * The v2 surface is the app now — the legacy route groups it replaced are
 * gone. Portfolio is the landing page.
 */
export default function RootIndex() {
  redirect("/v2/portfolio");
}
