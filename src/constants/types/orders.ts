import { Ordertype } from "@/constants/types/index"

export const orderTypesArray: Ordertype[] = ["All Orders", "OPEN", "OVERDUE", "SERVICED"]

export const statusLabels: Record<string, string> = {
  "All Orders": "All Orders",
  OPEN: "OPEN",
  SERVICED: "SERVICED",
  OVERDUE: "OVERDUE",
}
