/* Bypass the package export map so Next cannot select the Node entry while
 * compiling this dedicated browser worker. */
// @ts-expect-error The package's browser build is shipped as a JS entry without a declaration.
import { pipeline } from "../../../node_modules/@huggingface/transformers/dist/transformers.js";
import { validateLocalClassification, type LocalIntentContext } from "./localIntent";

type Request = {
  id: number;
  text: string;
  context: LocalIntentContext;
  options: {
    modelId: string;
    device: "webgpu" | "wasm";
    dtype: "q4" | "q4f16" | "int8" | "fp16";
  };
};

type Scope = {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(value: unknown): void;
};

const scope = self as unknown as Scope;
let generatorPromise: Promise<any> | null = null;
let loadedKey = "";

const systemPrompt = [
  "Classify the user's latest message for a DeFi assistant.",
  "Return JSON only with exactly these fields:",
  '{"kind":"fresh|follow_up|question|unknown","reference":"previous_command|active_task|none","reason":"short"}',
  "Never include amounts, token symbols, addresses, chains, routes, or transaction instructions in the JSON.",
].join(" ");

async function getGenerator(request: Request) {
  const key = `${request.options.modelId}:${request.options.device}:${request.options.dtype}`;
  if (!generatorPromise || loadedKey !== key) {
    loadedKey = key;
    generatorPromise = pipeline("text-generation", request.options.modelId, {
      device: request.options.device,
      dtype: request.options.dtype,
    }).catch(async (error: unknown) => {
      /* WebGPU is an acceleration path, not a requirement. Some browsers
       * expose navigator.gpu but cannot allocate the model; retry once on the
       * CPU/WASM backend before giving up. */
      if (request.options.device !== "webgpu") throw error;
      loadedKey = `${request.options.modelId}:wasm:${request.options.dtype}`;
      return pipeline("text-generation", request.options.modelId, {
        device: "wasm",
        dtype: request.options.dtype,
      });
    });
  }
  return generatorPromise;
}

function extractText(output: any): string {
  const generated = output?.[0]?.generated_text;
  if (typeof generated === "string") return generated;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    return typeof last?.content === "string" ? last.content : "";
  }
  return "";
}

function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced ?? text).match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return { kind: "unknown" };
  try {
    return JSON.parse(candidate);
  } catch {
    return { kind: "unknown" };
  }
}

scope.onmessage = async ({ data }) => {
  try {
    const generator = await getGenerator(data);
    const prompt = JSON.stringify({
      latest: data.text,
      context: data.context,
    });
    const output = await generator(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      { max_new_tokens: 80, do_sample: false },
    );
    scope.postMessage({ id: data.id, ok: true, value: validateLocalClassification(parseJson(extractText(output))) });
  } catch (error) {
    scope.postMessage({
      id: data.id,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 160) : "local model failed",
    });
  }
};
