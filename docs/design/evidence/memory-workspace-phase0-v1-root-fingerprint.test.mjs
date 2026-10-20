import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  decideV1RootGuard,
  evaluateDestructiveWithSidecar,
  isKnownConflictSqlite,
  normalizeRootFingerprint,
  rollbackSidecarToSingleRoot,
  signMaintenanceGrant,
  verifyMaintenanceGrant,
  withSidecarLock,
  writeSidecar,
} from "./memory-workspace-phase0-v1-root-fingerprint.mjs";

const SECRET = "phase0-v1-root-guard-test-secret";

void test("fingerprint is a resolved path, not a resource identity", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-fp-"));
  const fp = normalizeRootFingerprint(path.join(dir, ".", "workspace-bot-2"));
  assert.equal(fp, path.join(dir, "workspace-bot-2"));
  assert.equal(fp.includes("ws:"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

void test("unregistered and known-conflict stores fail closed on first destructive op", () => {
  const unregistered = decideV1RootGuard({
    op: "sync",
    incomingFingerprint: "/host/workspace-bot-2",
    recordedFingerprints: [],
    sqlitePath: "/state/memory/main.sqlite",
  });
  assert.equal(unregistered.allow, false);
  assert.equal(unregistered.reason, "unregistered-v1-fail-closed");

  assert.equal(isKnownConflictSqlite("/state/memory/agent-a.sqlite"), false);
  const unregisteredNamed = decideV1RootGuard({
    op: "prune",
    incomingFingerprint: "/host/workspace-agent-a",
    recordedFingerprints: [],
    sqlitePath: "/state/memory/agent-a.sqlite",
  });
  assert.equal(unregisteredNamed.allow, false);
  assert.equal(unregisteredNamed.reason, "unregistered-v1-fail-closed");

  const registeredNamed = decideV1RootGuard({
    op: "reset",
    incomingFingerprint: "/tenant/workspace-agent-a",
    recordedFingerprints: ["/tenant/workspace-agent-a"],
    sqlitePath: "/state/memory/agent-a.sqlite",
  });
  assert.equal(registeredNamed.allow, true);
  assert.equal(registeredNamed.action, "same-root");
});

void test("sidecar with multiple fingerprints is conflict evidence for any agent id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-conflict-"));
  const sqlitePath = path.join(dir, "agent-a.sqlite");
  writeSidecar(`${sqlitePath}.v1-root-guard.json`, {
    fingerprints: ["/host/workspace-agent-a", "/tenant/workspace-agent-a"],
  });
  assert.equal(isKnownConflictSqlite(sqlitePath), true);
  const known = decideV1RootGuard({
    op: "prune",
    incomingFingerprint: "/tenant/workspace-agent-a",
    recordedFingerprints: ["/tenant/workspace-agent-a"],
    sqlitePath,
  });
  assert.equal(known.allow, false);
  assert.equal(known.reason, "known-conflict-preset-deny");
  fs.rmSync(dir, { recursive: true, force: true });
});

void test("registered single-root non-conflict may sync; mismatch still refuses", () => {
  const same = decideV1RootGuard({
    op: "sync",
    incomingFingerprint: "/tenant/workspace-main",
    recordedFingerprints: ["/tenant/workspace-main"],
    sqlitePath: "/state/memory/main.sqlite",
  });
  assert.equal(same.allow, true);
  assert.equal(same.action, "same-root");

  const mismatch = decideV1RootGuard({
    op: "rebuild",
    incomingFingerprint: "/host/workspace-main",
    recordedFingerprints: ["/tenant/workspace-main"],
    sqlitePath: "/state/memory/main.sqlite",
  });
  assert.equal(mismatch.allow, false);
  assert.equal(mismatch.reason, "v1-multi-root-or-root-mismatch");
});

void test("arbitrary maintenance token is rejected; signed unexpired grant unlocks", () => {
  const arbitrary = decideV1RootGuard({
    op: "reset",
    incomingFingerprint: "/host/workspace-bot-2",
    recordedFingerprints: ["/tenant/workspace-bot-2"],
    sqlitePath: "/state/memory/bot-2.sqlite",
    unlock: {
      kind: "maintenance",
      token: "maint-1",
      reason: "approved-rollback-drill",
      secret: SECRET,
    },
  });
  assert.equal(arbitrary.allow, false);
  assert.equal(arbitrary.reason, "v1-multi-root-or-root-mismatch");

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
  assert.equal(unlocked.allow, true);
  assert.equal(unlocked.unlocked, true);
  assert.equal(unlocked.audit.tokenVerified, true);
  assert.equal(unlocked.audit.reason, "approved-rollback-drill");

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
  assert.equal(expiredDecision.allow, false);

  const verified = verifyMaintenanceGrant({
    kind: "maintenance",
    token,
    secret: SECRET,
    sqlitePath: "/state/memory/other.sqlite",
    op: "rebuild",
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, "unlock-sqlite-mismatch");

  const tenantA = "/tenants/001/memory/bot-2.sqlite";
  const tenantB = "/tenants/002/memory/bot-2.sqlite";
  const grantA = signMaintenanceGrant({
    secret: SECRET,
    sqlitePath: tenantA,
    op: "sync",
    reason: "tenant-a-only",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(
    verifyMaintenanceGrant({
      kind: "maintenance",
      token: grantA,
      secret: SECRET,
      sqlitePath: tenantB,
      op: "sync",
    }).ok,
    false,
  );
  assert.equal(
    verifyMaintenanceGrant({
      kind: "maintenance",
      token: grantA,
      secret: SECRET,
      sqlitePath: tenantA,
      op: "sync",
    }).ok,
    true,
  );
});

void test("sidecar lock serializes writers; empty store stays unregistered; registered main can roll back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-lock-"));
  const conflictSidecar = path.join(dir, "agent-a.sqlite.v1-root-guard.json");
  const first = await evaluateDestructiveWithSidecar({
    sidecarPath: conflictSidecar,
    sqlitePath: path.join(dir, "agent-a.sqlite"),
    op: "sync",
    incomingFingerprint: "/host/workspace-agent-a",
  });
  assert.equal(first.allow, false);
  assert.equal(first.reason, "unregistered-v1-fail-closed");

  const mainSidecar = path.join(dir, "main.sqlite.v1-root-guard.json");
  const unregistered = await evaluateDestructiveWithSidecar({
    sidecarPath: mainSidecar,
    sqlitePath: path.join(dir, "main.sqlite"),
    op: "sync",
    incomingFingerprint: "/tenant/workspace-main",
  });
  assert.equal(unregistered.allow, false);
  assert.equal(unregistered.reason, "unregistered-v1-fail-closed");

  rollbackSidecarToSingleRoot(mainSidecar, "/tenant/workspace-main");
  const afterRollback = await evaluateDestructiveWithSidecar({
    sidecarPath: mainSidecar,
    sqlitePath: path.join(dir, "main.sqlite"),
    op: "sync",
    incomingFingerprint: "/tenant/workspace-main",
  });
  assert.equal(afterRollback.allow, true);
  assert.equal(afterRollback.action, "same-root");

  const lockPath = path.join(dir, "cross.lock");
  const order = [];
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
  assert.deepEqual(order, ["a-start", "a-end", "b"]);
  fs.rmSync(dir, { recursive: true, force: true });
});
