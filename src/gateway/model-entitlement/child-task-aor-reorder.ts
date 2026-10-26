/**
 * Re-rank an already-authorized model set for a child/subagent task.
 *
 * Parent preferredModelOrder must not be copied wholesale: the child task
 * category drives AOR scoring inside the parent allowlist (no entitlement
 * expansion).
 */

import type { ModelProfile, SelectionStrategy } from "@openbot/aor-core";
import { selectModelOrderWithinEffectiveSet } from "./aor-selection.js";
import {
  buildTaskCapabilityPlan,
  classifyTaskCapability,
  resolveExecutionRoutingFromCapabilityPlan,
  type ContextEstimateParts,
  type TaskCapabilityPlan,
  type CapabilityExecutionSurface,
  type CapabilityPlanOutcomeClaim,
} from "./task-capability-plan.js";

export type ChildTaskAorReorderInput = {
  taskText: string;
  /** Parent authorized allowlist — never enlarged. */
  authorizedModelIds: readonly string[];
  /**
   * Optional parent order used only as a stable tie-break / native fallback.
   * When mode is aor_enhanced, child category scoring replaces this order.
   */
  parentPreferredModelOrder?: readonly string[];
  mode?: "native" | "aor_enhanced";
  selectorStrategy?: SelectionStrategy;
  catalog?: readonly ModelProfile[];
  modelContextWindows?: Readonly<Record<string, number>>;
  contextParts?: ContextEstimateParts;
};

export type ChildTaskAorReorderResult = {
  categoryId: string;
  classificationSource: "task_text" | "heuristic_default";
  /** Re-ranked order ⊆ authorized; for aor_enhanced reflects child task scoring. */
  preferredModelOrder: string[];
  allowlist: string[];
  capabilityPlan: TaskCapabilityPlan;
  outcomeClaim?: CapabilityPlanOutcomeClaim;
  executionSurface?: CapabilityExecutionSurface;
  planFailure: TaskCapabilityPlan["failure"];
};

/**
 * Classify the child task and rebuild preferred order inside the parent
 * authorized set. Does not inherit the parent's AOR order as the scoring basis.
 */
export function reorderAuthorizedModelsForChildTask(
  input: ChildTaskAorReorderInput,
): ChildTaskAorReorderResult {
  const authorized = [
    ...new Set(input.authorizedModelIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ];
  const classification = classifyTaskCapability(input.taskText);
  const mode = input.mode ?? "aor_enhanced";
  const selectorStrategy = input.selectorStrategy ?? "balanced";

  let preferredFromAuth: string[] = [...(input.parentPreferredModelOrder ?? authorized)];
  // Drop any parent ids outside authorized (defense in depth).
  preferredFromAuth = preferredFromAuth.filter((id) => authorized.includes(id));
  for (const id of authorized) {
    if (!preferredFromAuth.includes(id)) {
      preferredFromAuth.push(id);
    }
  }

  if (mode === "aor_enhanced" && classification.classificationSource === "task_text") {
    const selection = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: authorized,
      aorExecution: {
        taskTypeId: classification.categoryId,
        selectorStrategy,
        evaluatorMode: "content",
      },
      catalog: input.catalog ?? [],
    });
    preferredFromAuth = selection.orderedModelIds;
  } else if (mode === "native") {
    // Native: keep authorized set order (or parent allowlist order), no AOR re-score.
    preferredFromAuth = [...authorized];
  }

  const capabilityPlan = buildTaskCapabilityPlan({
    taskText: input.taskText,
    authorizedModelIds: authorized,
    preferredModelOrderFromAuth: preferredFromAuth,
    modelContextWindows: input.modelContextWindows,
    ...(input.contextParts ? { contextParts: input.contextParts } : {}),
  });

  const routing = resolveExecutionRoutingFromCapabilityPlan({
    allowlist: authorized,
    preferredModelOrder: preferredFromAuth,
    capabilityPlan,
  });

  return {
    categoryId: classification.categoryId,
    classificationSource: classification.classificationSource,
    preferredModelOrder: routing.preferredModelOrder ?? [],
    allowlist: routing.allowlist ?? [...capabilityPlan.executableModelIds],
    capabilityPlan,
    planFailure: routing.planFailure,
    ...(routing.outcomeClaim ? { outcomeClaim: routing.outcomeClaim } : {}),
    ...(routing.executionSurface ? { executionSurface: routing.executionSurface } : {}),
  };
}
