import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendMaintenanceUnlockAudit,
  decideV1RootGuard,
  evaluateDestructiveInDbTransaction,
  evaluateDestructiveWithSidecar,
  isKnownConflictSqlite,
  normalizeRootFingerprint,
  normalizeSqliteInstanceId,
  readMaintenanceUnlockAudit,
  rollbackSidecarToSingleRoot,
  resolveV1RootGuardIndexStatus,
  signMaintenanceGrant,
  verifyMaintenanceGrant,
  withSidecarLock,
  writeFingerprintsToDb,
  writeSidecar,
} from "./v1-root-guard.js";

const SECRET = "phase0-v1-root-guard-test-secret";

describe("v1 root guard decision model", () => {
  it("fingerprint is a resolved path, not a resource identity", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-fp-"));
    const fp = normalizeRootFingerprint(path.join(dir, ".", "workspace-bot-2"));
    expect(fp).toBe(path.join(dir, "workspace-bot-2"));
    expect(fp.includes("ws:")).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("unregistered first sync/prune/reset/rebuild all fail closed", () => {
    for (const op of ["sync", "prune", "reset", "rebuild"] as const) {
      const decision = decideV1RootGuard({
        op,
        incomingFingerprint: "/tenant/workspace-main",
        recordedFingerprints: [],
        sqlitePath: "/state/memory/main.sqlite",
      });
      expect(decision.allow, op).toBe(false);
      expect(decision.reason, op).toBe("unregistered-v1-fail-closed");
    }
  });

  it("unregistered and known-conflict stores fail closed on first destructive op", () => {
    const unregistered = decideV1RootGuard({
      op: "sync",
      incomingFingerprint: "/host/workspace-bot-2",
      recordedFingerprints: [],
      sqlitePath: "/state/memory/main.sqlite",
    });
    expect(unregistered.allow).toBe(false);
    expect(unregistered.reason).toBe("unregistered-v1-fail-closed");

    expect(isKnownConflictSqlite("/state/memory/agent-a.sqlite")).toBe(false);
    const unregisteredNamed = decideV1RootGuard({
      op: "prune",
      incomingFingerprint: "/host/workspace-agent-a",
      recordedFingerprints: [],
      sqlitePath: "/state/memory/agent-a.sqlite",
    });
    expect(unregisteredNamed.allow).toBe(false);
    expect(unregisteredNamed.reason).toBe("unregistered-v1-fail-closed");

    const registeredNamed = decideV1RootGuard({
      op: "reset",
      incomingFingerprint: "/tenant/workspace-agent-a",
      recordedFingerprints: ["/tenant/workspace-agent-a"],
      sqlitePath: "/state/memory/agent-a.sqlite",
    });
    expect(registeredNamed.allow).toBe(true);
    expect(registeredNamed.action).toBe("same-root");
  });

  it("sidecar with multiple fingerprints is conflict evidence for any agent id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-conflict-"));
    const sqlitePath = path.join(dir, "agent-a.sqlite");
    writeSidecar(`${sqlitePath}.v1-root-guard.json`, {
      fingerprints: ["/host/workspace-agent-a", "/tenant/workspace-agent-a"],
    });
    expect(isKnownConflictSqlite(sqlitePath)).toBe(true);
    const known = decideV1RootGuard({
      op: "prune",
      incomingFingerprint: "/tenant/workspace-agent-a",
      recordedFingerprints: ["/tenant/workspace-agent-a"],
      sqlitePath,
    });
    expect(known.allow).toBe(false);
    expect(known.reason).toBe("known-conflict-preset-deny");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("registered single-root non-conflict may sync; mismatch still refuses", () => {
    const same = decideV1RootGuard({
      op: "sync",
      incomingFingerprint: "/tenant/workspace-main",
      recordedFingerprints: ["/tenant/workspace-main"],
      sqlitePath: "/state/memory/main.sqlite",
    });
    expect(same.allow).toBe(true);
    expect(same.action).toBe("same-root");

    const mismatch = decideV1RootGuard({
      op: "rebuild",
      incomingFingerprint: "/host/workspace-main",
      recordedFingerprints: ["/tenant/workspace-main"],
      sqlitePath: "/state/memory/main.sqlite",
    });
    expect(mismatch.allow).toBe(false);
    expect(mismatch.reason).toBe("v1-multi-root-or-root-mismatch");
  });

  it("arbitrary maintenance token is rejected; signed unexpired grant unlocks", () => {
    const arbitrary = decideV1RootGuard({
      op: "reset",
      incomingFingerprint: "/host/workspace-bot-2",
      recordedFingerprints: ["/tenant/workspace-bot-2"],
      sqlitePath: "/state/memory/bot-2.sqlite",
      unlock: {
        kind: "maintenance",
        token: "maint-1",
        secret: SECRET,
      },
    });
    expect(arbitrary.allow).toBe(false);
    expect(arbitrary.reason).toBe("v1-multi-root-or-root-mismatch");

    const token = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath: "/state/memory/bot-2.sqlite",
      op: "rebuild",
      reason: "approved-rollback-drill",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const unlocked = decideV1RootGuard({
      op: "rebuild",
      incomingFingerprint: "/host/workspace-bot-2",
      recordedFingerprints: ["/tenant/workspace-bot-2"],
      sqlitePath: "/state/memory/bot-2.sqlite",
      unlock: { kind: "maintenance", token, secret: SECRET },
    });
    expect(unlocked.allow).toBe(true);
    expect(unlocked.unlocked).toBe(true);
    expect(unlocked.audit?.tokenVerified).toBe(true);
    expect(unlocked.audit?.reason).toBe("approved-rollback-drill");

    const expired = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath: "/state/memory/bot-2.sqlite",
      op: "rebuild",
      reason: "expired",
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const expiredDecision = decideV1RootGuard({
      op: "rebuild",
      incomingFingerprint: "/host/workspace-bot-2",
      recordedFingerprints: ["/tenant/workspace-bot-2"],
      sqlitePath: "/state/memory/bot-2.sqlite",
      unlock: { kind: "maintenance", token: expired, secret: SECRET },
    });
    expect(expiredDecision.allow).toBe(false);

    const verified = verifyMaintenanceGrant({
      kind: "maintenance",
      token,
      secret: SECRET,
      sqlitePath: "/state/memory/other.sqlite",
      op: "rebuild",
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.reason).toBe("unlock-sqlite-mismatch");
    }

    const tenantA = "/tenants/001/memory/bot-2.sqlite";
    const tenantB = "/tenants/002/memory/bot-2.sqlite";
    const grantA = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath: tenantA,
      op: "sync",
      reason: "tenant-a-only",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(
      verifyMaintenanceGrant({
        kind: "maintenance",
        token: grantA,
        secret: SECRET,
        sqlitePath: tenantB,
        op: "sync",
      }).ok,
    ).toBe(false);
    expect(
      verifyMaintenanceGrant({
        kind: "maintenance",
        token: grantA,
        secret: SECRET,
        sqlitePath: tenantA,
        op: "sync",
      }).ok,
    ).toBe(true);
    expect(normalizeSqliteInstanceId(tenantA)).not.toBe(normalizeSqliteInstanceId(tenantB));
  });

  it("grant is bound to sqlite instance, op, and expiry", () => {
    const sqlitePath = "/state/memory/main.sqlite";
    const token = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath,
      op: "prune",
      reason: "cache-trim",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(
      verifyMaintenanceGrant({
        kind: "maintenance",
        token,
        secret: SECRET,
        sqlitePath,
        op: "reset",
      }).ok,
    ).toBe(false);
    expect(
      verifyMaintenanceGrant({
        kind: "maintenance",
        token,
        secret: SECRET,
        sqlitePath,
        op: "prune",
      }).ok,
    ).toBe(true);
  });

  it("sidecar lock serializes writers; empty store stays unregistered; registered main can roll back", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-lock-"));
    const conflictSidecar = path.join(dir, "agent-a.sqlite.v1-root-guard.json");
    const first = await evaluateDestructiveWithSidecar({
      sidecarPath: conflictSidecar,
      sqlitePath: path.join(dir, "agent-a.sqlite"),
      op: "sync",
      incomingFingerprint: "/host/workspace-agent-a",
    });
    expect(first.allow).toBe(false);
    expect(first.reason).toBe("unregistered-v1-fail-closed");

    const mainSidecar = path.join(dir, "main.sqlite.v1-root-guard.json");
    const unregistered = await evaluateDestructiveWithSidecar({
      sidecarPath: mainSidecar,
      sqlitePath: path.join(dir, "main.sqlite"),
      op: "sync",
      incomingFingerprint: "/tenant/workspace-main",
    });
    expect(unregistered.allow).toBe(false);
    expect(unregistered.reason).toBe("unregistered-v1-fail-closed");

    rollbackSidecarToSingleRoot(mainSidecar, "/tenant/workspace-main");
    const afterRollback = await evaluateDestructiveWithSidecar({
      sidecarPath: mainSidecar,
      sqlitePath: path.join(dir, "main.sqlite"),
      op: "sync",
      incomingFingerprint: "/tenant/workspace-main",
    });
    expect(afterRollback.allow).toBe(true);
    expect(afterRollback.action).toBe("same-root");

    const lockPath = path.join(dir, "cross.lock");
    const order: string[] = [];
    await Promise.all([
      withSidecarLock(lockPath, async () => {
        order.push("a-start");
        await new Promise((resolve) => setTimeout(resolve, 40));
        order.push("a-end");
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await withSidecarLock(lockPath, () => {
          order.push("b");
        });
      })(),
    ]);
    expect(order).toEqual(["a-start", "a-end", "b"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("v1 root guard db transaction", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses unregistered db in a transaction and writes nothing on deny", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-db-"));
    dirs.push(dir);
    const sqlitePath = path.join(dir, "main.sqlite");
    const db = new DatabaseSync(sqlitePath);
    db.exec("CREATE TABLE files (path TEXT PRIMARY KEY)");
    db.prepare("INSERT INTO files (path) VALUES (?)").run("keep.md");

    const decision = evaluateDestructiveInDbTransaction(db, {
      op: "reset",
      incomingFingerprint: "/tenant/workspace-main",
      sqlitePath,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("unregistered-v1-fail-closed");
    expect(db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).toEqual({ c: 1 });
    db.close();
  });

  it("allows same-root after explicit register", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-db-"));
    dirs.push(dir);
    const sqlitePath = path.join(dir, "main.sqlite");
    const db = new DatabaseSync(sqlitePath);
    writeFingerprintsToDb(db, ["/tenant/workspace-main"]);
    const decision = evaluateDestructiveInDbTransaction(db, {
      op: "sync",
      incomingFingerprint: "/tenant/workspace-main",
      sqlitePath,
    });
    expect(decision.allow).toBe(true);
    expect(decision.action).toBe("same-root");
    db.close();
  });
});

describe("v1 maintenance unlock audit sink", () => {
  it("appends structured unlock receipts and does not overwrite prior lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-audit-"));
    const sqlitePath = path.join(dir, "bot-2.sqlite");
    const sqliteInstance = normalizeSqliteInstanceId(sqlitePath);
    const first = appendMaintenanceUnlockAudit(sqlitePath, {
      op: "rebuild",
      reason: "approved-rollback-drill",
      sqliteInstance,
      sqlitePath,
      iat: "2026-08-14T13:00:00.000Z",
      exp: "2026-08-14T13:05:00.000Z",
      tokenVerified: true,
    });
    const second = appendMaintenanceUnlockAudit(sqlitePath, {
      op: "prune",
      reason: "second-approved-op",
      sqliteInstance,
      sqlitePath,
      iat: "2026-08-14T13:06:00.000Z",
      exp: "2026-08-14T13:10:00.000Z",
      tokenVerified: true,
    });
    const records = readMaintenanceUnlockAudit(sqlitePath);
    expect(records).toHaveLength(2);
    expect(first.action).toBe("maintenance-unlock");
    expect(records[0]).toMatchObject({
      action: "maintenance-unlock",
      sqliteInstance,
      sqlitePath,
      op: "rebuild",
      reason: "approved-rollback-drill",
      iat: "2026-08-14T13:00:00.000Z",
      exp: "2026-08-14T13:05:00.000Z",
      tokenVerified: true,
    });
    expect(records[1]).toMatchObject({
      action: "maintenance-unlock",
      op: "prune",
      reason: "second-approved-op",
      tokenVerified: true,
    });
    expect(typeof second.recordedAt).toBe("string");
    expect(Number.isNaN(Date.parse(second.recordedAt))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolveV1RootGuardIndexStatus prefers last refusal over structural state", () => {
    const refusal = decideV1RootGuard({
      op: "sync",
      incomingFingerprint: "/tenant/workspace-main",
      recordedFingerprints: [],
      sqlitePath: "/state/memory/main.sqlite",
    });
    expect(
      resolveV1RootGuardIndexStatus({
        lastRefusal: refusal,
        incomingFingerprint: "/tenant/workspace-main",
        recordedFingerprints: [],
        sqlitePath: "/state/memory/main.sqlite",
      }),
    ).toEqual({
      indexStatus: "unknown",
      reason: "unregistered-v1-fail-closed",
      refusedOp: "sync",
      knownConflict: false,
    });
  });

  it("resolveV1RootGuardIndexStatus maps multi-fingerprint sidecar to degraded", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-status-"));
    const sqlitePath = path.join(dir, "agent-a.sqlite");
    writeSidecar(`${sqlitePath}.v1-root-guard.json`, {
      fingerprints: ["/host/workspace-agent-a", "/tenant/workspace-agent-a"],
    });
    expect(
      resolveV1RootGuardIndexStatus({
        lastRefusal: null,
        incomingFingerprint: "/host/workspace-agent-a",
        recordedFingerprints: ["/host/workspace-agent-a"],
        sqlitePath,
      }),
    ).toMatchObject({
      indexStatus: "degraded",
      reason: "known-conflict-preset-deny",
      knownConflict: true,
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
