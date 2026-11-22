/**
 * Residual B choke point for durable at-most-once delivery tool steps.
 *
 * The embedded agent loop (`splitSdkTools` → `toToolDefinitions`) calls
 * `runDeliveryToolSideEffect` before a classified side-effecting tool runs,
 * which claims via `scheduleDurableToolSideEffect` (private-run-bag). Optional
 * `privateRunBag` is forwarded from the turn so the in-memory index updates
 * without touching GROUP_PUBLIC. Read tools and turns without a confirmed
 * delivery fingerprint execute as usual. The ledger is a runtime directory
 * (`tool-side-effects`), not GROUP_PUBLIC `runtime/transcript.jsonl`.
 * `collaboration.runtimeNamespace` stays at its configured default; flag-off
 * resolves the legacy group runtime dir. No LIVE/gray flag changes.
 */
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import type { OperationIdentity } from "../../agent-runtime/contracts/operation.js";
import { resolveCoreToolCapability } from "../../agents/tool-catalog.js";
import { normalizeToolName } from "../../agents/tool-policy.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveLegacyGroupRuntimeFactPaths } from "../collaboration-learning/collaboration-paths.js";
import { createWorkspaceCollaborationStores } from "../collaboration-learning/shared.js";
import type { ExecutionTaskBag } from "./executor-private-todolist.js";
import {
  scheduleDurableToolSideEffect,
  type CollaborationPrivateRunBag,
} from "./private-run-bag.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";
import { asGovernedTask } from "./task-runtime.js";
import { isTaskStopAccepted } from "./task-stop-control.js";

export type DeliveryToolSideEffectSchedule = {
  operationIdentity?: OperationIdentity;
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
  /** Optional group scope for U1 stop preflight on queued side-effect runs. */
  groupId?: string | null;
  bag?: CollaborationPrivateRunBag;
  run: () => Promise<T>;
}): Promise<{ skipped: true; key: string } | { skipped: false; value: T }> {
  const toolName = params.toolName.trim();
  if (!params.schedule || !isSideEffectingDeliveryTool(toolName)) {
    return { skipped: false, value: await params.run() };
  }
  const bagGroup =
    typeof params.bag === "object" && params.bag && "groupContextPointer" in params.bag
      ? String(
          (params.bag as { groupContextPointer?: { groupId?: string } }).groupContextPointer
            ?.groupId ?? "",
        ).trim()
      : "";
  const groupId = params.groupId?.trim() || bagGroup;
  const taskId = params.schedule.taskId.trim();
  if (groupId && taskId) {
    try {
      const { objectStorage } = createWorkspaceCollaborationStores(params.cfg);
      const current = await objectStorage.readObject<Task>(groupId, "task", taskId);
      if (current && isTaskStopAccepted(asGovernedTask(current))) {
        return {
          skipped: true,
          key: `task-stopped:${taskId}:${normalizeToolName(toolName)}`,
        };
      }
    } catch {
      // store read failure must not widen execution; fall through to durable claim
    }
  }
  const scheduled = await scheduleDurableToolSideEffect({
    ledgerDir: params.schedule.ledgerDir,
    fingerprint: {
      operationIdentity: params.schedule.operationIdentity,
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
