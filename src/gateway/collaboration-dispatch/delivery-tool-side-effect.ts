/**
 * Choke point for durable at-most-once delivery tool steps.
 *
 * The embedded agent loop (`splitSdkTools` → `toToolDefinitions`) calls
 * `runDeliveryToolSideEffect` before a classified side-effecting tool runs.
 * Read tools and turns without a confirmed delivery fingerprint execute as usual.
 * The ledger is a runtime directory (`tool-side-effects`), not GROUP_PUBLIC
 * `runtime/transcript.jsonl`. `collaboration.runtimeNamespace` stays at its
 * configured default; flag-off resolves the legacy group runtime dir.
 */
import path from "node:path";
import { resolveCoreToolCapability } from "../../agents/tool-catalog.js";
import { normalizeToolName } from "../../agents/tool-policy.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveLegacyGroupRuntimeFactPaths } from "../collaboration-learning/collaboration-paths.js";
import type { ExecutionTaskBag } from "./executor-private-todolist.js";
import {
  scheduleDurableToolSideEffect,
  type CollaborationPrivateRunBag,
} from "./private-run-bag.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";

export type DeliveryToolSideEffectSchedule = {
  ledgerDir: string;
  taskId: string;
  boardItemId: string;
  stepId: string;
};

/** True for catalogued tools whose sideEffectLevel is not `none`. */
export function isSideEffectingDeliveryTool(toolName: string): boolean {
  const capability = resolveCoreToolCapability(normalizeToolName(toolName));
  return capability != null && capability.sideEffectLevel !== "none";
}

/**
 * Directory for the wx claim ledger. Never the GROUP_PUBLIC transcript file.
 */
export function resolveDeliveryToolSideEffectLedgerDir(params: {
  groupId: string;
  tenantId?: string | null;
  cfg?: OpenBotConfig;
}): string {
  const facts = resolveCollaborationRuntimeFactPaths({
    groupId: params.groupId,
    tenantId: params.tenantId,
    cfg: params.cfg,
  });
  if (facts.namespace) {
    return path.join(facts.namespace.root, "tool-side-effects");
  }
  const legacy = resolveLegacyGroupRuntimeFactPaths(params.groupId, params.cfg);
  return path.join(legacy.groupDir, "runtime", "tool-side-effects");
}

/** Fingerprint for a confirmed execution bag. Undefined when the plan gate is closed. */
export function deliveryToolSideEffectFromTaskBag(params: {
  bag: ExecutionTaskBag;
  ledgerDir: string;
}): DeliveryToolSideEffectSchedule | undefined {
  const step = params.bag.todolistCurrentStep;
  if (!params.bag.planGate.confirmed || !step) {
    return undefined;
  }
  const taskId = params.bag.boardSummary.taskId.trim();
  const boardItemId = params.bag.boardSummary.itemId.trim();
  const stepId = step.stepId.trim();
  const ledgerDir = params.ledgerDir.trim();
  if (!taskId || !boardItemId || !stepId || !ledgerDir) {
    return undefined;
  }
  return { ledgerDir, taskId, boardItemId, stepId };
}

/**
 * Single choke point used by the agent tool loop.
 * A second call with the same task/step/tool fingerprint skips `run`.
 */
export async function runDeliveryToolSideEffect<T>(params: {
  schedule?: DeliveryToolSideEffectSchedule | null;
  toolName: string;
  cfg?: OpenBotConfig;
  bag?: CollaborationPrivateRunBag;
  run: () => Promise<T>;
}): Promise<{ skipped: true; key: string } | { skipped: false; value: T }> {
  const toolName = params.toolName.trim();
  if (!params.schedule || !isSideEffectingDeliveryTool(toolName)) {
    return { skipped: false, value: await params.run() };
  }
  const scheduled = await scheduleDurableToolSideEffect({
    ledgerDir: params.schedule.ledgerDir,
    fingerprint: {
      taskId: params.schedule.taskId,
      boardItemId: params.schedule.boardItemId,
      stepId: params.schedule.stepId,
      toolName: normalizeToolName(toolName),
    },
    cfg: params.cfg,
    bag: params.bag,
    run: params.run,
  });
  if (scheduled.skipped) {
    return { skipped: true, key: scheduled.key };
  }
  return { skipped: false, value: scheduled.value as T };
}
