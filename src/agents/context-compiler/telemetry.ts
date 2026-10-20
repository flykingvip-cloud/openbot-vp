import type { ContextCompileTelemetry } from "./types.js";

export function contextCompileTelemetryExtra(
  telemetry: ContextCompileTelemetry,
): Record<string, unknown> {
  return {
    lane: telemetry.lane,
    preCompileMessageCount: telemetry.preCompileMessageCount,
    postCompileMessageCount: telemetry.postCompileMessageCount,
    preCompileEstimatedTokens: telemetry.preCompileEstimatedTokens,
    postCompileEstimatedTokens: telemetry.postCompileEstimatedTokens,
    admissionBudgetTokens: telemetry.admissionBudgetTokens,
    targetBudgetTokens: telemetry.targetBudgetTokens,
    unitCountBefore: telemetry.unitCountBefore,
    unitCountAfter: telemetry.unitCountAfter,
    compileMs: telemetry.compileMs,
    dropCount: Array.isArray(telemetry.contextDropReasons)
      ? telemetry.contextDropReasons.length
      : 0,
    dropReasons: telemetry.contextDropReasons,
    currentTurnPreserved: telemetry.recallSafety.currentTurnPreserved,
    activeTaskPreserved: telemetry.recallSafety.activeTaskPreserved,
    toolTransactionIntegrity: telemetry.recallSafety.toolTransactionIntegrity,
    requiredMemoryPreserved: telemetry.recallSafety.requiredMemoryPreserved,
    ...(telemetry.providerMessageCount !== undefined
      ? { providerMessageCount: telemetry.providerMessageCount }
      : {}),
    ...(telemetry.providerBoundaryMatch !== undefined
      ? { providerBoundaryMatch: telemetry.providerBoundaryMatch }
      : {}),
  };
}
