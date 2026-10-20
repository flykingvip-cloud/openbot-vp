import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryHealthProbe, probeAgentReadOnly } from "./health-probe.factory.js";
import {
  createEmptyValidSqlite,
  createWalBackedSqlite,
  fileContentSha256,
  fingerprintPaths,
  listUserSqliteTables,
  readSqliteHeader,
  sqliteSidecarPaths,
} from "./health-probe.test-fixtures.js";
import { createProbeInvalidReport, createScopeDeniedReport } from "./health-report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("health-probe import guard (source)", () => {
  it("does not import manager search stack or chokidar", () => {
    const source = fs.readFileSync(path.join(__dirname, "health-probe.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'].*\/manager\.js["']/);
    expect(source).not.toMatch(/getMemorySearchManager/);
    expect(source).not.toMatch(/from\s+["'][^"']*chokidar/);
    expect(source).not.toMatch(/from\s+["'][^"']*memory-schema/);
  });
});

describe("health-report scope denied envelope", () => {
  it("uses minimal envelope without paths or agents", () => {
    const report = createScopeDeniedReport("forbidden", "2026-08-18T00:00:00.000Z");
    expect(report).toEqual({
      schema: "memory-health-report/v2",
      status: "denied",
      reasonCode: "scope.denied",
      reason: "forbidden",
      probeUtc: "2026-08-18T00:00:00.000Z",
    });
    expect(Object.keys(report)).not.toContain("agents");
    expect(Object.keys(report)).not.toContain("runtime");
  });
});

describe("health-probe read-only fixtures", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function mkRoot(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  it("T-1: missing sqlite creates no files or directories", async () => {
    const root = mkRoot("hp-t1-");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "memory", "a.md"), "# note\n");
    const indexPath = path.join(root, "memory", "agent.sqlite");
    const probe = createMemoryHealthProbe();
    const before = fs.readdirSync(root, { recursive: true }).length;
    await probe.runIntegrityCheck([workspace, indexPath], () => {
      probe.probeAgent({
        agentId: "agent",
        workspaceRoot: workspace,
        indexPath,
      });
    });
    const after = fs.readdirSync(root, { recursive: true }).length;
    expect(fs.existsSync(indexPath)).toBe(false);
    expect(after).toBe(before);
  });

  it("T-2: real SQLite WAL/SHM unchanged after readonly probe", async () => {
    const root = mkRoot("hp-t2-");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const indexPath = path.join(root, "memory", "agent.sqlite");
    createWalBackedSqlite(indexPath);
    const walPath = `${indexPath}-wal`;
    const shmPath = `${indexPath}-shm`;
    const dbBefore = fs.statSync(indexPath);
    const headerBefore = readSqliteHeader(indexPath);
    const walBefore = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
    const shmBefore = fs.existsSync(shmPath)
      ? { stat: fs.statSync(shmPath), hash: fileContentSha256(shmPath) }
      : null;

    const probe = createMemoryHealthProbe();
    const result = probe.probeAgent({ agentId: "agent", workspaceRoot: workspace, indexPath });
    expect(result.agent.searchableDocumentCount).toBe(1);

    const dbAfter = fs.statSync(indexPath);
    expect(dbAfter.size).toBe(dbBefore.size);
    expect(dbAfter.mtimeMs).toBe(dbBefore.mtimeMs);
    expect(readSqliteHeader(indexPath)).toBe(headerBefore);
    if (walBefore) {
      const walAfter = fs.statSync(walPath);
      expect(walAfter.size).toBe(walBefore.size);
      expect(walAfter.mtimeMs).toBe(walBefore.mtimeMs);
    }
    if (shmBefore) {
      const shmAfter = fs.statSync(shmPath);
      expect(shmAfter.size).toBe(shmBefore.stat.size);
      expect(fileContentSha256(shmPath)).toBe(shmBefore.hash);
      // Node SQLite may refresh SHM mtime on readonly open; size + content hash are the invariant.
    }
  });

  it("T-3: valid empty SQLite gains no user tables, WAL/SHM, or schema", async () => {
    const root = mkRoot("hp-t3-");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const indexPath = path.join(root, "memory", "agent.sqlite");
    createEmptyValidSqlite(indexPath);
    const paths = sqliteSidecarPaths(indexPath);
    const tablesBefore = listUserSqliteTables(indexPath);
    const hashBefore = fingerprintPaths(paths);
    expect(tablesBefore).toEqual([]);
    expect(fs.existsSync(`${indexPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${indexPath}-shm`)).toBe(false);

    const probe = createMemoryHealthProbe();
    await probe.runIntegrityCheck(paths.concat([workspace]), () => {
      probeAgentReadOnly({ agentId: "agent", workspaceRoot: workspace, indexPath });
    });

    expect(listUserSqliteTables(indexPath)).toEqual([]);
    expect(fs.existsSync(`${indexPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${indexPath}-shm`)).toBe(false);
    expect(fingerprintPaths(paths)).toBe(hashBefore);
  });

  it("T-6: concurrent probes do not mutate snapshot targets", async () => {
    const root = mkRoot("hp-t6-");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "memory", "a.md"), "# note\n");
    const indexPath = path.join(root, "memory", "agent.sqlite");
    const probe = createMemoryHealthProbe();
    const paths = [workspace, indexPath, `${indexPath}-wal`, `${indexPath}-shm`];
    const before = probe.collectSnapshot(paths);
    await Promise.all([
      probe.runIntegrityCheck(paths, async () => {
        probe.probeAgent({ agentId: "a", workspaceRoot: workspace, indexPath });
      }),
      probe.runIntegrityCheck(paths, async () => {
        probe.probeAgent({ agentId: "b", workspaceRoot: workspace, indexPath });
      }),
    ]);
    const after = probe.collectSnapshot(paths);
    expect(after).toEqual(before);
  });

  it("T-7: integrity diff maps to probe.invalid envelope", async () => {
    const root = mkRoot("hp-t7-");
    const target = path.join(root, "touch.txt");
    fs.writeFileSync(target, "a");
    const probe = createMemoryHealthProbe();
    const diff = await probe.runIntegrityCheck([target], () => {
      fs.writeFileSync(target, "b");
    });
    const report = createProbeInvalidReport({
      meta: {
        schema: "memory-health-report/v2",
        instanceSha: "test",
        probeModuleSha: "test",
        probeModuleVersion: "0.0.0-test",
        probeUtc: "2026-08-18T08:00:00.000Z",
      },
      callerScope: "platform",
      reason: "Probe integrity check detected filesystem mutations",
      probeIntegrity: diff,
    });
    expect(report.status).toBe("invalid");
    expect(report.reasonCode).toBe("probe.invalid");
    expect(report).not.toHaveProperty("agents");
    expect(report).not.toHaveProperty("groups");
    expect(report).not.toHaveProperty("runtime");
    expect(report).not.toHaveProperty("authorizedAgentIds");
  });
});
