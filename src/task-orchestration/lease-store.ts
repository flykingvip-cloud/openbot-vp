/**
 * WP-06 — Orchestration lease / fencing helpers (persistence shape).
 *
 * Pure lease+fence state machine with an injectable file JSON store for tests
 * and future durable recovery drills. Does NOT arm a live scheduler.
 * Does NOT flip ORCHESTRATION_LIVE_INVOKE. Does NOT write Progress Ledger.
 * Does NOT reuse memory Stage D store files as orch lease authority — only
 * borrows CAS/fencing *semantics* (monotonic fence, stale reject, exclusive hold).
 */
import fs from "node:fs";
import path from "node:path";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

/** Named kill/restart fixture IDs from design §5 (scenario enums only — no fake metrics). */
export const ORCH_KILL_FIXTURE_IDS = [
  "orch.kill.before-schedule",
  "orch.kill.after-schedule",
  "orch.kill.before-exec",
  "orch.kill.after-exec",
  "orch.kill.before-result-persist",
  "orch.kill.after-result-persist",
] as const;

export type OrchKillFixtureId = (typeof ORCH_KILL_FIXTURE_IDS)[number];

const ORCH_KILL_FIXTURE_SET: ReadonlySet<string> = new Set(ORCH_KILL_FIXTURE_IDS);

export function isOrchKillFixtureId(value: string): value is OrchKillFixtureId {
  return ORCH_KILL_FIXTURE_SET.has(value);
}

/**
 * Durable lease record keyed by job/step id. Mirrors design §2/§4 fields.
 * In-memory OrchestratorJob remains separate; this is the lease/fence slice only.
 */
export type OrchLeaseRecord = {
  jobStepId: string;
  leaseHolder: string | null;
  /** Monotonic fencing token; increments on each successful (re)acquire. */
  fencingToken: number;
  heartbeatAt: number | null;
  deadlineAt: number | null;
  cancelRequested: boolean;
  attempt?: number;
  budgetRemaining?: number;
  resultRef?: string | null;
};

export type LeaseAcquireOk = {
  ok: true;
  record: OrchLeaseRecord;
};

export type LeaseAcquireFail = {
  ok: false;
  reason: "cancel_requested" | "lease_held" | "invalid_holder" | "invalid_job_step_id";
  record: OrchLeaseRecord;
};

export type LeaseHeartbeatOk = {
  ok: true;
  record: OrchLeaseRecord;
};

export type LeaseHeartbeatFail = {
  ok: false;
  reason:
    | "no_lease"
    | "stale_fencing_token"
    | "holder_mismatch"
    | "lease_expired"
    | "cancel_requested";
  record: OrchLeaseRecord | null;
};

export type LeaseReleaseOk = { ok: true; record: OrchLeaseRecord };
export type LeaseReleaseFail = {
  ok: false;
  reason: "no_lease" | "stale_fencing_token" | "holder_mismatch";
  record: OrchLeaseRecord | null;
};

export type SubmitResultOk = { ok: true; record: OrchLeaseRecord };
export type SubmitResultFail = {
  ok: false;
  reason: "no_lease" | "stale_fencing_token" | "holder_mismatch" | "lease_expired";
  record: OrchLeaseRecord | null;
};

export type OrchLeaseStore = {
  readonly rootDir: string | null;
  get(jobStepId: string): OrchLeaseRecord | null;
  tryAcquireLease(input: {
    jobStepId: string;
    holder: string;
    nowMs: number;
    /** Absolute deadline; when omitted, nowMs + leaseTtlMs. */
    deadlineAt?: number;
    leaseTtlMs?: number;
    attempt?: number;
    budgetRemaining?: number;
  }): LeaseAcquireOk | LeaseAcquireFail;
  heartbeat(input: {
    jobStepId: string;
    holder: string;
    fencingToken: number;
    nowMs: number;
  }): LeaseHeartbeatOk | LeaseHeartbeatFail;
  release(input: {
    jobStepId: string;
    holder: string;
    fencingToken: number;
  }): LeaseReleaseOk | LeaseReleaseFail;
  /**
   * Assert fence then optionally attach resultRef. Rejects stale fence with
   * `stale_fencing_token` (design §4).
   */
  submitResult(input: {
    jobStepId: string;
    holder: string;
    fencingToken: number;
    nowMs: number;
    resultRef?: string;
  }): SubmitResultOk | SubmitResultFail;
  requestCancel(jobStepId: string): OrchLeaseRecord;
  assertFence(input: {
    jobStepId: string;
    holder: string;
    fencingToken: number;
  }):
    | { ok: true; record: OrchLeaseRecord }
    | {
        ok: false;
        reason: "no_lease" | "stale_fencing_token" | "holder_mismatch";
        record: OrchLeaseRecord | null;
      };
};

