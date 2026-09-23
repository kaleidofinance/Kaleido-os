import {
  browserLocalIntentOptions,
  canUseBrowserLocalModel,
  validateLocalClassification,
  type BrowserLocalIntentModel,
  type BrowserLocalIntentModelOptions,
  type LocalIntentContext,
  type LocalIntentClassification,
} from "./localIntent";

type WorkerRequest = {
  id: number;
  text: string;
  context: LocalIntentContext;
  options: Required<BrowserLocalIntentModelOptions>;
};

type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

/**
 * Lazy browser-local classifier. The model is never imported on the server and
 * is not downloaded until the first ambiguous turn reaches this adapter. A
 * worker keeps ONNX/WebGPU work off Luca's render thread; failure simply lets
 * the existing server route handle the turn.
 */
export function createBrowserLocalIntentModel(
  options: BrowserLocalIntentModelOptions = {},
): BrowserLocalIntentModel | null {
  if (!canUseBrowserLocalModel()) return null;

  const resolved = { ...browserLocalIntentOptions(), ...options };
  let worker: Worker;
  try {
    worker = new Worker(new URL("./browserLocalIntent.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null;
  }

  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: LocalIntentClassification) => void; reject: (error: Error) => void; timer: number }
  >();

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    window.clearTimeout(entry.timer);
    if (message.ok) entry.resolve(validateLocalClassification(message.value));
    else entry.reject(new Error(message.error));
  };

  const failAll = (error: Error) => {
    for (const [id, entry] of pending) {
      window.clearTimeout(entry.timer);
      entry.reject(error);
      pending.delete(id);
    }
  };
  worker.onerror = () => failAll(new Error("browser local intent worker failed"));

  return {
    classify(text, context) {
      return new Promise<LocalIntentClassification>((resolve, reject) => {
        const id = ++nextId;
        const timer = window.setTimeout(() => {
          pending.delete(id);
          reject(new Error("browser local intent timed out"));
        }, 8_000);
        pending.set(id, { resolve, reject, timer });
        const request: WorkerRequest = { id, text, context, options: resolved };
        worker.postMessage(request);
      });
    },
  };
}
