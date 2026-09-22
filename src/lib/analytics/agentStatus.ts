/**
 * What counts as a Luca turn FAILING, shared by the public overview and the
 * admin panel so one definition can't drift from the other.
 *
 * A turn is a failure only when the model backend or the build/audit genuinely
 * broke. A `refused` is Luca correctly declining — the agent working, not
 * failing — so it is NOT here; nor is a `clarification` or any normal handled
 * reply. This is why the public metric is a "handled rate" (1 − error rate),
 * not an "ok rate": counting a safe decline as a failure understated it.
 */
export const ERROR_STATUSES: ReadonlySet<string> = new Set([
  "provider_error",
  "provider_blocked",
  "build_error",
  "quota_exhausted",
]);

export function isErrorStatus(status: string | null | undefined): boolean {
  return ERROR_STATUSES.has(status ?? "");
}
