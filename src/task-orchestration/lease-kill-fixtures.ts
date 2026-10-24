/**
 * WP-06 slice #2 — file-backed kill/restart drill harness for orch lease/fence.
 *
 * Exercises named fixtures from design §5 against `createOrchLeaseStore` with
 * injectable `rootDir`. Each fixture: seed pre-kill state → drop process
 * (new store instance, same rootDir) → assert post-conditions.
 *
 * Does NOT arm a live scheduler. Does NOT flip ORCHESTRATION_LIVE_INVOKE.
 * Does NOT write Progress Ledger. Does NOT claim G4-A / ACCEPTED.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ORCH_KILL_FIXTURE_IDS,
  createOrchLeaseStore,
  type OrchKillFixtureId,
  type OrchLeaseRecord,
  type OrchLeaseStore,
} from "./lease-store.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

export { ORCH_KILL_FIXTURE_IDS, isOrchKillFixtureId } from "./lease-store.js";
export type { OrchKillFixtureId } from "./lease-store.js";

/** Harness-level outcome for drills (not a production ledger reason code). */
export type KillFixtureOutcomeCode =
  | "ok"
  | "unknown_outcome"
  | "dual_holder_detected"
  | "hanging_lease"
  | "assertion_failed"
  | "live_invoke_blocked";

export type KillFixtureRunResult = {
  fixtureId: OrchKillFixtureId;
  ok: boolean;
  outcome: KillFixtureOutcomeCode;
  /** Human-readable assertions that passed/failed. */
  notes: string[];
  preKill?: Partial<OrchLeaseRecord> | null;
  postRestart?: Partial<OrchLeaseRecord> | null;
};

export type RunOrchKillFixtureInput = {
  fixtureId: OrchKillFixtureId;
  /** Real directory; harness creates leases under it via lease-store. */
  rootDir: string;
  jobStepId?: string;
};

function restartStore(rootDir: string): OrchLeaseStore {
  // New process ≈ new in-memory map; durable state is only under rootDir.
  return createOrchLeaseStore({ rootDir });
}

function snapshot(record: OrchLeaseRecord | null | undefined): Partial<OrchLeaseRecord> | null {
  if (!record) {
    return null;
  }
  return {
    jobStepId: record.jobStepId,
    leaseHolder: record.leaseHolder,
    fencingToken: record.fencingToken,
    heartbeatAt: record.heartbeatAt,
    deadlineAt: record.deadlineAt,
    cancelRequested: record.cancelRequested,
    resultRef: record.resultRef ?? null,
    attempt: record.attempt,
  };
}

function projectionPath(rootDir: string, jobStepId: string): string {
  const token = jobStepId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
  return path.join(rootDir, "projections", `${token}.json`);
}

/**
 * Idempotent recover/project helper for after-result-persist drills.
 * Writes resultRef once under rootDir/projections; repeats do not rewrite.
 */
