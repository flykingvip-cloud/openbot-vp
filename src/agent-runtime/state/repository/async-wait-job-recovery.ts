/**
 * Package2 recovery orchestration: claim durable async-wait intents at gateway boot / recheck
 * and arm the existing task-board continue mainline. Directory scan lives in async-wait-recovery-scan.ts. enqueueSystemEvent /
 * requestHeartbeatNow / pending register are NOT delivery.
 *
 * Stages: claimed → continue_armed → turn_bound → delivery_pending → delivered.
 * Unconfirmed stages retry. Dual-claim prevented by per-job file lock.
 */
import { listAgentIds } from "../../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { isPidAlive } from "../../../shared/pid-alive.js";
import { buildTaskBoardContinuePrompt, reserveTaskContinuation } from "../continuation-ticket.js";
import { checkTaskActionBoundary } from "../task-action.js";
import { type AsyncWaitJobIntent } from "./async-wait-job-store.js";
import { clearAsyncWaitJobIntent } from "./async-wait-job.js";
import {
  buildAsyncWaitRecoveryPromptAppendix,
  claimAsyncWaitJobForRecovery,
  markAsyncWaitRecoveryContinueArmed,
} from "./async-wait-recovery-claim.js";
import { setAsyncWaitRecoveryFollowupConsumerEnsure } from "./async-wait-recovery-enqueue.js";
import { collectRecoverableAsyncWaitIntents } from "./async-wait-recovery-scan.js";
import { recoverFollowupWorkspaceWaitsAtGatewayBoot } from "./blocked-followup-delivery-recovery.js";
import { readSessionTaskBoard } from "./task-board-file.js";

export type AsyncWaitRecoveryLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type AsyncWaitRecoveryResult = {
  agentsScanned: number;
  intentsSeen: number;
  stillWaiting: number;
  /** Armed into task-board continue (not delivered). */
  continueArmed: number;
  /** Executed-not-delivered — left for pending-delivery receipt path. */
  deliveryOnly: number;
  cleared: number;
  skipped: number;
  retried: number;
};

const RECHECK_INTERVAL_MS = 15_000;

let recheckTimer: ReturnType<typeof setInterval> | undefined;
let recheckCfg: OpenBotConfig | undefined;

/**
 * Production/tests inject how a continue prompt is enqueued onto the existing
 * followup / controlled-execution mainline. Must NOT fake delivery.
 */
export type AsyncWaitRecoveryContinueEnqueue = (params: {
  sessionFile: string;
  sessionKey: string;
  taskId: string;
  focusRevision: number;
  prompt: string;
  messageId: string;
  claimToken: string;
  jobId: string;
  intent: AsyncWaitJobIntent;
  /** When true, enqueue delivery-only retry (no business/model re-run). */
  deliveryOnly?: boolean;
}) => boolean;

let continueEnqueuePort: AsyncWaitRecoveryContinueEnqueue | undefined;

export function setAsyncWaitRecoveryContinueEnqueue(
  port: AsyncWaitRecoveryContinueEnqueue | undefined,
): void {
  continueEnqueuePort = port;
}

export function getAsyncWaitRecoveryContinueEnqueue():
  | AsyncWaitRecoveryContinueEnqueue
  | undefined {
  return continueEnqueuePort;
}

function boundaryFor(intent: AsyncWaitJobIntent) {
  return {
    sessionFile: intent.sessionFile,
    binding: {
      taskId: intent.taskId,
      executionAttempt: intent.executionAttempt,
      deliverableVersion: intent.deliverableVersion,
    },
    constraints: [...intent.constraints],
  };
}

function buildRecoveryContinuePrompt(intent: AsyncWaitJobIntent, boardPrompt: string): string {
  return [boardPrompt, "", buildAsyncWaitRecoveryPromptAppendix(intent)].join("\n");
}

/**
 * Claim under lock, then arm existing task-board continue via the injected enqueue
 * port. Returns continue_armed — never "delivered".
 */
