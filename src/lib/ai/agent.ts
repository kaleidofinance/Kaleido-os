import {
  TOOL_CATALOG,
  buildSystemPrompt,
  runReadTool,
  type ChatMessage,
  type ChatProvider,
  type ChatResult,
  type Guardrails,
  type ReadCall,
} from "./index";
import { readKey } from "./readKey";

/**
 * The agent loop.
 *
 * Every READ tool in the catalog is reachable here — not just a hardcoded
 * default. Whatever the model calls (getQuote, getPortfolio, getMarkets,
 * getChains, in any combination or order) gets executed server-side and fed
 * back, so "plan across protocols and chains" actually has the tools to do
 * it: check markets, get a quote, check where funds sit across chains, then
 * commit to a plan.
 *
 * Bounded at MAX_READ_ROUNDS so a model that never converges can't loop
 * forever — after the cap we return whatever text it has rather than error.
 *
 * Within one turn a given read runs once: asking the chain the same question
 * again cannot improve the answer and has been observed to degrade it, so
 * repeats are served from the results already in hand. See `served` below.
 *
 * On the very first turn, if the model didn't ask for anything but we have a
 * wallet address, we still seed portfolio context — most opening messages
 * ("what should I do?") benefit from it even when the model doesn't think to
 * ask, and it costs one extra read tool call to get right by default.
 */

const MAX_READ_ROUNDS = 3;

export interface AgentInput {
  message: string;
  address?: string;
  chainId?: number;
  limits?: Guardrails;
  /**
   * What was already said in this conversation, oldest first, excluding
   * `message` itself.
   *
   * Absent until 2026-09-03, and its absence was visible to users. The turn is
   * local-first: the grammar and the FAQ answer most sentences on the client and
   * only what neither can read reaches this loop. So the model was routinely
   * handed the *second half* of an exchange — "use USDC" with no record that
   * anything had offered USDC — and it either asked the user to repeat
   * themselves or guessed at which of Luca's own earlier answers it was
   * continuing.
   *
   * Every entry is client input and is sanitised at the route, not here: this
   * loop's contract is that `messages` is already fit to send. See
   * `historyFromBody` in app/api/chat/route.ts for the bound and the trimming,
   * and note the shape is deliberately `ChatMessage` and not the page's `Msg` —
   * a turn's plan, cards and trace are frames the client draws, and replaying
   * them into a prompt would spend tokens on our own rendering.
   */
  history?: ChatMessage[];
}

/**
 * The reply, plus what was read to reach it.
 *
 * `trace` is the loop's own record: every read tool that actually ran, in order,
 * across every round. It used to be discarded — `result` is only the final
 * round, so a turn that read a portfolio, then a quote, then answered came back
 * with `reads: []` and no sign that either call had happened.
 *
 * It is the closest thing to the model's reasoning this route can honestly
 * report. No provider thinking is requested, so there are no reasoning tokens to
 * show; what there is, is which questions it asked about the outside world before
 * answering. The frontend turns these into the turn's thought process — see
 * `traceFromChat` in src/lib/v2/agentTurn.ts.
 */
export interface AgentRun extends ChatResult {
  trace: ReadCall[];
}

/**
 * Optional hooks that let a caller watch the turn happen instead of waiting for
 * it. Passing none is the whole of the old behaviour, unchanged.
 *
 * The loop is the only place that knows a turn is several model calls with tool
 * work between them, so it is the only place that can report progress in the
 * order it happened. Without this, a caller streaming the provider directly
 * would emit each round's prose with no way to tell which round was the answer.
 */
export interface AgentEvents {
  /**
   * Prose as the model writes it. Requesting deltas is what opts the loop into
   * `provider.chatStream`; a provider that does not implement it silently falls
   * back to the buffered call and this is simply never called.
   *
   * Fires for *every* round, including the ones that turn out to be preamble
   * ("Let me check your balances") before a tool call. `onReads` marks those
   * boundaries, so a caller can tell the answer from the thinking out loud.
   */
  onText?: (delta: string) => void;
  /**
   * One round's reads, fired after they have actually run — the same calls, in
   * the same order, that land in `trace`. Reaching this at all means the round
   * just streamed was not the final one.
   */
  onReads?: (calls: ReadCall[]) => void;
}

