import { assertProjectionInvariants, isCanonicallyMetAcceptance } from "./invariants.js";
import type {
  BlockingGate,
  ExecutionLedger,
  ExecutionStep,
  ProgressNode,
  ProgressNodeTone,
  ProgressView,
  TurnContractMode,
  TurnContractSnapshot,
} from "./types.js";

const DEFAULT_NODE_CAP = 7;

function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

function activeSteps(ledger: ExecutionLedger): ExecutionStep[] {
  return ledger.steps.filter((step) => !step.retired);
}

function toneFor(step: ExecutionStep): ProgressNodeTone {
  if (step.status === "completed") {
    return "done";
  }
  if (step.status === "blocked") {
    return "blocked";
  }
  if (step.status === "failed") {
    return "failed";
  }
  if (step.status === "pending") {
    return "pending";
  }
  return "current";
}

function pickCurrentStep(steps: readonly ExecutionStep[]): ExecutionStep | undefined {
  const live = steps.filter((step) =>
    ["in_progress", "executed", "verified", "blocked", "failed"].includes(step.status),
  );
  return live.at(-1);
}

function modeSuffix(mode: TurnContractMode, gate?: BlockingGate, taskCompleted?: boolean): string {
  if (taskCompleted) {
    return "已完成";
  }
  if (gate) {
    switch (gate.reason) {
      case "blocked_user":
        return "等你确认";
      case "blocked_authorization":
        return "等待授权";
      case "blocked_external":
        return "等待外部系统";
      case "blocked_data":
        return "等待数据";
      case "blocked_policy":
        return "受策略限制";
      case "blocked_system":
        return "已中断";
    }
  }
  switch (mode) {
    case "ask":
      return "等你确认";
    case "wait":
      return "等待中";
    case "repair":
      return "正在修复";
    case "quiet":
      return "后台执行中";
    case "deliver":
      return "正在执行";
  }
}

function resolveGate(
  ledger: ExecutionLedger,
  turnContract: TurnContractSnapshot,
): BlockingGate | undefined {
  return ledger.currentBlocking ?? turnContract.blockingGate ?? undefined;
}

/**
 * Pure projection. Must not mutate ledger or events.
 * Quiet still computes the view; callers must honor emitToChat / emitNotification.
 */
export function projectProgress(
  ledger: ExecutionLedger,
  turnContract: TurnContractSnapshot,
  nowMs: number,
): ProgressView {
  const originalLedgerJson = snapshot(ledger);
  const steps = activeSteps(ledger);
  const met = ledger.acceptance.filter(isCanonicallyMetAcceptance).length;
  const total = ledger.acceptance.length;
  const completedSteps = steps.filter((step) => step.status === "completed").length;
  const inProgress = steps.filter((step) =>
    ["in_progress", "executed", "verified"].includes(step.status),
  ).length;
  const remaining = steps.filter(
    (step) => step.status === "pending" || step.status === "blocked",
  ).length;
  const current = pickCurrentStep(steps);
  const blockingGate = resolveGate(ledger, turnContract);
  const quiet = turnContract.mode === "quiet";
  const nodes: ProgressNode[] = steps.map((step) => ({
    id: step.id,
    title: step.title,
    tone: toneFor(step),
  }));

  const view: ProgressView = {
    projectionKind: "canonical",
    taskId: ledger.taskId,
    goal: ledger.goal,
    headline: `${met}/${total} 项验收已满足 · ${modeSuffix(turnContract.mode, blockingGate, ledger.completed)}`,
    focus: blockingGate?.question ?? current?.title ?? ledger.goal,
    acceptanceProgress: { met, total },
    executionProgress: {
      completed: completedSteps,
      total: steps.length,
      inProgress,
      remaining,
    },
    mode: turnContract.mode,
    ...(blockingGate ? { blockingGate } : {}),
    stale:
      ledger.lastMeaningfulChangeAtMs > 0 &&
      nowMs - ledger.lastMeaningfulChangeAtMs > ledger.staleAfterMs,
    lastMeaningfulChangeAtMs: ledger.lastMeaningfulChangeAtMs,
    lastUpdatedAtMs: ledger.lastUpdatedAtMs,
    emitToChat: !quiet,
    emitNotification: !quiet,
    ...(current ? { currentStepId: current.id } : {}),
    nodes,
    ...(nodes.length > DEFAULT_NODE_CAP
      ? {
          collapsedSummary: {
            done: completedSteps,
            current:
              inProgress + (current?.status === "blocked" || current?.status === "failed" ? 1 : 0),
            remaining,
          },
        }
      : {}),
    taskCompleted: ledger.completed,
    planVersion: ledger.currentPlanVersion,
    replans: ledger.replans.map((item) => ({
      atMs: item.atMs,
      fromVersion: item.fromVersion,
      toVersion: item.toVersion,
      reason: item.reason,
      triggeredBy: item.triggeredBy,
    })),
  };

  assertProjectionInvariants(ledger, view, originalLedgerJson);
  return view;
}
