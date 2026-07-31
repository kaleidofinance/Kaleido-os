import { redirect } from "next/navigation";

export default function StableIndex() {
  redirect("/v2/stable/mint");
}
