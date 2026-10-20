/**
 * Tick writer privilege is a module-private brand + import guard.
 * It is not a cryptographic or process-level unforgeable capability.
 * Any new production module can still import this file; the real
 * boundary is the import allowlist and review. Issuer stays in this
 * module closure. Allowed importers: tick-pipeline (bound writers)
 * and the two SoT writers (assert only). Architecture tests forbid
 * any other import.
 */

import {
  recordRuntimeProbeEffectObservation,
  type RecordRuntimeProbeInput,
} from "./effect-observations.js";
import { persistOpenWindowEvaluation, submitTickEffectDecision } from "./effect-verifications.js";

const TICK_WRITER_BRAND = Symbol("governance-tick-writer");
const tickWriter = { [TICK_WRITER_BRAND]: true as const };

export function assertTickWriterCapability(capability: unknown): void {
  if (capability !== tickWriter) {
    throw new Error("tick-writer-capability-required");
  }
}

export const governanceTickWriters = {
  recordRuntimeProbe(input: Omit<RecordRuntimeProbeInput, "capability">, configDir?: string) {
    return recordRuntimeProbeEffectObservation({ ...input, capability: tickWriter }, configDir);
  },
  submitDecision(
    input: Omit<Parameters<typeof submitTickEffectDecision>[0], "capability">,
    configDir?: string,
  ) {
    return submitTickEffectDecision({ ...input, capability: tickWriter }, configDir);
  },
  persistEvaluation(
    input: Omit<Parameters<typeof persistOpenWindowEvaluation>[0], "capability">,
    configDir?: string,
  ) {
    return persistOpenWindowEvaluation({ ...input, capability: tickWriter }, configDir);
  },
};
