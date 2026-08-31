/**
 * One reader for tool-call arguments, shared by both adapters.
 *
 * Arguments arrive as a JSON *string* in the OpenAI format and as JSON
 * *fragments* in a stream, so in both cases something has to parse text a model
 * wrote and decide what to do when it does not parse.
 *
 * The answer is: drop the call. Returning `{}` — which this used to do — is the
 * tempting option and the wrong one, because an empty object is a legitimate
 * thing for a no-argument tool to send. A truncated `{"amount":"1` would become
 * a call that looks complete and is missing its amount, and downstream that is a
 * plan step, an approval, a signature. A call that never appears is visible; a
 * call whose numbers quietly vanished is not.
 */
export function parseToolArgs(
  raw: string,
  label: string,
  provider: string,
): Record<string, unknown> | null {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.warn(`[${provider}] dropped ${label}: unparseable arguments`);
    return null;
  }
}
