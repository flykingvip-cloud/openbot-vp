/**
 * Opt-in Runtime façade call site on the execution-preflight surface.
 *
 * Not imported by the preflight builder, trace writers, or the preflight
 * barrel. Does not read the process environment. Maps already-held receipt
 * and trace rows into the constitutional shadow report. Does not write them back.
 */
import {
  runRuntimeFacadeShadow,
  type RuntimeFacadeShadowOptions,
  type RuntimeFacadeShadowResult,
} from "../../../packages/constitutional-contracts/src/index.js";
import type { ExecutionTraceRecord, ValidationReceipt } from "./types.js";

export const PREFLIGHT_RUNTIME_FACADE_SURFACE = "execution-preflight" as const;

export type PreflightRuntimeFacadeInput = RuntimeFacadeShadowOptions & {
  validationReceipts?: readonly ValidationReceipt[];
  executionTraces?: readonly ExecutionTraceRecord[];
};

export type PreflightRuntimeFacadeResult = RuntimeFacadeShadowResult & {
  surface: typeof PREFLIGHT_RUNTIME_FACADE_SURFACE;
  wroteReceipt: false;
  wroteTrace: false;
};

function toReceiptSource(receipt: ValidationReceipt) {
  return {
    taskId: receipt.taskId,
    artifactHash: receipt.artifactHash,
    validatorId: receipt.validatorId,
    timestamp: receipt.timestamp,
    result: receipt.result,
  };
}

function toTraceSource(trace: ExecutionTraceRecord) {
  return {
    taskId: trace.taskId,
    sessionId: trace.sessionId,
    decisionCode: trace.decisionCode,
    decisionStage: trace.decisionStage,
  };
}

/**
 * Report-only shadow observation over injected preflight rows.
 * Never writes a receipt, never writes a trace, never blocks a turn.
 */
export function observePreflightRuntimeFacade(
  input: PreflightRuntimeFacadeInput = {},
): PreflightRuntimeFacadeResult {
  const shadow = runRuntimeFacadeShadow(
    {
      sources: {
        validationReceipts: input.validationReceipts?.map(toReceiptSource),
        executionTraces: input.executionTraces?.map(toTraceSource),
      },
    },
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
    surface: PREFLIGHT_RUNTIME_FACADE_SURFACE,
    wroteReceipt: false,
    wroteTrace: false,
  };
}
