import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireNodeSqlite } from "../memory/sqlite.js";
import {
  CONTROL_PLANE_UNINITIALIZED_REASON,
  InMemoryActivationControlPlane,
  SqliteActivationControlPlane,
} from "./control-plane.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-cp-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function deleteDbFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
}

describe("SqliteActivationControlPlane — fail-safe-off initialization (P0)", () => {
  it("a brand-new control plane is forced OFF (uninitialized), not enabled", () => {
    const cp = new SqliteActivationControlPlane({ storeRoot: root, now: () => 5 });
    expect(cp.isForcedOff()).toBe(true);
    const snap = cp.snapshot();
    expect(snap.reason).toBe(CONTROL_PLANE_UNINITIALIZED_REASON);
    expect(snap.degradedAtMs).toBe(5);
    cp.close();
  });

  it("stays OFF after forceOff, close, delete DB, and recreate (fresh = OFF)", () => {
    const first = new SqliteActivationControlPlane({
      storeRoot: root,
      now: () => 1,
      minReopenIntervalMs: 0,
    });
    first.forceOff({ reason: "degrade" });
    const dbPath = first.dbPath;
    first.close();
    deleteDbFiles(dbPath);

    const recreated = new SqliteActivationControlPlane({ storeRoot: root });
    expect(recreated.isForcedOff()).toBe(true);
    recreated.close();
  });

  it("reads OFF when the only state row is deleted (fail-safe)", () => {
    let now = 0;
    const cp = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
      now: () => now,
    });
    now = 10;
    cp.attemptReopen({ confirmedByHuman: true, actorId: "op" }); // enable
    expect(cp.isForcedOff()).toBe(false);
    cp.close();

    const { DatabaseSync } = requireNodeSqlite();
    const raw = new DatabaseSync(cp.dbPath);
    raw.exec("DELETE FROM activation_control WHERE id = 1");
    raw.close();

    const reopened = new SqliteActivationControlPlane({ storeRoot: root });
    expect(reopened.isForcedOff()).toBe(true); // ensureRow re-inits missing row to OFF
    reopened.close();
  });

  it("treats an unreadable control plane as forced OFF", () => {
    const cp = new SqliteActivationControlPlane({ storeRoot: root });
    cp.close();
    expect(cp.isForcedOff()).toBe(true);
    expect(cp.snapshot().forcedOff).toBe(true);
  });
});

describe("SqliteActivationControlPlane — server-time only, no caller timestamp (P0-1)", () => {
  it("cannot bypass cooldown: the reopen API has no timestamp channel", () => {
    let now = 0;
    const cp = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 600_000,
      now: () => now,
    });
    // Fresh => forced off with degradedAtMs = 0. Server clock is at 1000.
    now = 1_000;
    const attempt = { confirmedByHuman: true, actorId: "op" };
    // There is no nowMs field; a forged future time cannot be supplied.
    expect((attempt as unknown as { nowMs?: number }).nowMs).toBeUndefined();
    // Within the 600s cooldown by the SERVER clock => refused.
    expect(cp.attemptReopen(attempt).reason).toBe("cooldown_active");
    // Advancing only the server clock past the cooldown allows it.
    now = 600_001;
    expect(cp.attemptReopen(attempt).reopened).toBe(true);
    cp.close();
  });
});

describe("SqliteActivationControlPlane — controlled reopen only (P1)", () => {
  it("requires human confirmation, actor, and elapsed (server) cooldown", () => {
    let now = 0;
    const cp = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 1_000,
      now: () => now,
    });
    now = 5_000;
    expect(cp.attemptReopen({ confirmedByHuman: false, actorId: "op" }).reason).toBe(
      "manual_confirm_required",
    );
    expect(cp.attemptReopen({ confirmedByHuman: true, actorId: "" }).reason).toBe("actor_required");
    now = 500; // within cooldown (degradedAtMs = 0)
    expect(cp.attemptReopen({ confirmedByHuman: true, actorId: "op" }).reason).toBe(
      "cooldown_active",
    );
    now = 5_000;
    const ok = cp.attemptReopen({ confirmedByHuman: true, actorId: "op-jane" });
    expect(ok.reopened).toBe(true);
    const snap = cp.snapshot();
    expect(snap.lastReopenActor).toBe("op-jane");
    expect(snap.lastReopenAtMs).toBe(5_000);
    cp.close();
  });

  it("enforces reminder RCA before reopen", () => {
    let now = 0;
    const cp = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
      now: () => now,
    });
    cp.forceOff({ reason: "reminder_over_upgrade", rcaPending: true });
    now = 10;
    expect(cp.attemptReopen({ confirmedByHuman: true, actorId: "op" }).reason).toBe(
      "reminder_rca_required",
    );
    expect(
      cp.attemptReopen({ confirmedByHuman: true, rcaResolved: true, actorId: "op" }).reopened,
    ).toBe(true);
    cp.close();
  });

  it("does not expose a public clear(): only attemptReopen can clear forced-off", () => {
    const cp = new SqliteActivationControlPlane({ storeRoot: root });
    expect((cp as unknown as { clear?: unknown }).clear).toBeUndefined();
    cp.close();
  });
});

