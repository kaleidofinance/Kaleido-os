/**
 * Requests that need fresh protocol state rather than a cached explanation.
 *
 * This is deliberately a routing hint, not an answer classifier. It never
 * creates a transaction or chooses a tool; it only keeps dynamic questions out
 * of the FAQ/docs/local-model lanes so the server agent can read live state.
 */
const DOMAIN_WORD =
  /\b(?:yield|apy|apr|rate|lend(?:ing)?|borrow(?:ing)?|liquidity|pool(?:s)?|swap|bridge|route|protocol|market|volume|fee|revenue|portfolio|balance|chain|aggregator|launchpad|vault|stake|staking)\b/i;

const FRESHNESS_WORD =
  /\b(?:find|show|where|which|best|compare|current|live|available|latest|today|now|across|how\s+much|what\s+can\s+i|what\s+is\s+available)\b/i;

const OPEN_ANALYSIS_PHRASE =
  /\b(?:yield\s+source|yield\s+opportunit|best\s+(?:rate|yield)|compare\s+(?:protocol|venue|market)|analy[sz](?:e|ing)|research|what\s+should\s+i\s+use)\b/i;

/**
 * Whether this turn needs a live read/reasoning path.
 *
 * A plain definition such as "what is APR" is intentionally not marked live;
 * a request for an opportunity, venue, rate, chain state, or comparison is.
 * Imperatives such as "find yield on Elysium" are included even when they do
 * not end in a question mark.
 */
export function isLiveAnalysisRequest(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || !DOMAIN_WORD.test(normalized)) return false;
  return (
    FRESHNESS_WORD.test(normalized) || OPEN_ANALYSIS_PHRASE.test(normalized)
  );
}
