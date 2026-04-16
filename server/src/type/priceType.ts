export type UpdateCheckResult = {
  shouldUpdate: boolean
  updatesNeeded: Record<string, boolean>
}