export async function runAgent(
  provider: ChatProvider,
  input: AgentInput,
  events?: AgentEvents,
): Promise<AgentRun> {
  const system = buildSystemPrompt({
    address: input.address,
    chainId: input.chainId,
    limits: input.limits,
  });

  /* History first, then this turn's message. The loop appends its own
     assistant/tool-result pairs onto the end of this array, so prior turns have
     to be in front of the current message or the round-trips would interleave
     with them and the model would read the tool results as answering an older
     question. */
  const messages: ChatMessage[] = [
    ...(input.history ?? []),
    { role: "user", content: input.message },
  ];

  /* One call site for the model, so every round streams or none does. Streaming
     is chosen per turn rather than per provider: the caller asking for deltas is
     what makes them worth the different code path. */
  const ask = () =>
    events?.onText && provider.chatStream
      ? provider.chatStream(
          { system, messages, tools: TOOL_CATALOG },
          events.onText,
        )
      : provider.chat({ system, messages, tools: TOOL_CATALOG });

  let result = await ask();
  const trace: ReadCall[] = [];

  /**
   * Every read this turn has already run, by `readKey`.
   *
   * A turn is one question from the user, so asking the chain the same thing
   * twice inside it cannot produce a better answer — but it can produce a worse
   * one. Observed twice in a row on 2026-08-31: getPortfolio ran, came back with
   * zeros, ran again on the same address, and the second call reported collateral
   * and health factor unavailable. Sepolia-class endpoints return a rate limit as
   * HTTP 200 with a JSON-RPC error (see lib/dex/rpcRetry.ts), so a needless retry
   * is exactly where that surfaces. The reply then opened by retracting itself —
   * "correction on what I said a moment ago" — which reads as the agent being
   * unreliable about the user's own balance.
   *
   * The duplicate turned out to be the seed below rather than the model asking
   * twice, and this map is what the seed's guard now reads. It covers the model
   * repeating itself too, which is cheap to do once the keys exist: a repeat is
   * served from here instead of re-rolling the dice, and the round that asked for
   * nothing new adds no line to the trace, because it did not touch the chain and
   * a second "checked your positions" is noise in a transcript whose whole purpose
   * is to be short.
   */
  const served = new Map<string, unknown>();

  for (let round = 0; round < MAX_READ_ROUNDS; round++) {
    // Execute verbs mean it had what it needed — stop.
    if (result.executes.length > 0) break;

    let contextBlock: string | null = null;
    let repeated = 0;

    if (result.reads.length > 0) {
      /* Run exactly what the model asked for, whatever mix of tools that is, all
         against the chain the user is actually connected to — minus anything it
         has already asked for this turn, which `served` answers instead. */
      const fresh = result.reads.filter(
        (r) => !served.has(readKey(r.name, r.args)),
      );
      repeated = result.reads.length - fresh.length;

      await Promise.all(
        fresh.map(async (r) => {
          served.set(
            readKey(r.name, r.args),
            await runReadTool(r.name, r.args, input.chainId),
          );
        }),
      );

      const resolved = result.reads.map((r) => ({
        tool: r.name,
        args: r.args,
        result: served.get(readKey(r.name, r.args)),
      }));

      /* Recorded after the await, so the trace lists reads that ran rather than
         reads that were requested: a tool that throws takes the whole round down
         with it, and it should not leave a line claiming it was consulted. A
         repeat is left out for the same reason — nothing ran. The round is still
         announced when nothing was fresh, because that frame is also what tells
         the client this prose was preamble; withholding it would leave a
         paragraph sitting in the reply that the saved version does not contain. */
      const ran = fresh.map((r) => ({ name: r.name, args: r.args }));
      trace.push(...ran);
      events?.onReads?.(ran);
      contextBlock = JSON.stringify(resolved, null, 2);
    } else if (served.size === 0 && input.address) {
      /* The seed grounds a turn that never touched the chain at all — not every
         round that happens to ask for nothing.

         `served.size` and not a "did I seed yet" flag, because that flag only
         stopped the seed running twice; it never asked whether the read had
         already happened by the model's own request. Instrumented on 2026-08-31:
         round 0 the model called getPortfolio and got zeros, round 1 it asked for
         nothing because it was writing the answer — and the seed fired anyway,
         re-read the same address, got collateral and health factor unavailable
         this time, and forced a further round whose reply opened by correcting
         the answer the user had just watched appear. A round with no reads after
         a read has landed means the model is done, so the loop should end there
         and let its text stand. */
      const portfolio = await runReadTool(
        "getPortfolio",
        { address: input.address },
        input.chainId,
      );
      /* Traced like any other read, and deliberately not flagged as ours: it
         grounded the answer either way, and "your balances were read" is the part
         the user cares about — not whose idea the call was. */
      const seed = { name: "getPortfolio", args: { address: input.address } };
      served.set(readKey(seed.name, seed.args), portfolio);
      trace.push(seed);
      events?.onReads?.([seed]);
      contextBlock = JSON.stringify(
        [
          {
            tool: "getPortfolio",
            args: { address: input.address },
            result: portfolio,
          },
        ],
        null,
        2,
      );
    } else {
      // Nothing left to ground on — whatever text the model has is final.
      break;
    }

    messages.push({
      role: "assistant",
      content: result.text || "(tool calls only)",
    });
    messages.push({
      role: "user",
      content:
        `Tool results:\n\n${contextBlock}\n\n` +
        "Use only this data — don't estimate. If you now have enough to answer or " +
        "propose a plan, do so; call execute tools for anything signable. If you still " +
        "need more information, call another read tool." +
        /* Saying that a repeat was a repeat is what stops a third round. Without
           it the model asks again, spends the round cap, and every round it
           spends is another paragraph the user watches get demoted to a line of
           thought process. */
        (repeated
          ? " You already asked for some of this, and what is above is what came " +
            "back the first time. It will not change within this turn — answer " +
            "from it rather than reading again."
          : ""),
    });

    result = await ask();
  }

  return { ...result, trace };
}