const DEFAULT_LEASE_TTL_MS = 30_000;

function emptyRecord(jobStepId: string): OrchLeaseRecord {
  return {
    jobStepId,
    leaseHolder: null,
    fencingToken: 0,
    heartbeatAt: null,
    deadlineAt: null,
    cancelRequested: false,
    resultRef: null,
  };
}

function isLeaseActive(record: OrchLeaseRecord, nowMs: number): boolean {
  if (!record.leaseHolder) {
    return false;
  }
  if (record.deadlineAt == null) {
    return false;
  }
  return nowMs < record.deadlineAt;
}

function safeFileToken(jobStepId: string): string {
  return jobStepId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

function writeJsonAtomic(dest: string, value: unknown): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
}

function readJsonFile(dest: string): unknown {
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(dest, "utf8"));
  } catch {
    return null;
  }
}

function parseRecord(raw: unknown, fallbackId: string): OrchLeaseRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const jobStepId = typeof r.jobStepId === "string" ? r.jobStepId : fallbackId;
  return {
    jobStepId,
    leaseHolder: typeof r.leaseHolder === "string" ? r.leaseHolder : null,
    fencingToken: typeof r.fencingToken === "number" ? r.fencingToken : 0,
    heartbeatAt: typeof r.heartbeatAt === "number" ? r.heartbeatAt : null,
    deadlineAt: typeof r.deadlineAt === "number" ? r.deadlineAt : null,
    cancelRequested: r.cancelRequested === true,
    attempt: typeof r.attempt === "number" ? r.attempt : undefined,
    budgetRemaining: typeof r.budgetRemaining === "number" ? r.budgetRemaining : undefined,
    resultRef:
      typeof r.resultRef === "string" ? r.resultRef : r.resultRef === null ? null : undefined,
  };
}

/**
 * Create an orch lease store. Pass `rootDir` for file-backed JSON under
 * `<rootDir>/leases/*.json` (tests inject a temp dir). Omit for in-memory only.
 *
 * LIVE invoke remains false; this factory does not schedule work.
 */
