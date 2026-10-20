/**
 * Opt-in Runtime façade call site on the dormant task-orchestration surface.
 *
 * Not imported by gateway-hook, dispatch, or chat.send. Does not read
 * `process.env` and does not call `considerDispatch`. Preflight-shaped rows
 * are injected source records. This is not a second execution state machine.
 */
import {
  runRuntimeFacadeShadow,
  type ConstitutionalSourceSnapshot,
  type RuntimeFacadeShadowOptions,
  type RuntimeFacadeShadowResult,
} from "../../packages/constitutional-contracts/src/index.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

export const ORCHESTRATION_RUNTIME_FACADE_SURFACE = "task-orchestration" as const;

export type OrchestrationRuntimeFacadeInput = RuntimeFacadeShadowOptions & {
  sources?: ConstitutionalSourceSnapshot;
};

export type OrchestrationRuntimeFacadeResult = RuntimeFacadeShadowResult & {
  surface: typeof ORCHESTRATION_RUNTIME_FACADE_SURFACE;
  /** Echo of the frozen constant. This function does not flip it. */
  orchestrationLiveInvoke: false;
  dispatchInvoked: false;
  enqueued: false;
};

/**
 * Report-only shadow observation.
 * `ORCHESTRATION_LIVE_INVOKE` must stay false; this function never dispatches.
 */
export function observeOrchestrationRuntimeFacade(
  input: OrchestrationRuntimeFacadeInput = {},
): OrchestrationRuntimeFacadeResult {
  const orchestrationLiveInvoke: false = ORCHESTRATION_LIVE_INVOKE;
  const shadow = runRuntimeFacadeShadow(
    { sources: input.sources },
    {
      env: input.env,
      shadow: input.shadow,
      enforce: input.enforce,
      candidatePath: input.candidatePath,
      workflowRef: input.workflowRef,
    },
  );
  return {
    ...shadow,
    surface: ORCHESTRATION_RUNTIME_FACADE_SURFACE,
    orchestrationLiveInvoke,
    dispatchInvoked: false,
    enqueued: false,
  };
}