export function armAsyncWaitRecoveryContinuation(params: {
  intent: AsyncWaitJobIntent;
  enqueue?: AsyncWaitRecoveryContinueEnqueue;
  isPidAlive?: (pid: number) => boolean;
}): {
  outcome:
    | "still_waiting"
    | "continue_armed"
    | "cleared"
    | "skipped"
    | "retried_open"
    | "enqueue_failed"
    | "delivery_only";
  intent?: AsyncWaitJobIntent;
} {
  // Always re-read under claim lock — never trust a stale in-memory attempt from the caller.
  const claimed = claimAsyncWaitJobForRecovery({
    sessionFile: params.intent.sessionFile,
    jobId: params.intent.jobId,
    isPidAlive: params.isPidAlive ?? isPidAlive,
  });
  if (!claimed.ok) {
    if (claimed.reason === "still_waiting_pid") {
      return { outcome: "still_waiting", intent: claimed.intent };
    }
    if (claimed.reason === "cleared") {
      return { outcome: "cleared", intent: claimed.intent };
    }
    // active_exec / delivered / missing → skip; do not clear a live binding.
    return { outcome: "skipped", intent: claimed.intent };
  }

  const intent = claimed.intent;

  // Executed-not-delivered: enqueue delivery-only retry — never re-run business/model.
  if (claimed.deliveryOnly) {
    const enqueue = params.enqueue ?? continueEnqueuePort;
    if (!enqueue) {
      return { outcome: "delivery_only", intent };
    }
    const board = readSessionTaskBoard(intent.sessionFile);
    const focusRevision = board.focusRevision ?? intent.recovery?.continueFocusRevision ?? 0;
    const messageId = `async-wait-delivery-only:${intent.jobId}:g${intent.recovery?.claimGeneration ?? 0}`;
    const ok = enqueue({
      sessionFile: intent.sessionFile,
      sessionKey: intent.sessionKey,
      taskId: intent.taskId,
      focusRevision,
      prompt: buildAsyncWaitRecoveryPromptAppendix(intent),
      messageId,
      claimToken: claimed.claimToken,
      jobId: intent.jobId,
      intent,
      deliveryOnly: true,
    });
    return {
      outcome: ok ? "delivery_only" : "enqueue_failed",
      intent,
    };
  }

  // Boundary uses the locked intent (synced attempt after bind) — not the caller's stale snapshot.
  if (checkTaskActionBoundary(boundaryFor(intent))) {
    clearAsyncWaitJobIntent(intent.sessionFile, intent.jobId);
    return { outcome: "cleared", intent };
  }

  const board = readSessionTaskBoard(intent.sessionFile);
  const current = board.current;
  if (!current?.unfinished || current.taskId !== intent.taskId) {
    clearAsyncWaitJobIntent(intent.sessionFile, intent.jobId);
    return { outcome: "cleared", intent };
  }
  const focusRevision = board.focusRevision ?? 0;
  const reservation = reserveTaskContinuation({
    sessionFile: intent.sessionFile,
    taskId: intent.taskId,
    focusRevision,
    nowMs: Date.now(),
  });
  if (!reservation.ok) {
    // Cap / revision mismatch — leave claimed for retry; do not mark delivered.
    return { outcome: "retried_open", intent };
  }

  const boardPrompt = buildTaskBoardContinuePrompt(current);
  const prompt = buildRecoveryContinuePrompt(intent, boardPrompt);
  const messageId = `async-wait-recovery:${intent.jobId}:g${intent.recovery?.claimGeneration ?? 0}`;
  const enqueue = params.enqueue ?? continueEnqueuePort;
  if (!enqueue) {
    // No port yet (boot before wiring) — keep claimed for retry.
    return { outcome: "retried_open", intent };
  }
  const ok = enqueue({
    sessionFile: intent.sessionFile,
    sessionKey: intent.sessionKey,
    taskId: intent.taskId,
    focusRevision,
    prompt,
    messageId,
    claimToken: claimed.claimToken,
    jobId: intent.jobId,
    intent,
  });
  if (!ok) {
    return { outcome: "enqueue_failed", intent };
  }
  const armed = markAsyncWaitRecoveryContinueArmed({
    sessionFile: intent.sessionFile,
    jobId: intent.jobId,
    claimToken: claimed.claimToken,
    focusRevision,
    messageId,
  });
  return {
    outcome: claimed.freshClaim ? "continue_armed" : "retried_open",
    intent: armed ?? intent,
  };
}