export function createOrchLeaseStore(opts: { rootDir?: string } = {}): OrchLeaseStore {
  if (ORCHESTRATION_LIVE_INVOKE) {
    // Fail-closed documentation: this module must never be the path that arms live invoke.
    throw new Error("orch_lease_store_refuses_when_live_invoke_true");
  }

  const rootDir = opts.rootDir ? path.resolve(opts.rootDir) : null;
  const memory = new Map<string, OrchLeaseRecord>();

  const filePathFor = (jobStepId: string): string | null => {
    if (!rootDir) {
      return null;
    }
    return path.join(rootDir, "leases", `${safeFileToken(jobStepId)}.json`);
  };

  const load = (jobStepId: string): OrchLeaseRecord | null => {
    const fp = filePathFor(jobStepId);
    if (fp) {
      const parsed = parseRecord(readJsonFile(fp), jobStepId);
      if (parsed) {
        memory.set(jobStepId, parsed);
        return { ...parsed };
      }
    }
    const mem = memory.get(jobStepId);
    return mem ? { ...mem } : null;
  };

  const save = (record: OrchLeaseRecord): OrchLeaseRecord => {
    const copy = { ...record };
    memory.set(record.jobStepId, copy);
    const fp = filePathFor(record.jobStepId);
    if (fp) {
      writeJsonAtomic(fp, copy);
    }
    return { ...copy };
  };

  const getOrInit = (jobStepId: string): OrchLeaseRecord => {
    return load(jobStepId) ?? emptyRecord(jobStepId);
  };

  return {
    rootDir,
    get(jobStepId: string) {
      const id = jobStepId.trim();
      if (!id) {
        return null;
      }
      return load(id);
    },
    tryAcquireLease(input) {
      const jobStepId = input.jobStepId.trim();
      const holder = input.holder.trim();
      if (!jobStepId) {
        return {
          ok: false,
          reason: "invalid_job_step_id",
          record: emptyRecord(""),
        };
      }
      if (!holder) {
        return {
          ok: false,
          reason: "invalid_holder",
          record: getOrInit(jobStepId),
        };
      }
      const current = getOrInit(jobStepId);
      if (current.cancelRequested) {
        return { ok: false, reason: "cancel_requested", record: current };
      }
      if (isLeaseActive(current, input.nowMs) && current.leaseHolder !== holder) {
        return { ok: false, reason: "lease_held", record: current };
      }
      // Same holder renewing while active keeps fence; expired or free → bump fence.
      const renewingSame = isLeaseActive(current, input.nowMs) && current.leaseHolder === holder;
      const nextFence = renewingSame ? current.fencingToken : current.fencingToken + 1;
      const ttl = input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
      const deadlineAt = input.deadlineAt ?? input.nowMs + ttl;
      const record = save({
        ...current,
        leaseHolder: holder,
        fencingToken: nextFence,
        heartbeatAt: input.nowMs,
        deadlineAt,
        attempt: input.attempt ?? current.attempt,
        budgetRemaining: input.budgetRemaining ?? current.budgetRemaining,
      });
      return { ok: true, record };
    },
    heartbeat(input) {
      const jobStepId = input.jobStepId.trim();
      const current = load(jobStepId);
      if (!current || !current.leaseHolder) {
        return { ok: false, reason: "no_lease", record: current };
      }
      if (current.cancelRequested) {
        return { ok: false, reason: "cancel_requested", record: current };
      }
      if (current.fencingToken !== input.fencingToken) {
        return { ok: false, reason: "stale_fencing_token", record: current };
      }
      if (current.leaseHolder !== input.holder.trim()) {
        return { ok: false, reason: "holder_mismatch", record: current };
      }
      if (!isLeaseActive(current, input.nowMs)) {
        return { ok: false, reason: "lease_expired", record: current };
      }
      // Heartbeat must not extend past deadline: cap heartbeatAt at deadlineAt.
      const capped =
        current.deadlineAt == null ? input.nowMs : Math.min(input.nowMs, current.deadlineAt);
      const record = save({
        ...current,
        heartbeatAt: capped,
        // deadlineAt unchanged — never extended by heartbeat
      });
      return { ok: true, record };
    },
    release(input) {
      const current = load(input.jobStepId.trim());
      if (!current || !current.leaseHolder) {
        return { ok: false, reason: "no_lease", record: current };
      }
      if (current.fencingToken !== input.fencingToken) {
        return { ok: false, reason: "stale_fencing_token", record: current };
      }
      if (current.leaseHolder !== input.holder.trim()) {
        return { ok: false, reason: "holder_mismatch", record: current };
      }
      const record = save({
        ...current,
        leaseHolder: null,
        heartbeatAt: null,
        // Keep fencingToken / deadline / cancel / resultRef for audit continuity
      });
      return { ok: true, record };
    },
    assertFence(input) {
      const current = load(input.jobStepId.trim());
      if (!current || !current.leaseHolder) {
        return { ok: false, reason: "no_lease", record: current };
      }
      // Prefer stale_fencing_token so an expired worker is never mistaken for a
      // mere holder mismatch (design §4: old holder submit must be rejected).
      if (current.fencingToken !== input.fencingToken) {
        return { ok: false, reason: "stale_fencing_token", record: current };
      }
      if (current.leaseHolder !== input.holder.trim()) {
        return { ok: false, reason: "holder_mismatch", record: current };
      }
      return { ok: true, record: current };
    },
    submitResult(input) {
      const current = load(input.jobStepId.trim());
      if (!current || !current.leaseHolder) {
        return { ok: false, reason: "no_lease", record: current };
      }
      if (current.fencingToken !== input.fencingToken) {
        return { ok: false, reason: "stale_fencing_token", record: current };
      }
      if (current.leaseHolder !== input.holder.trim()) {
        return { ok: false, reason: "holder_mismatch", record: current };
      }
      if (!isLeaseActive(current, input.nowMs)) {
        return { ok: false, reason: "lease_expired", record: current };
      }
      const record = save({
        ...current,
        resultRef: input.resultRef ?? current.resultRef ?? null,
      });
      return { ok: true, record };
    },
    requestCancel(jobStepId: string) {
      const id = jobStepId.trim();
      const current = getOrInit(id);
      return save({ ...current, cancelRequested: true });
    },
  };
}
