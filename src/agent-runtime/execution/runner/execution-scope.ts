import type { ModelInferenceInput, ModelInferenceResult } from "../../model/index.js";

type Preparation = { kind: "ready" | "denied" | "unavailable" };
type Candidate<T> = ModelInferenceInput<T>["run"];
export type ExecutionInferenceInput<T> = Omit<ModelInferenceInput<T>, "run"> & {
  run: (...args: [...Parameters<Candidate<T>>, isFallbackRetry: boolean]) => Promise<T>;
};

/** Single stage-order owner. Fixed authority adapters supply policy, never another loop. */
export function createExecutionScope<
  Input extends { signal?: AbortSignal },
  Result extends Preparation,
>(ports: {
  prepare: (input: Input) => Promise<Result>;
  infer: <T>(input: ModelInferenceInput<T>) => Promise<ModelInferenceResult<T>>;
  dispose: () => Promise<void>;
}) {
  let ready = false;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  let signal: AbortSignal | undefined;
  return {
    async prepare(input: Input) {
      ready = false;
      if (disposed) {
        throw new Error("Execution lifecycle is disposed");
      }
      input.signal?.throwIfAborted();
      const result = await ports.prepare(input);
      input.signal?.throwIfAborted();
      signal = input.signal;
      ready = result.kind === "ready";
      return result;
    },
    infer<T>(input: ExecutionInferenceInput<T>) {
      if (!ready || disposed) {
        throw new Error("Execution lifecycle is not prepared");
      }
      const effectiveSignal =
        signal && input.signal ? AbortSignal.any([signal, input.signal]) : (signal ?? input.signal);
      effectiveSignal?.throwIfAborted();
      let attempt = 0;
      return ports
        .infer({
          ...input,
          signal: effectiveSignal,
          run: async (provider, model, options) => {
            effectiveSignal?.throwIfAborted();
            const result = await input.run(provider, model, options, attempt++ > 0);
            effectiveSignal?.throwIfAborted();
            return result;
          },
        })
        .then((result) => {
          effectiveSignal?.throwIfAborted();
          return result;
        });
    },
    dispose() {
      ready = false;
      disposed = true;
      return (disposal ??= ports.dispose());
    },
  };
}
