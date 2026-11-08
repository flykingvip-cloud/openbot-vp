/**
 * Package2 recovery: claim durable async-wait intents at gateway boot / recheck
 * and arm the existing task-board continue mainline. enqueueSystemEvent /
 * requestHeartbeatNow / pending register are NOT delivery.
 *
 * Stages: claimed → continue_armed → turn_bound → delivery_pending → delivered.
 * Unconfirmed stages retry. Dual-claim prevented by per-job file lock.
 */
import fs from "node:fs";
import path from "node:path";
import { listAgentIds } from "../../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../../config/sessions/paths.js";
import { isPidAlive } from "../../../shared/pid-alive.js";
import { buildTaskBoardContinuePrompt, reserveTaskContinuation } from "../continuation-ticket.js";
import { checkTaskActionBoundary } from "../task-action.js";
import {
  type AsyncWaitJobIntent,
  buildAsyncWaitRecoveryPromptAppendix,
  claimAsyncWaitJobForRecovery,
  clearAsyncWaitJobIntent,
  markAsyncWaitRecoveryContinueArmed,
  readAsyncWaitJobIntent,
} from "./async-wait-job.js";
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
  cleared: number;
  skipped: number;
  retried: number;
};

const JOBS_DIRNAME = "async-wait-jobs";
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

function readIntentFile(filePath: string): AsyncWaitJobIntent | undefined {
  try {
    const row = JSON.parse(fs.readFileSync(filePath, "utf8")) as AsyncWaitJobIntent;
    if (
      row &&
      (row.version === 2 || (row as { version?: number }).version === 1) &&
      typeof row.jobId === "string" &&
      typeof row.sessionFile === "string"
    ) {
      return readAsyncWaitJobIntent(row.sessionFile, row.jobId) ?? row;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function findAsyncWaitJobsDirs(sessionsRoot: string, maxDepth = 3): string[] {
  const root = sessionsRoot.trim();
  if (!root || !fs.existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.name === JOBS_DIRNAME) {
        out.push(full);
        continue;
      }
      if (depth < maxDepth) {
        walk(full, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

export function collectRecoverableAsyncWaitIntents(cfg: OpenBotConfig): AsyncWaitJobIntent[] {
  const byKey = new Map<string, AsyncWaitJobIntent>();
  for (const agentId of listAgentIds(cfg)) {
    let sessionsRoot: string;
    try {
      sessionsRoot = resolveSessionTranscriptsDirForAgent(agentId);
    } catch {
      continue;
    }
    for (const jobsDir of findAsyncWaitJobsDirs(sessionsRoot)) {
      let names: string[];
      try {
        names = fs.readdirSync(jobsDir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const intent = readIntentFile(path.join(jobsDir, name));
        if (!intent || intent.status === "cleared") {
          continue;
        }
        if (intent.recovery?.stage === "delivered") {
          continue;
        }
        byKey.set(`${intent.sessionFile}::${intent.jobId}`, intent);
      }
    }
  }
  return [...byKey.values()];
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
    | "enqueue_failed";
  intent?: AsyncWaitJobIntent;
} {
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
    return { outcome: "skipped", intent: claimed.intent };
  }

  const intent = claimed.intent;
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

/** @deprecated name — use armAsyncWaitRecoveryContinuation. Never means delivered. */
export function claimAsyncWaitJobIntent(
  intent: AsyncWaitJobIntent,
  opts?: { cfg?: OpenBotConfig; enqueue?: AsyncWaitRecoveryContinueEnqueue },
): {
  outcome: "still_waiting" | "woke" | "cleared" | "skipped";
} {
  const result = armAsyncWaitRecoveryContinuation({
    intent,
    enqueue: opts?.enqueue,
  });
  if (result.outcome === "still_waiting") {
    return { outcome: "still_waiting" };
  }
  if (result.outcome === "cleared") {
    return { outcome: "cleared" };
  }
  if (result.outcome === "continue_armed" || result.outcome === "retried_open") {
    // "woke" kept for older tests = continue armed, NOT delivered.
    return { outcome: "woke" };
  }
  return { outcome: "skipped" };
}

/** @deprecated — delivery is only via confirmPending after a real turn. */
export function deliverRecoveredAsyncWaitCompletion(params: {
  intent: AsyncWaitJobIntent;
  cfg?: OpenBotConfig;
  enqueue?: AsyncWaitRecoveryContinueEnqueue;
}): { delivered: boolean; reason: "issued" | "already" | "refused" | "skipped" | "armed" } {
  if (params.intent.recovery?.stage === "delivered") {
    return { delivered: false, reason: "already" };
  }
  const result = armAsyncWaitRecoveryContinuation({
    intent: params.intent,
    enqueue: params.enqueue,
  });
  if (result.outcome === "cleared") {
    return { delivered: false, reason: "refused" };
  }
  if (result.outcome === "continue_armed" || result.outcome === "retried_open") {
    // Explicitly NOT delivered — continue was armed onto the mainline.
    return { delivered: false, reason: "armed" };
  }
  return { delivered: false, reason: "skipped" };
}

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
    `async-wait recovery boot: agents=${result.agentsScanned} seen=${result.intentsSeen} waiting=${result.stillWaiting} continueArmed=${result.continueArmed} retried=${result.retried} cleared=${result.cleared} skipped=${result.skipped}`,
  );
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
}
