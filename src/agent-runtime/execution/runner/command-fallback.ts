import {
  runWithModelFallback,
  type ModelFallbackRunOptions,
} from "../../../agents/model-fallback.js";

/** Original fallback engine, with command retry identity owned by execution. No extra retry loop. */
export function runCommandFallback<T>(
  input: Omit<Parameters<typeof runWithModelFallback<T>>[0], "run"> & {
    run: (
      provider: string,
      model: string,
      options: ModelFallbackRunOptions | undefined,
      isFallbackRetry: boolean,
    ) => Promise<T>;
  },
) {
  let attemptIndex = 0;
  const { run, ...options } = input;
  return runWithModelFallback({
    ...options,
    run: (provider, model, runOptions) => {
      const isFallbackRetry = attemptIndex > 0;
      attemptIndex += 1;
      return run(provider, model, runOptions, isFallbackRetry);
    },
  });
}
