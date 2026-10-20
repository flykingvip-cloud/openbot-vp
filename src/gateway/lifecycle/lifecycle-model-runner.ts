import type { GatedModelRunner } from "./gated-candidate-run.js";

/**
 * Dormant model-runner seam for the lifecycle gated producers (Phase C).
 *
 * The repo has no lightweight one-shot LLM helper; real text generation is the heavy
 * embedded-agent path. Following the steward M4b `generateSuggestionText` precedent,
 * the lifecycle producers (minutes / invite / extraction) take an injected runner, and
 * this module is the single place a real runner is wired. It is `null` by default
 * (dormant): callers that find no runner MUST degrade to a clear "unavailable" outcome
 * rather than fabricating one — never a fake success, never a crash.
 *
 * When the real runner is wired (a future change), it adapts the embedded-agent path to
 * `GatedModelRunner` (prompt -> { text, usageQuantity }) and is set here once at startup.
 */
let lifecycleModelRunner: GatedModelRunner | null = null;

/** Returns the wired runner, or null when the model step is dormant. */
export function getLifecycleModelRunner(): GatedModelRunner | null {
  return lifecycleModelRunner;
}

/** Wires the real runner (or a test stub). Pass null to reset (tests / teardown). */
export function setLifecycleModelRunner(next: GatedModelRunner | null): void {
  lifecycleModelRunner = next;
}
