/**
 * Plugin loader memory-slot orchestration helper.
 *
 * Owns the loader-side mutable state (`memorySlotMatched`,
 * `selectedMemoryPluginId`) that drives the memory-slot policy through the
 * load loop. Extracted per the `gateway-plugins-monolith-decomposition` spec
 * (Task 3.4).
 *
 * The actual slot policy — the pure decision function
 * `resolveMemorySlotDecision` — STAYS in `src/plugins/config-state.ts`. This
 * module only holds the small amount of mutable state the loader needs to
 * thread between candidate iterations and the post-loop diagnostic, plus a
 * thin wrapper around the policy call so the loop body never has to touch
 * the locals directly (Req 4.5, 4.7, 4.8).
 *
 * Behavior contract: the returned tracker reproduces the pre-refactor
 * sequencing exactly:
 *   1. `evaluateForRecord` always reads the latest `selectedMemoryPluginId`.
 *   2. `markMatchedFromManifest` only flips `memorySlotMatched` when
 *      `kind === "memory"` AND the configured slot id matches the record id
 *      (post-export resolution; the early bundled fast-path skips this
 *      because no manifest-vs-export reconciliation has happened yet).
 *   3. `commitSelectionIfApplicable` only writes `selectedMemoryPluginId`
 *      when both the record's resolved kind is `"memory"` and the policy
 *      returned `selected: true`.
 *   4. `pushUnmatchedSlotDiagnostic` fires only when the slot is a string
 *      and no candidate matched it during the loop.
 */

import { resolveMemorySlotDecision } from "../config-state.js";
import type { PluginRegistry } from "../registry.js";

export type MemorySlotDecision = {
  enabled: boolean;
  reason?: string;
  selected?: boolean;
};

export type MemorySlotTracker = {
  /**
   * The configured `plugins.slots.memory` value (string id, `null` to
   * disable, or `undefined` to leave unconstrained). Read-only on the
   * tracker; the loader still references it in the early bundled fast-path.
   */
  readonly slot: string | null | undefined;
  /**
   * Apply the slot policy to the given record using the tracker's current
   * `selectedMemoryPluginId`. Caller is responsible for acting on the
   * returned `enabled` flag; on `selected: true` the caller MUST follow up
   * with `commitSelectionIfApplicable` after any side-effects (record
   * registration etc.) succeed.
   */
  evaluateForRecord(input: { id: string; kind?: string }): MemorySlotDecision;
  /**
   * If the given record's manifest-resolved kind is `"memory"` and matches
   * the configured slot id, flag the slot as matched so the post-loop
   * diagnostic is suppressed. Idempotent.
   */
  markMatchedFromManifest(input: { id: string; kind?: string }): void;
  /**
   * Persist `record.id` as the active memory plugin when the policy chose
   * it AND the record's resolved kind is `"memory"`. Mirrors the
   * pre-refactor `if (memoryDecision.selected && record.kind === "memory")`
   * gate exactly.
   */
  commitSelectionIfApplicable(
    input: { id: string; kind?: string },
    decision: MemorySlotDecision,
  ): void;
  /**
   * Push the post-loop "memory slot plugin not found" warning when the slot
   * was configured to a string id but no candidate matched it.
   */
  pushUnmatchedSlotDiagnostic(registry: PluginRegistry): void;
};

/**
 * Build a fresh tracker. Each `loadOpenBotPlugins` invocation gets its own
 * tracker; the state is intentionally per-call so cached registries do not
 * leak slot decisions across reloads.
 */
export function createMemorySlotTracker(slot: string | null | undefined): MemorySlotTracker {
  let selectedMemoryPluginId: string | null = null;
  let memorySlotMatched = false;

  return {
    slot,
    evaluateForRecord(input) {
      return resolveMemorySlotDecision({
        id: input.id,
        kind: input.kind,
        slot,
        selectedId: selectedMemoryPluginId,
      });
    },
    markMatchedFromManifest(input) {
      if (input.kind === "memory" && slot === input.id) {
        memorySlotMatched = true;
      }
    },
    commitSelectionIfApplicable(input, decision) {
      if (decision.selected && input.kind === "memory") {
        selectedMemoryPluginId = input.id;
      }
    },
    pushUnmatchedSlotDiagnostic(registry) {
      if (typeof slot === "string" && !memorySlotMatched) {
        registry.diagnostics.push({
          level: "warn",
          message: `memory slot plugin not found or not marked as memory: ${slot}`,
        });
      }
    },
  };
}
