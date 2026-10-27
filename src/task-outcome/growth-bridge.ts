import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import {
  appendEvolutionTaskOutcome,
  resolveEvolutionTaskOutcomesPath,
  type EvolutionTaskOutcomeRecord,
} from "../gateway/agent-growth/evolution-task-outcomes.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import { scopeIdOf } from "./transitions.js";
import type { TaskOutcomeRecord } from "./types.js";

export type EvolutionWithKey = EvolutionTaskOutcomeRecord & {
  outcomeVersion?: number;
  taskOutcomeKey?: string;
  /** Soft-delete / supersede marker for older versions of the same task. */
  revoked?: boolean;
  replacesTaskOutcomeKey?: string;
};

function sleepMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait — short critical section only
  }
}

function withEvolutionFileLock<T>(filePath: string, fn: () => T, opts?: { timeoutMs?: number }): T {
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const start = Date.now();
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "w" });
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`evolution file lock timeout for ${filePath}`);
      }
      try {
        const holder = Number(fs.readFileSync(lockPath, "utf8").trim());
        if (holder && holder !== process.pid) {
          try {
            process.kill(holder, 0);
          } catch {
            try {
              fs.unlinkSync(lockPath);
            } catch {
              // race
            }
          }
        }
      } catch {
        // ignore
      }
      sleepMs(5);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}

function readRawEvolutionLines(filePath: string): EvolutionWithKey[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const rows: EvolutionWithKey[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      rows.push(JSON.parse(line) as EvolutionWithKey);
    } catch {
      // ignore bad lines
    }
  }
  return rows;
}

function taskKey(taskId: string, outcomeVersion: number): string {
  return `${taskId}@${outcomeVersion}`;
}

/**
 * True when tip→growth-bridge already published a sample for this runId
 * (row carries taskOutcomeKey). Used to skip redundant bypass appends.
 */
export function hasTipBridgedEvolutionForRun(
  cfg: OpenBotConfig,
  agentId: string,
  runId: string,
): boolean {
  const rid = runId.trim();
  if (!rid) {
    return false;
  }
  const filePath = resolveEvolutionTaskOutcomesPath(cfg, agentId);
  return readRawEvolutionLines(filePath).some(
    (row) => !row.revoked && row.runId === rid && Boolean(row.taskOutcomeKey?.trim()),
  );
}

/**
 * Effective real samples: per taskId keep the highest non-revoked outcomeVersion.
 * Older failure rows superseded by a later success are excluded.
 */
export function readEffectiveEvolutionTaskOutcomes(
  cfg: OpenBotConfig,
  agentId: string,
): EvolutionWithKey[] {
  const filePath = resolveEvolutionTaskOutcomesPath(cfg, agentId);
  const raw = readRawEvolutionLines(filePath);
  // Revoke markers are separate append-only rows; exclude the keys they revoke.
  const revokedKeys = new Set<string>();
  for (const row of raw) {
    if (row.revoked && row.taskOutcomeKey) {
      revokedKeys.add(row.taskOutcomeKey);
    }
  }
  const rows = raw.filter((r) => {
    if (r.revoked) {
      return false;
    }
    const key = r.taskOutcomeKey ?? (r.taskId ? taskKey(r.taskId, r.outcomeVersion ?? 0) : "");
    return !key || !revokedKeys.has(key);
  });
  const best = new Map<string, EvolutionWithKey>();
  for (const row of rows) {
    const tid = row.taskId?.trim();
    if (!tid) {
      continue;
    }
    const ver = row.outcomeVersion ?? 0;
    const prev = best.get(tid);
    if (!prev || (prev.outcomeVersion ?? 0) < ver) {
      best.set(tid, row);
    }
  }
  return [...best.values()];
}

/**
 * Sole recommended bridge from unified TaskOutcome → legacy evolution jsonl.
 * Cross-process atomic idempotency on taskId@outcomeVersion; newer versions
 * revoke older samples for the same task so failure→success converges.
 */
