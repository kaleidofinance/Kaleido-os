import type { SettledLike } from "./cards/receipt";

export type FollowThrough = {
  kind: "confirmed" | "nothing";
  steps: SettledLike[];
  at: number;
};

export type ReceiptStatus = "pending" | "confirmed" | "reverted";

const RESULT_WORDS = /\b(what happened|status|result|did it work|did that work|transaction|hash|tx hash|receipt)\b/i;

/** Only answer from a receipt when the user is explicitly asking about it. */
export function asksAboutLastResult(text: string): boolean {
  return RESULT_WORDS.test(text.trim());
}

export function followThroughReply(outcome: FollowThrough): string {
  const sent = outcome.steps.filter((step) => step.hash && !step.skipped);
  if (sent.length === 0) return "The last plan completed without broadcasting a transaction.";
  const lines = sent.map((step) => `${step.title}: ${step.hash}`);
  return `The last plan completed successfully.\n\n${lines.join("\n")}`;
}

export async function reconcileFollowThrough(
  outcome: FollowThrough,
  readReceipt: (hash: string) => Promise<{ status?: number } | null>,
): Promise<FollowThrough> {
  const steps = await Promise.all(outcome.steps.map(async (step) => {
    if (!step.hash || step.skipped) return step;
    try {
      const receipt = await readReceipt(step.hash);
      if (!receipt) return step;
      return { ...step, status: receipt.status === 0 ? "reverted" : "confirmed" };
    } catch {
      return step;
    }
  }));
  return { ...outcome, steps };
}

export function reviveFollowThrough(raw: unknown): FollowThrough | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<FollowThrough>;
  if ((value.kind !== "confirmed" && value.kind !== "nothing") || typeof value.at !== "number" || !Array.isArray(value.steps)) return null;
  const steps = value.steps.filter((step): step is SettledLike => {
    if (!step || typeof step !== "object") return false;
    const item = step as Partial<SettledLike>;
    return typeof item.title === "string" && typeof item.skipped === "boolean" &&
      (item.hash === undefined || typeof item.hash === "string") &&
      (item.ms === undefined || typeof item.ms === "number");
  });
  return steps.length === value.steps.length ? { kind: value.kind, steps, at: value.at } : null;
}
