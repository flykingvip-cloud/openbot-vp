/**
 * Spawn-path child capability routing: inherit platformModelsMode +
 * selectorStrategy from parent governance snapshot or trusted config; only
 * re-rank by child task when mode is aor_enhanced. Also builds attachment /
 * tools estimate parts without pretending filename:bytes summaries are full
 * known content or empty tool defs.
 */

import type { ModelProfile, SelectionStrategy } from "@openbot/aor-core";
import type { OpenBotConfig } from "../../config/config.js";
import type { RunGovernanceSnapshot } from "../governance/decision.js";
import { resolvePlatformModelsMode } from "../models/platform-models-config.js";
import type { PlatformModelsMode } from "../models/platform-models-types.js";
import { consumeCapabilityRoutingResult } from "./capability-entry-consume.js";
import {
  reorderAuthorizedModelsForChildTask,
  type ChildTaskAorReorderResult,
} from "./child-task-aor-reorder.js";
import { resolveModalityExecutorWiring } from "./executor-wiring.js";
import {
  buildRunContextEstimateParts,
  type RunContextEstimateBuild,
} from "./run-context-estimate.js";

const SELECTION_STRATEGIES: ReadonlySet<string> = new Set([
  "cheapest",
  "best_quality",
  "balanced",
  "bandit",
]);

export type ChildSpawnAttachmentFile = {
  name: string;
  bytes: number;
  /** Optional known content / token estimate; preferred over byte size alone. */
  contentText?: string;
  estimatedTokens?: number;
};

export type ChildSpawnRoutingModeStrategy = {
  mode: PlatformModelsMode;
  selectorStrategy: SelectionStrategy;
  /** Where mode/strategy came from (for tests / logs). */
  source: "parent_snapshot" | "trusted_config" | "default";
};

/**
 * Inherit mode + selectorStrategy from parent governance snapshot when present;
 * otherwise resolve mode from trusted platform config and default strategy.
 */
export function resolveChildSpawnRoutingModeAndStrategy(params: {
  cfg: OpenBotConfig;
  parentSnapshot?: RunGovernanceSnapshot | null;
  /** Override when tests inject a strategy without a full snapshot. */
  defaultSelectorStrategy?: SelectionStrategy;
}): ChildSpawnRoutingModeStrategy {
  const fromSet = params.parentSnapshot?.effectiveModelSet;
  const snapMode = fromSet?.platformModelsMode;
  const snapStrategy = fromSet?.selectorStrategy;
  const modeFromSnap = snapMode === "native" || snapMode === "aor_enhanced" ? snapMode : undefined;
  const strategyFromSnap =
    typeof snapStrategy === "string" && SELECTION_STRATEGIES.has(snapStrategy)
      ? (snapStrategy as SelectionStrategy)
      : undefined;

  if (modeFromSnap && strategyFromSnap) {
    return { mode: modeFromSnap, selectorStrategy: strategyFromSnap, source: "parent_snapshot" };
  }

  const cfgMode = resolvePlatformModelsMode(params.cfg);
  const strategy =
    strategyFromSnap ?? params.defaultSelectorStrategy ?? ("balanced" as SelectionStrategy);
  const mode = modeFromSnap ?? cfgMode;
  if (modeFromSnap || strategyFromSnap) {
    return {
      mode,
      selectorStrategy: strategy,
      source: "parent_snapshot",
    };
  }
  return {
    mode,
    selectorStrategy: strategy,
    source: mode === cfgMode ? "trusted_config" : "default",
  };
}

/**
 * Attachment / tools estimate for child spawn.
 * - Do not treat short `name:bytes` strings as known large attachment content.
 * - When byte sizes exist, synthesize a char budget from bytes (token estimate).
 * - When only names (no sizes) exist, keep attachments unknown.
 * - Never claim toolsKnown with an empty fake tool definition list.
 */
