import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireSyncAuth,
  beginSearchSyncFlight,
  resetSearchSyncFlightsForTests,
  searchSyncFlightKey,
  validateAcquireSyncAuth,
} from "./acquire-sync-auth.js";
import {
  createV1OperationAuth,
  isV1OperationAuthExpired,
  normalizeRootFingerprint,
  normalizeSqliteInstanceId,
} from "./v1-root-guard.js";

describe("acquireSyncAuth", () => {
  const dirs: string[] = [];

  afterEach(() => {
    resetSearchSyncFlightsForTests();
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acquire-sync-auth-"));
    dirs.push(dir);
    return dir;
  }

  function ids(workspaceDir: string, sqlitePath: string) {
    return {
      agentId: "main",
      sqliteInstanceId: normalizeSqliteInstanceId(sqlitePath),
      workspaceFingerprint: normalizeRootFingerprint(workspaceDir),
    };
  }

  it("fails closed when sqlite is missing and does not create it", () => {
    const workspaceDir = tmpDir();
    const sqlitePath = path.join(workspaceDir, "missing.sqlite");
    const result = acquireSyncAuth(
      { op: "sync", reason: "search", ...ids(workspaceDir, sqlitePath) },
      {
        sqlitePath,
        workspaceDir,
        recordedFingerprints: [],
        sqliteExists: false,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("authority.unknown");
    }
    expect(fs.existsSync(sqlitePath)).toBe(false);
  });

  it("maps empty fingerprints to authority.unknown without env grant", () => {
    const workspaceDir = tmpDir();
    const sqlitePath = path.join(workspaceDir, "index.sqlite");
    fs.writeFileSync(sqlitePath, "");
    const result = acquireSyncAuth(
      { op: "sync", reason: "search", ...ids(workspaceDir, sqlitePath) },
      {
        sqlitePath,
        workspaceDir,
        recordedFingerprints: [],
        sqliteExists: true,
        unlock: { kind: "maintenance", token: "not-a-grant", secret: "too-short" },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("authority.unknown");
    }
  });

  it("rejects sqliteInstance mismatch", () => {
    const workspaceDir = tmpDir();
    const sqlitePath = path.join(workspaceDir, "index.sqlite");
    fs.writeFileSync(sqlitePath, "");
    const result = acquireSyncAuth(
      {
        op: "sync",
        reason: "search",
        agentId: "main",
        sqliteInstanceId: "not-the-instance",
        workspaceFingerprint: normalizeRootFingerprint(workspaceDir),
      },
      {
        sqlitePath,
        workspaceDir,
        recordedFingerprints: [normalizeRootFingerprint(workspaceDir)],
        sqliteExists: true,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("auth.mismatch");
    }
  });

  it("allows registered same-root search sync and stamps expiry", () => {
    const workspaceDir = tmpDir();
    const sqlitePath = path.join(workspaceDir, "index.sqlite");
    fs.writeFileSync(sqlitePath, "");
    const nowMs = Date.UTC(2026, 7, 19, 2, 0, 0);
    const result = acquireSyncAuth(
      { op: "sync", reason: "search", ...ids(workspaceDir, sqlitePath) },
      {
        sqlitePath,
        workspaceDir,
        recordedFingerprints: [normalizeRootFingerprint(workspaceDir)],
        sqliteExists: true,
        nowMs,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.op).toBe("sync");
      expect(result.holder).toBe("single-flight");
      expect(result.expiresAt).toBe(new Date(nowMs + 15_000).toISOString());
      expect(isV1OperationAuthExpired(result.auth, nowMs + 14_999)).toBe(false);
      expect(validateAcquireSyncAuth(result, nowMs + 15_000).ok).toBe(false);
      const expired = validateAcquireSyncAuth(result, nowMs + 15_000);
      if (!expired.ok) {
        expect(expired.reasonCode).toBe("auth.expired");
      }
    }
  });

  it("single-flights concurrent start so start runs once", async () => {
    const key = searchSyncFlightKey("main", "sqlite-1");
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = beginSearchSyncFlight(key, async () => {
      starts += 1;
      await gate;
    });
    const second = beginSearchSyncFlight(key, async () => {
      starts += 1;
    });
    expect(first.leader).toBe(true);
    expect(second.leader).toBe(false);
    expect(first.flight).toBe(second.flight);
    release();
    await first.flight;
    expect(starts).toBe(1);
  });

  it("expired auth fails isV1OperationAuthExpired", () => {
    const dir = tmpDir();
    const sqlitePath = path.join(dir, "index.sqlite");
    const auth = createV1OperationAuth("sync", sqlitePath, { expiresAtMs: 10 });
    expect(isV1OperationAuthExpired(auth, 10)).toBe(true);
    expect(isV1OperationAuthExpired(auth, 9)).toBe(false);
  });
});
