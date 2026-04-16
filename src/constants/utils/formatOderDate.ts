export function getTimeUntil(returnDate: number | undefined | null): string {
  if (!returnDate || returnDate <= 0) return "N/A"

  const now = Math.floor(Date.now() / 1000)
  const diff = returnDate - now

  if (diff <= 0) {
    const overdue = Math.abs(diff)
    const days = Math.floor(overdue / 86400)
    const hours = Math.floor((overdue % 86400) / 3600)
    const minutes = Math.floor((overdue % 3600) / 60)
    const seconds = overdue % 60

    return `Overdue by ${days}d ${hours}h ${minutes}m ${seconds}s`
  }

  const days = Math.floor(diff / 86400)
  const hours = Math.floor((diff % 86400) / 3600)
  const minutes = Math.floor((diff % 3600) / 60)
  const seconds = diff % 60

  return `${days}d ${hours}h ${minutes}m ${seconds}s left`
}

export const getOverdue = (returnDate: number | null | undefined): [string, boolean] => {
  const overdue = getTimeUntil(returnDate)
  const isOverdue = overdue.includes("Overdue")
  return [isOverdue ? "OVERDUE" : "", isOverdue]
}