/**
 * Retired Package5 aliases (no remaining consumers):
 * - claimAsyncWaitJobIntent — mapped continue_armed to misleading outcome "woke".
 * - deliverRecoveredAsyncWaitCompletion — name implied delivery; only armed continue.
 * Sole recovery arm entry: armAsyncWaitRecoveryContinuation. Delivery only via
 * confirmPendingTurnDelivery after a real turn / delivery-only retry.
 */

export function recoverAsyncWaitJobsAtGatewayBoot(params: {
  cfg: OpenBotConfig;
  log?: AsyncWaitRecoveryLog;
  startRecheck?: boolean;
  intervalMs?: number;
  enqueue?: AsyncWaitRecoveryContinueEnqueue;
}): AsyncWaitRecoveryResult {
  const intents = collectRecoverableAsyncWaitIntents(params.cfg);
  const result: AsyncWaitRecoveryResult = {
    agentsScanned: listAgentIds(params.cfg).length,
    intentsSeen: intents.length,
    stillWaiting: 0,
    continueArmed: 0,
    deliveryOnly: 0,
    cleared: 0,
    skipped: 0,
    retried: 0,
  };
  for (const intent of intents) {
    try {
      const out = armAsyncWaitRecoveryContinuation({
        intent,
        enqueue: params.enqueue ?? continueEnqueuePort,
      });
      if (out.outcome === "still_waiting") {
        result.stillWaiting += 1;
      } else if (out.outcome === "continue_armed") {
        result.continueArmed += 1;
      } else if (out.outcome === "delivery_only") {
        result.deliveryOnly += 1;
      } else if (out.outcome === "retried_open") {
        result.retried += 1;
      } else if (out.outcome === "cleared") {
        result.cleared += 1;
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      result.skipped += 1;
      params.log?.warn?.(
        `async-wait recovery failed job=${intent.jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  params.log?.info?.(
    `async-wait recovery boot: agents=${result.agentsScanned} seen=${result.intentsSeen} waiting=${result.stillWaiting} continueArmed=${result.continueArmed} deliveryOnly=${result.deliveryOnly} retried=${result.retried} cleared=${result.cleared} skipped=${result.skipped}`,
  );
  void recoverFollowupWorkspaceWaitsAtGatewayBoot({
    cfg: params.cfg,
    log: params.log,
  }).catch((err) => {
    params.log?.warn?.(
      `followup workspace wait recovery failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
  if (params.startRecheck !== false) {
    startAsyncWaitJobRecoveryRecheck(params.cfg, {
      intervalMs: params.intervalMs,
      log: params.log,
      enqueue: params.enqueue,
    });
  }
  return result;
}

export function startAsyncWaitJobRecoveryRecheck(
  cfg: OpenBotConfig,
  opts?: {
    intervalMs?: number;
    log?: AsyncWaitRecoveryLog;
    enqueue?: AsyncWaitRecoveryContinueEnqueue;
  },
): void {
  recheckCfg = cfg;
  if (recheckTimer) {
    return;
  }
  const intervalMs = opts?.intervalMs ?? RECHECK_INTERVAL_MS;
  recheckTimer = setInterval(() => {
    const active = recheckCfg;
    if (!active) {
      return;
    }
    try {
      const boot = recoverAsyncWaitJobsAtGatewayBoot({
        cfg: active,
        startRecheck: false,
        log: opts?.log,
        enqueue: opts?.enqueue ?? continueEnqueuePort,
      });
      if (boot.continueArmed > 0 || boot.retried > 0 || boot.cleared > 0) {
        opts?.log?.info?.(
          `async-wait recovery recheck: continueArmed=${boot.continueArmed} retried=${boot.retried} cleared=${boot.cleared}`,
        );
      }
    } catch (err) {
      opts?.log?.warn?.(
        `async-wait recovery recheck failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, intervalMs);
  if (typeof recheckTimer === "object" && recheckTimer && "unref" in recheckTimer) {
    recheckTimer.unref();
  }
}

export function stopAsyncWaitJobRecoveryRecheckForTests(): void {
  if (recheckTimer) {
    clearInterval(recheckTimer);
    recheckTimer = undefined;
  }
  recheckCfg = undefined;
  continueEnqueuePort = undefined;
  setAsyncWaitRecoveryFollowupConsumerEnsure(undefined);
}