export function buildChildSpawnContextEstimate(params: {
  taskText: string;
  extraSystemPrompt?: string;
  attachments?: {
    files: readonly ChildSpawnAttachmentFile[];
  } | null;
}): RunContextEstimateBuild {
  const files = params.attachments?.files ?? [];
  let attachmentsText: string | undefined;
  let attachmentsKnown = false;

  if (params.attachments == null) {
    // No receipt → leave unknown (handled by builder default).
    attachmentsKnown = false;
  } else if (files.length === 0) {
    attachmentsKnown = true;
    attachmentsText = "";
  } else {
    const hasContent = files.some(
      (f) =>
        (typeof f.contentText === "string" && f.contentText.length > 0) ||
        (typeof f.estimatedTokens === "number" && f.estimatedTokens > 0),
    );
    const allHaveBytes = files.every(
      (f) => typeof f.bytes === "number" && Number.isFinite(f.bytes) && f.bytes >= 0,
    );
    if (hasContent) {
      attachmentsText = files
        .map((f) => {
          if (typeof f.contentText === "string" && f.contentText.length > 0) {
            return f.contentText;
          }
          if (typeof f.estimatedTokens === "number" && f.estimatedTokens > 0) {
            return "x".repeat(Math.floor(f.estimatedTokens) * 4);
          }
          return "";
        })
        .join("\n");
      attachmentsKnown = true;
    } else if (allHaveBytes && files.some((f) => f.bytes > 0)) {
      // Byte-size → approximate char budget (binary-safe reserve, not filename fluff).
      const totalBytes = files.reduce((sum, f) => sum + Math.max(0, Math.floor(f.bytes)), 0);
      attachmentsText = "x".repeat(totalBytes);
      attachmentsKnown = true;
    } else {
      // Names only / zero-byte metadata — keep unknown rather than pretend known.
      attachmentsKnown = false;
    }
  }

  return buildRunContextEstimateParts({
    taskText: params.taskText,
    extraSystemPrompt: params.extraSystemPrompt,
    ...(attachmentsKnown ? { attachmentsText: attachmentsText ?? "", attachmentsKnown: true } : {}),
    // Do not claim toolsKnown with an empty fake defs string.
    toolsKnown: false,
  });
}

export type PlanChildSpawnCapabilityRoutingInput = {
  cfg: OpenBotConfig;
  taskText: string;
  extraSystemPrompt?: string;
  parentSnapshot?: RunGovernanceSnapshot | null;
  authorizedModelIds: readonly string[];
  parentPreferredModelOrder?: readonly string[];
  catalog?: readonly ModelProfile[];
  modelContextWindows?: Readonly<Record<string, number>>;
  attachments?: {
    files: readonly ChildSpawnAttachmentFile[];
  } | null;
  defaultSelectorStrategy?: SelectionStrategy;
};

export type PlanChildSpawnCapabilityRoutingResult = ChildTaskAorReorderResult & {
  inherited: ChildSpawnRoutingModeStrategy;
  contextEstimate: RunContextEstimateBuild;
  /** Consumed surface for spawn result (plan ≠ completion). */
  consumedSurface: ReturnType<typeof consumeCapabilityRoutingResult>["executionSurface"];
  capabilityOutcome: ReturnType<typeof consumeCapabilityRoutingResult>["capabilityOutcome"];
};

/**
 * Actual spawn-path planner used by spawnSubagentDirect. Prefer this over
 * calling reorderAuthorizedModelsForChildTask with a hardcoded mode.
 */
export function planChildSpawnCapabilityRouting(
  input: PlanChildSpawnCapabilityRoutingInput,
): PlanChildSpawnCapabilityRoutingResult {
  const inherited = resolveChildSpawnRoutingModeAndStrategy({
    cfg: input.cfg,
    parentSnapshot: input.parentSnapshot,
    defaultSelectorStrategy: input.defaultSelectorStrategy,
  });
  const contextEstimate = buildChildSpawnContextEstimate({
    taskText: input.taskText,
    extraSystemPrompt: input.extraSystemPrompt,
    attachments: input.attachments,
  });
  const childReorder = reorderAuthorizedModelsForChildTask({
    taskText: input.taskText,
    authorizedModelIds: input.authorizedModelIds,
    parentPreferredModelOrder: input.parentPreferredModelOrder ?? input.authorizedModelIds,
    mode: inherited.mode,
    selectorStrategy: inherited.selectorStrategy,
    catalog: input.catalog ?? [],
    modelContextWindows: input.modelContextWindows,
    contextParts: contextEstimate.contextParts,
    executorWiring: resolveModalityExecutorWiring(input.cfg),
  });
  const consumed = consumeCapabilityRoutingResult({
    planFailure: childReorder.planFailure,
    outcomeClaim: childReorder.outcomeClaim,
    executionSurface: childReorder.executionSurface,
    capabilityPlan: childReorder.capabilityPlan,
  });
  return {
    ...childReorder,
    inherited,
    contextEstimate,
    consumedSurface: consumed.executionSurface,
    capabilityOutcome: consumed.capabilityOutcome,
  };
}