function recoverProjectOnce(
  rootDir: string,
  record: OrchLeaseRecord,
): { projected: boolean; alreadyPresent: boolean; resultRef: string | null } {
  const dest = projectionPath(rootDir, record.jobStepId);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    const raw = JSON.parse(fs.readFileSync(dest, "utf8")) as { resultRef?: string | null };
    return {
      projected: false,
      alreadyPresent: true,
      resultRef: typeof raw.resultRef === "string" ? raw.resultRef : null,
    };
  }
  const resultRef = record.resultRef ?? null;
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ resultRef, jobStepId: record.jobStepId }, null, 2)}\n`);
  fs.renameSync(tmp, dest);
  return { projected: true, alreadyPresent: false, resultRef };
}

function runBeforeSchedule(rootDir: string, jobStepId: string): KillFixtureRunResult {
  const notes: string[] = [];
  const store1 = createOrchLeaseStore({ rootDir });
  // Job known on durable face, no active worker: seed then release.
  const seeded = store1.tryAcquireLease({
    jobStepId,
    holder: "seed-bootstrap",
    nowMs: 1_000,
    leaseTtlMs: 60_000,
  });
  if (!seeded.ok) {
    return {
      fixtureId: "orch.kill.before-schedule",
      ok: false,
      outcome: "assertion_failed",
      notes: [`seed acquire failed: ${seeded.reason}`],
    };
  }
  const released = store1.release({
    jobStepId,
    holder: "seed-bootstrap",
    fencingToken: seeded.record.fencingToken,
  });
  if (!released.ok) {
    return {
      fixtureId: "orch.kill.before-schedule",
      ok: false,
      outcome: "assertion_failed",
      notes: [`seed release failed: ${released.reason}`],
    };
  }
  const preKill = snapshot(store1.get(jobStepId));
  notes.push("pre-kill: job persisted, leaseHolder=null");

  // Crash / restart
  const store2 = restartStore(rootDir);
  const after = store2.get(jobStepId);
  if (!after || after.leaseHolder !== null) {
    return {
      fixtureId: "orch.kill.before-schedule",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "post-restart: expected persisted job with no holder"],
      preKill,
      postRestart: snapshot(after),
    };
  }

  const a = store2.tryAcquireLease({
    jobStepId,
    holder: "worker-new",
    nowMs: 2_000,
    leaseTtlMs: 10_000,
  });
  const b = store2.tryAcquireLease({
    jobStepId,
    holder: "worker-rival",
    nowMs: 2_100,
    leaseTtlMs: 10_000,
  });
  if (!a.ok) {
    return {
      fixtureId: "orch.kill.before-schedule",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, `new holder acquire failed: ${a.reason}`],
      preKill,
      postRestart: snapshot(store2.get(jobStepId)),
    };
  }
  if (b.ok) {
    return {
      fixtureId: "orch.kill.before-schedule",
      ok: false,
      outcome: "dual_holder_detected",
      notes: [...notes, "rival acquired while first hold active"],
      preKill,
      postRestart: snapshot(b.record),
    };
  }
  notes.push("post-restart: new holder acquired; rival blocked (no dual holders)");
  return {
    fixtureId: "orch.kill.before-schedule",
    ok: true,
    outcome: "ok",
    notes,
    preKill,
    postRestart: snapshot(a.record),
  };
}

function runAfterSchedule(rootDir: string, jobStepId: string): KillFixtureRunResult {
  const notes: string[] = [];
  const store1 = createOrchLeaseStore({ rootDir });
  const granted = store1.tryAcquireLease({
    jobStepId,
    holder: "worker-old",
    nowMs: 1_000,
    deadlineAt: 2_000,
  });
  if (!granted.ok) {
    return {
      fixtureId: "orch.kill.after-schedule",
      ok: false,
      outcome: "assertion_failed",
      notes: [`acquire failed: ${granted.reason}`],
    };
  }
  const oldFence = granted.record.fencingToken;
  const preKill = snapshot(granted.record);
  notes.push(`pre-kill: lease granted to worker-old fence=${oldFence}; exec not started`);

  const store2 = restartStore(rootDir);
  // After expiry: fencing increments on reacquire; old holder submit rejected.
  const reacq = store2.tryAcquireLease({
    jobStepId,
    holder: "worker-new",
    nowMs: 3_000,
    leaseTtlMs: 10_000,
  });
  if (!reacq.ok) {
    return {
      fixtureId: "orch.kill.after-schedule",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, `reacquire after expiry failed: ${reacq.reason}`],
      preKill,
      postRestart: snapshot(store2.get(jobStepId)),
    };
  }
  if (reacq.record.fencingToken <= oldFence) {
    return {
      fixtureId: "orch.kill.after-schedule",
      ok: false,
      outcome: "assertion_failed",
      notes: [
        ...notes,
        `expected fence bump after expiry; old=${oldFence} new=${reacq.record.fencingToken}`,
      ],
      preKill,
      postRestart: snapshot(reacq.record),
    };
  }
  const stale = store2.submitResult({
    jobStepId,
    holder: "worker-old",
    fencingToken: oldFence,
    nowMs: 3_100,
    resultRef: "stale-exec",
  });
  if (stale.ok || stale.reason !== "stale_fencing_token") {
    return {
      fixtureId: "orch.kill.after-schedule",
      ok: false,
      outcome: "assertion_failed",
      notes: [
        ...notes,
        `old holder submit expected stale_fencing_token; got ok=${stale.ok} reason=${"reason" in stale ? stale.reason : "n/a"}`,
      ],
      preKill,
      postRestart: snapshot(reacq.record),
    };
  }
  notes.push("post-restart+expiry: fence bumped; old holder submit rejected");
  return {
    fixtureId: "orch.kill.after-schedule",
    ok: true,
    outcome: "ok",
    notes,
    preKill,
    postRestart: snapshot(reacq.record),
  };
}

function runBeforeExec(rootDir: string, jobStepId: string): KillFixtureRunResult {
  const notes: string[] = [];
  const store1 = createOrchLeaseStore({ rootDir });
  const granted = store1.tryAcquireLease({
    jobStepId,
    holder: "worker-a",
    nowMs: 1_000,
    leaseTtlMs: 30_000,
  });
  if (!granted.ok) {
    return {
      fixtureId: "orch.kill.before-exec",
      ok: false,
      outcome: "assertion_failed",
      notes: [`acquire failed: ${granted.reason}`],
    };
  }
  const preKill = snapshot(granted.record);
  notes.push("pre-kill: about to call tool; lease held by worker-a");

  const store2 = restartStore(rootDir);
  // Same action/lease key must not allow dual active holders while lease valid.
  const rival = store2.tryAcquireLease({
    jobStepId,
    holder: "worker-b",
    nowMs: 1_500,
    leaseTtlMs: 30_000,
  });
  if (rival.ok) {
    return {
      fixtureId: "orch.kill.before-exec",
      ok: false,
      outcome: "dual_holder_detected",
      notes: [...notes, "rival acquired while lease still active after restart"],
      preKill,
      postRestart: snapshot(rival.record),
    };
  }
  if (rival.reason !== "lease_held") {
    return {
      fixtureId: "orch.kill.before-exec",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, `expected lease_held, got ${rival.reason}`],
      preKill,
      postRestart: snapshot(store2.get(jobStepId)),
    };
  }
  const holders = new Set(
    [store2.get(jobStepId)?.leaseHolder].filter((h): h is string => typeof h === "string"),
  );
  if (holders.size !== 1 || !holders.has("worker-a")) {
    return {
      fixtureId: "orch.kill.before-exec",
      ok: false,
      outcome: "dual_holder_detected",
      notes: [...notes, `unexpected holders: ${[...holders].join(",")}`],
      preKill,
      postRestart: snapshot(store2.get(jobStepId)),
    };
  }
  notes.push("post-restart: same lease key blocks dual active holders");
  return {
    fixtureId: "orch.kill.before-exec",
    ok: true,
    outcome: "ok",
    notes,
    preKill,
    postRestart: snapshot(store2.get(jobStepId)),
  };
}

function runAfterExec(rootDir: string, jobStepId: string): KillFixtureRunResult {
  const notes: string[] = [];
  const store1 = createOrchLeaseStore({ rootDir });
  const granted = store1.tryAcquireLease({
    jobStepId,
    holder: "worker-old",
    nowMs: 1_000,
    deadlineAt: 2_000,
  });
  if (!granted.ok) {
    return {
      fixtureId: "orch.kill.after-exec",
      ok: false,
      outcome: "assertion_failed",
      notes: [`acquire failed: ${granted.reason}`],
    };
  }
  const oldFence = granted.record.fencingToken;
  // Tool "returned" in worker memory only — result never persisted.
  const preKill = snapshot(granted.record);
  notes.push("pre-kill: tool returned in-memory; resultRef not persisted");

  const store2 = restartStore(rootDir);
  // Time past deadline; new holder takes over.
  const reacq = store2.tryAcquireLease({
    jobStepId,
    holder: "worker-new",
    nowMs: 3_000,
    leaseTtlMs: 10_000,
  });
  if (!reacq.ok) {
    return {
      fixtureId: "orch.kill.after-exec",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, `reacquire failed: ${reacq.reason}`],
      preKill,
      postRestart: snapshot(store2.get(jobStepId)),
    };
  }
  const stale = store2.submitResult({
    jobStepId,
    holder: "worker-old",
    fencingToken: oldFence,
    nowMs: 3_100,
    resultRef: "ghost-tool-return",
  });
  if (stale.ok) {
    return {
      fixtureId: "orch.kill.after-exec",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "old fence submit unexpectedly accepted"],
      preKill,
      postRestart: snapshot(reacq.record),
    };
  }
  // Missing persist + rejected old fence → unknown_outcome / re-query path.
  notes.push(`old fence rejected (${stale.reason}); outcome=unknown_outcome (re-query required)`);
  return {
    fixtureId: "orch.kill.after-exec",
    ok: true,
    outcome: "unknown_outcome",
    notes,
    preKill,
    postRestart: snapshot(reacq.record),
  };
}

function runBeforeResultPersist(rootDir: string, jobStepId: string): KillFixtureRunResult {
  const notes: string[] = [];
  const store1 = createOrchLeaseStore({ rootDir });
  const granted = store1.tryAcquireLease({
    jobStepId,
    holder: "worker-crash",
    nowMs: 1_000,
    deadlineAt: 2_000,
  });
  if (!granted.ok) {
    return {
      fixtureId: "orch.kill.before-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [`acquire failed: ${granted.reason}`],
    };
  }
  // Simulate mid-persist crash: leave a tmp sibling that never renamed, and
  // never call submitResult (resultRef still null).
  const leasesDir = path.join(rootDir, "leases");
  fs.mkdirSync(leasesDir, { recursive: true });
  const danglingTmp = path.join(leasesDir, `mid-persist.${process.pid}.tmp`);
  fs.writeFileSync(danglingTmp, '{"partial":true\n', "utf8"); // intentionally incomplete JSON
  const preKill = snapshot(store1.get(jobStepId));
  notes.push("pre-kill: crash mid-persist (dangling tmp + no resultRef)");

  const store2 = restartStore(rootDir);
  const mid = store2.get(jobStepId);
  if (!mid || mid.resultRef) {
    return {
      fixtureId: "orch.kill.before-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "expected loaded lease with null resultRef after crash"],
      preKill,
      postRestart: snapshot(mid),
    };
  }

  // After expiry, new holder must acquire; no permanent hanging lease.
  const reacq = store2.tryAcquireLease({
    jobStepId,
    holder: "worker-recover",
    nowMs: 3_000,
    leaseTtlMs: 10_000,
  });
  if (!reacq.ok) {
    return {
      fixtureId: "orch.kill.before-result-persist",
      ok: false,
      outcome: "hanging_lease",
      notes: [...notes, `could not reacquire after expiry: ${reacq.reason}`],
      preKill,
      postRestart: snapshot(mid),
    };
  }
  const terminal = store2.submitResult({
    jobStepId,
    holder: "worker-recover",
    fencingToken: reacq.record.fencingToken,
    nowMs: 3_100,
    resultRef: "converged-terminal",
  });
  if (!terminal.ok) {
    return {
      fixtureId: "orch.kill.before-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, `terminal submit failed: ${terminal.reason}`],
      preKill,
      postRestart: snapshot(reacq.record),
    };
  }
  // Single terminal state: exactly one resultRef, one active holder path.
  const finalRec = store2.get(jobStepId);
  if (!finalRec || finalRec.resultRef !== "converged-terminal") {
    return {
      fixtureId: "orch.kill.before-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "did not converge to single terminal resultRef"],
      preKill,
      postRestart: snapshot(finalRec),
    };
  }
  // Dangling tmp must not block convergence (lease JSON is authoritative).
  notes.push("post-restart: expiry clears hang; single terminal resultRef");
  return {
    fixtureId: "orch.kill.before-result-persist",
    ok: true,
    outcome: "ok",
    notes,
    preKill,
    postRestart: snapshot(finalRec),
  };
}

function runAfterResultPersist(rootDir: string, jobStepId: string): KillFixtureRunResult {
  const notes: string[] = [];
  const store1 = createOrchLeaseStore({ rootDir });
  const granted = store1.tryAcquireLease({
    jobStepId,
    holder: "worker-a",
    nowMs: 1_000,
    leaseTtlMs: 60_000,
  });
  if (!granted.ok) {
    return {
      fixtureId: "orch.kill.after-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [`acquire failed: ${granted.reason}`],
    };
  }
  const submitted = store1.submitResult({
    jobStepId,
    holder: "worker-a",
    fencingToken: granted.record.fencingToken,
    nowMs: 1_100,
    resultRef: "persisted-result-v1",
  });
  if (!submitted.ok) {
    return {
      fixtureId: "orch.kill.after-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [`submitResult failed: ${submitted.reason}`],
    };
  }
  const preKill = snapshot(submitted.record);
  notes.push("pre-kill: result persisted; projection not yet applied");

  const store2 = restartStore(rootDir);
  const loaded = store2.get(jobStepId);
  if (!loaded || loaded.resultRef !== "persisted-result-v1") {
    return {
      fixtureId: "orch.kill.after-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "persisted resultRef missing after restart"],
      preKill,
      postRestart: snapshot(loaded),
    };
  }
  const fence1 = store2.assertFence({
    jobStepId,
    holder: "worker-a",
    fencingToken: loaded.fencingToken,
  });
  if (!fence1.ok) {
    return {
      fixtureId: "orch.kill.after-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, `assertFence failed: ${fence1.reason}`],
      preKill,
      postRestart: snapshot(loaded),
    };
  }
  const first = recoverProjectOnce(rootDir, loaded);
  const second = recoverProjectOnce(rootDir, loaded);
  if (!first.projected || first.alreadyPresent) {
    return {
      fixtureId: "orch.kill.after-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "first recover should project once"],
      preKill,
      postRestart: snapshot(loaded),
    };
  }
  if (second.projected || !second.alreadyPresent) {
    return {
      fixtureId: "orch.kill.after-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "repeat recover must not project a second business effect"],
      preKill,
      postRestart: snapshot(loaded),
    };
  }
  if (second.resultRef !== "persisted-result-v1") {
    return {
      fixtureId: "orch.kill.after-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "projection resultRef mismatch on idempotent recover"],
      preKill,
      postRestart: snapshot(loaded),
    };
  }
  const fence2 = store2.assertFence({
    jobStepId,
    holder: "worker-a",
    fencingToken: loaded.fencingToken,
  });
  if (!fence2.ok) {
    return {
      fixtureId: "orch.kill.after-result-persist",
      ok: false,
      outcome: "assertion_failed",
      notes: [...notes, "assertFence not idempotent after recover"],
      preKill,
      postRestart: snapshot(loaded),
    };
  }
  notes.push("post-restart: assertFence + recover idempotent; no second business effect");
  return {
    fixtureId: "orch.kill.after-result-persist",
    ok: true,
    outcome: "ok",
    notes,
    preKill,
    postRestart: snapshot(loaded),
  };
}

const FIXTURE_RUNNERS: Record<
  OrchKillFixtureId,
  (rootDir: string, jobStepId: string) => KillFixtureRunResult
> = {
  "orch.kill.before-schedule": runBeforeSchedule,
  "orch.kill.after-schedule": runAfterSchedule,
  "orch.kill.before-exec": runBeforeExec,
  "orch.kill.after-exec": runAfterExec,
  "orch.kill.before-result-persist": runBeforeResultPersist,
  "orch.kill.after-result-persist": runAfterResultPersist,
};

/**
 * Run one named kill/restart fixture against a file-backed lease store.
 * Requires a real `rootDir` (tests should pass `fs.mkdtemp` paths).
 */
export function runOrchKillFixture(input: RunOrchKillFixtureInput): KillFixtureRunResult {
  if (ORCHESTRATION_LIVE_INVOKE) {
    return {
      fixtureId: input.fixtureId,
      ok: false,
      outcome: "live_invoke_blocked",
      notes: ["refuses to run kill fixtures when ORCHESTRATION_LIVE_INVOKE is true"],
    };
  }
  const rootDir = path.resolve(input.rootDir);
  fs.mkdirSync(rootDir, { recursive: true });
  const jobStepId = input.jobStepId ?? `fixture/${input.fixtureId}`;
  const runner = FIXTURE_RUNNERS[input.fixtureId];
  return runner(rootDir, jobStepId);
}

/** Run every design §5 fixture under isolated subdirs of `rootDir`. */
export function runAllOrchKillFixtures(input: { rootDir: string }): KillFixtureRunResult[] {
  const base = path.resolve(input.rootDir);
  return ORCH_KILL_FIXTURE_IDS.map((fixtureId) => {
    const dir = path.join(base, fixtureId.replace(/[^a-zA-Z0-9._-]+/g, "_"));
    fs.mkdirSync(dir, { recursive: true });
    return runOrchKillFixture({ fixtureId, rootDir: dir });
  });
}