function revokeOlderSamplesLocked(
  cfg: OpenBotConfig,
  agentId: string,
  filePath: string,
  record: TaskOutcomeRecord,
  existing: EvolutionWithKey[],
  replacesKey: string,
): number {
  const olderKeys = new Set<string>();
  for (const obj of existing) {
    if (obj.revoked) {
      continue;
    }
    if (obj.taskId !== record.taskId) {
      continue;
    }
    const ver = obj.outcomeVersion ?? 0;
    if (ver < record.outcomeVersion) {
      olderKeys.add(obj.taskOutcomeKey ?? taskKey(record.taskId, ver));
    }
  }
  let revoked = 0;
  for (const oldKey of olderKeys) {
    const alreadyRevoked = existing.some((r) => r.revoked && r.taskOutcomeKey === oldKey);
    if (alreadyRevoked) {
      continue;
    }
    const revokePayload: EvolutionWithKey = {
      agentId,
      occurredAt: Date.now(),
      succeeded: false,
      taskId: record.taskId,
      taskOutcomeKey: oldKey,
      revoked: true,
      replacesTaskOutcomeKey: replacesKey,
      tenantId:
        record.scope.kind === "enterprise" ? record.scope.tenantId : scopeIdOf(record.scope),
    };
    appendEvolutionTaskOutcome(cfg, revokePayload);
    revoked += 1;
  }
  return revoked;
}

export function publishEvolutionFromTaskOutcome(
  cfg: OpenBotConfig,
  agentId: string,
  record: TaskOutcomeRecord,
): { written: boolean; reason: string } {
  if (record.lifecycle !== "closed") {
    return { written: false, reason: "incomplete_not_published" };
  }
  const eligibility = computeEvaluationEligibility(record);
  const filePath = resolveEvolutionTaskOutcomesPath(cfg, agentId);
  const key = taskKey(record.taskId, record.outcomeVersion);

  const excludeReason = ((): string | null => {
    if (record.taskJudgement === "cancelled") {
      return "cancelled_excluded";
    }
    if (!eligibility.countsSkillSuccessRate && record.taskJudgement === "failure") {
      if (!eligibility.countsGrowthNegative && !eligibility.countsModelStability) {
        return `excluded:${eligibility.attribution}`;
      }
    }
    if (record.taskJudgement === "success" && !eligibility.countsSkillSuccessRate) {
      return "success_not_eligible";
    }
    return null;
  })();

  // Closed but not evaluation-eligible (cancel / filtered / etc.): still revoke
  // older capability samples so failure→cancel corrections converge.
  if (excludeReason) {
    return withEvolutionFileLock(filePath, () => {
      const existing = readRawEvolutionLines(filePath);
      const revoked = revokeOlderSamplesLocked(cfg, agentId, filePath, record, existing, key);
      return {
        written: false,
        reason: revoked > 0 ? `${excludeReason};revoked_older` : excludeReason,
      };
    });
  }

  return withEvolutionFileLock(filePath, () => {
    const existing = readRawEvolutionLines(filePath);
    const exact = existing.find(
      (obj) =>
        !obj.revoked &&
        (obj.taskOutcomeKey === key ||
          (obj.taskId === record.taskId && obj.outcomeVersion === record.outcomeVersion)),
    );
    if (exact) {
      return { written: false, reason: "already_published" };
    }

    // Newer version already published — do not re-contribute an older failure on replay.
    const newer = existing.find(
      (obj) =>
        !obj.revoked &&
        obj.taskId === record.taskId &&
        (obj.outcomeVersion ?? 0) > record.outcomeVersion,
    );
    if (newer) {
      return { written: false, reason: "superseded_by_newer" };
    }

    revokeOlderSamplesLocked(cfg, agentId, filePath, record, existing, key);

    const olderKeys = new Set<string>();
    for (const obj of existing) {
      if (obj.revoked) {
        continue;
      }
      if (obj.taskId !== record.taskId) {
        continue;
      }
      const ver = obj.outcomeVersion ?? 0;
      if (ver < record.outcomeVersion) {
        olderKeys.add(obj.taskOutcomeKey ?? taskKey(record.taskId, ver));
      }
    }

    const tenantId =
      record.scope.kind === "enterprise" ? record.scope.tenantId : scopeIdOf(record.scope);

    const payload: EvolutionWithKey = {
      agentId,
      occurredAt: Date.parse(record.decidedAt),
      succeeded: record.taskJudgement === "success",
      runId: record.decisiveRunId,
      tenantId,
      taskId: record.taskId,
      outcomeVersion: record.outcomeVersion,
      taskOutcomeKey: key,
      ...(olderKeys.size > 0 ? { replacesTaskOutcomeKey: [...olderKeys][0] } : {}),
    };
    appendEvolutionTaskOutcome(cfg, payload);
    return { written: true, reason: "published" };
  });
}
