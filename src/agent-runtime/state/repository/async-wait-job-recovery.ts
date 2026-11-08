/**
 * Package2 P2-D2: recover durable async-wait intents at gateway boot (and light
 * recheck), next to TaskOutcome consumer-boot. No new scheduler/executor:
 * pid alive → leave waiting; exited → one bounded heartbeat wake via existing
 * system-event + heartbeat-wake path. Stale/paused/cancelled bindings clear.
 */
import fs from "node:fs";
import path from "node:path";
import { listAgentIds } from "../../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../../config/sessions/paths.js";
import { requestHeartbeatNow } from "../../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../../infra/system-events.js";
import { scopedHeartbeatWakeOptions } from "../../../routing/session-key.js";
import { isPidAlive } from "../../../shared/pid-alive.js";
import { checkTaskActionBoundary } from "../task-action.js";
import {
  type AsyncWaitJobIntent,
  clearAsyncWaitJobIntent,
  listAsyncWaitJobIntents,
  markAsyncWaitJobExited,
  markAsyncWaitJobRecoveryWakeIssued,
  readAsyncWaitJobIntent,
} from "./async-wait-job.js";

export type AsyncWaitRecoveryLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type AsyncWaitRecoveryResult = {
  agentsScanned: number;
  intentsSeen: number;
  stillWaiting: number;
  woke: number;
  cleared: number;
  skipped: number;
};

const JOBS_DIRNAME = "async-wait-jobs";
const RECHECK_INTERVAL_MS = 15_000;

let recheckTimer: ReturnType<typeof setInterval> | undefined;
let recheckCfg: OpenBotConfig | undefined;

function readIntentFile(filePath: string): AsyncWaitJobIntent | undefined {
  try {
    const row = JSON.parse(fs.readFileSync(filePath, "utf8")) as AsyncWaitJobIntent;
    if (
      row &&
      row.version === 1 &&
      typeof row.jobId === "string" &&
      typeof row.sessionFile === "string" &&
      (row.status === "waiting" || row.status === "exited" || row.status === "cleared")
    ) {
      return row;
    }
  } catch {
    // ignore corrupt
  }
  return undefined;
}

/** Find async-wait-jobs directories under an agent sessions root (bounded depth). */
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
        // Prefer freshest read via sessionFile API when possible.
        const fresh =
          readAsyncWaitJobIntent(intent.sessionFile, intent.jobId) ??
          listAsyncWaitJobIntents(intent.sessionFile).find((row) => row.jobId === intent.jobId) ??
          intent;
        if (fresh.status === "cleared") {
          continue;
        }
        byKey.set(`${fresh.sessionFile}::${fresh.jobId}`, fresh);
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

function issueBoundedRecoveryWake(intent: AsyncWaitJobIntent): boolean {
  if (typeof intent.recoveryWakeIssuedAtMs === "number") {
    return false;
  }
  const sessionKey = intent.sessionKey.trim();
  if (!sessionKey) {
    return false;
  }
  const exitLabel = intent.exitStatus ?? "exited";
  const summary = `Exec ${exitLabel} recovered (${intent.jobId.slice(0, 8)}) after restart`;
  enqueueSystemEvent(summary, { sessionKey });
  requestHeartbeatNow(
    scopedHeartbeatWakeOptions(sessionKey, {
      reason: `exec:${intent.jobId}:recovery-exit`,
    }),
  );
  markAsyncWaitJobRecoveryWakeIssued(intent.sessionFile, intent.jobId);
  return true;
}

/**
 * Claim one durable intent: refuse stale bindings; pid alive → wait;
 * exited → one bounded wake.
 */
export function claimAsyncWaitJobIntent(intent: AsyncWaitJobIntent): {
  outcome: "still_waiting" | "woke" | "cleared" | "skipped";
} {
  const current = readAsyncWaitJobIntent(intent.sessionFile, intent.jobId) ?? intent;
  if (current.status === "cleared") {
    return { outcome: "skipped" };
  }
  if (checkTaskActionBoundary(boundaryFor(current))) {
    clearAsyncWaitJobIntent(current.sessionFile, current.jobId);
    return { outcome: "cleared" };
  }
  if (current.status === "waiting") {
    if (typeof current.pid === "number" && isPidAlive(current.pid)) {
      return { outcome: "still_waiting" };
    }
    markAsyncWaitJobExited({
      sessionFile: current.sessionFile,
      jobId: current.jobId,
      exitStatus: "failed",
    });
  }
  const after = readAsyncWaitJobIntent(current.sessionFile, current.jobId) ?? current;
  if (after.status !== "exited") {
    return { outcome: "skipped" };
  }
  if (typeof after.recoveryWakeIssuedAtMs === "number") {
    return { outcome: "skipped" };
  }
  return { outcome: issueBoundedRecoveryWake(after) ? "woke" : "skipped" };
}

export function recoverAsyncWaitJobsAtGatewayBoot(params: {
  cfg: OpenBotConfig;
  log?: AsyncWaitRecoveryLog;
  /** When true, also start the light recheck interval (alive pids → later exit). */
  startRecheck?: boolean;
  intervalMs?: number;
}): AsyncWaitRecoveryResult {
  const intents = collectRecoverableAsyncWaitIntents(params.cfg);
  const result: AsyncWaitRecoveryResult = {
    agentsScanned: listAgentIds(params.cfg).length,
    intentsSeen: intents.length,
    stillWaiting: 0,
    woke: 0,
    cleared: 0,
    skipped: 0,
  };
  for (const intent of intents) {
    try {
      const { outcome } = claimAsyncWaitJobIntent(intent);
      if (outcome === "still_waiting") {
        result.stillWaiting += 1;
      } else if (outcome === "woke") {
        result.woke += 1;
      } else if (outcome === "cleared") {
        result.cleared += 1;
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      result.skipped += 1;
      params.log?.warn?.(
        `async-wait recovery claim failed job=${intent.jobId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  params.log?.info?.(
    `async-wait recovery boot: agents=${result.agentsScanned} seen=${result.intentsSeen} waiting=${result.stillWaiting} woke=${result.woke} cleared=${result.cleared} skipped=${result.skipped}`,
  );
  if (params.startRecheck !== false) {
    startAsyncWaitJobRecoveryRecheck(params.cfg, {
      intervalMs: params.intervalMs,
      log: params.log,
    });
  }
  return result;
}

export function startAsyncWaitJobRecoveryRecheck(
  cfg: OpenBotConfig,
  opts?: { intervalMs?: number; log?: AsyncWaitRecoveryLog },
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
      const intents = collectRecoverableAsyncWaitIntents(active);
      let woke = 0;
      let cleared = 0;
      for (const intent of intents) {
        const { outcome } = claimAsyncWaitJobIntent(intent);
        if (outcome === "woke") {
          woke += 1;
        } else if (outcome === "cleared") {
          cleared += 1;
        }
      }
      if (woke > 0 || cleared > 0) {
        opts?.log?.info?.(`async-wait recovery recheck: woke=${woke} cleared=${cleared}`);
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

/** Test helper */
export function stopAsyncWaitJobRecoveryRecheckForTests(): void {
  if (recheckTimer) {
    clearInterval(recheckTimer);
    recheckTimer = undefined;
  }
  recheckCfg = undefined;
}
