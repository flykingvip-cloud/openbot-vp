/**
 * Minimal per-run deps for the Constitutional runtime shadow observation
 * (Checkpoint C first slice).
 *
 * Type only: no factory and no environment access here. The outer runner
 * builds one frozen object per run from the parsed flag boolean, the
 * module-level no-op sink and a clock, and passes that same object to every
 * attempt through `EmbeddedRunAttemptParams`. Deps never carry an environment
 * object, copy or map, the raw flag string, request or config data, session
 * keys or tenant ids. Exactly three own keys.
 */
import type { ConstitutionalRuntimeShadowSink } from "./constitutional-runtime-shadow-sink.js";

export type ConstitutionalRuntimeShadowDeps = Readonly<{
  runtimeShadowEnabled: boolean;
  sink: ConstitutionalRuntimeShadowSink;
  now: () => number;
}>;