describe("SqliteActivationControlPlane — versioned atomic CAS reopen (P0-2)", () => {
  it("reopen is a CAS on state_version; a stale observed version retries", () => {
    let now = 0;
    const cpA = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
      now: () => now,
    });
    const observed = cpA.snapshot().stateVersion; // e.g. 1 (fresh, forced off)

    // A concurrent actor bumps the version (a fresh degrade) on the same DB.
    const cpB = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
      now: () => now,
    });
    cpB.forceOff({ reason: "concurrent-degrade" }); // state_version -> observed + 1
    now = 10;

    // Reopen with the STALE observed version => CAS no-op => retry required.
    const stale = cpA.reopenIfVersion({ confirmedByHuman: true, actorId: "op" }, observed);
    expect(stale.reason).toBe("state_changed_retry_required");
    expect(cpB.isForcedOff()).toBe(true); // still forced off (no lost update)

    // Reopen with the CURRENT version succeeds (attemptReopen reads it fresh).
    const ok = cpA.attemptReopen({ confirmedByHuman: true, actorId: "op" });
    expect(ok.reopened).toBe(true);
    expect(cpB.isForcedOff()).toBe(false);
    cpA.close();
    cpB.close();
  });
});

describe("SqliteActivationControlPlane — durable across restart + shared (P0/P1)", () => {
  it("a reopen persists across reopening the same DB path", () => {
    let now = 100;
    const first = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
      now: () => now,
    });
    first.attemptReopen({ confirmedByHuman: true, actorId: "op-1" });
    expect(first.isForcedOff()).toBe(false);
    first.close();

    const restarted = new SqliteActivationControlPlane({ storeRoot: root });
    expect(restarted.isForcedOff()).toBe(false);
    expect(restarted.snapshot().lastReopenActor).toBe("op-1");
    restarted.close();
  });

  it("a force-off via one instance is observed by another instance on the same path", () => {
    let now = 1;
    const a = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
      now: () => now,
    });
    const b = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
      now: () => now,
    });
    a.attemptReopen({ confirmedByHuman: true, actorId: "op" }); // enable
    expect(b.isForcedOff()).toBe(false);
    a.forceOff({ reason: "degrade" });
    expect(b.isForcedOff()).toBe(true);
    a.close();
    b.close();
  });
});

describe("InMemoryActivationControlPlane — test double (mirrors semantics)", () => {
  it("is forced off when fresh and recovers only via attemptReopen", () => {
    let now = 0;
    const cp = new InMemoryActivationControlPlane({ minReopenIntervalMs: 0, now: () => now });
    expect(cp.isForcedOff()).toBe(true);
    now = 1;
    expect(cp.attemptReopen({ confirmedByHuman: true, actorId: "op" }).reopened).toBe(true);
    expect(cp.isForcedOff()).toBe(false);
  });

  it("mirrors the versioned CAS: stale observed version retries", () => {
    const cp = new InMemoryActivationControlPlane({ minReopenIntervalMs: 0, now: () => 5 });
    const observed = cp.snapshot().stateVersion;
    cp.forceOff({ reason: "bump" }); // version advances beyond observed
    expect(cp.reopenIfVersion({ confirmedByHuman: true, actorId: "op" }, observed).reason).toBe(
      "state_changed_retry_required",
    );
  });
});
