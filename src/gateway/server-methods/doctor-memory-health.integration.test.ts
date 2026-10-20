import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";

const loadConfig = vi.hoisted(() => vi.fn(() => ({}) as OpenBotConfig));
const listAgentsForGateway = vi.hoisted(() =>
  vi.fn(() => ({
    defaultId: "main",
    mainKey: "main",
    scope: "per-sender" as const,
    agents: [{ id: "main" }],
  })),
);
const resolveAgentConfig = vi.hoisted(() => vi.fn());
const resolveMemorySearchConfig = vi.hoisted(() =>
  vi.fn((): { store: { path: string } } | null => null),
);

vi.mock("../../config/config.js", () => ({ loadConfig }));
vi.mock("../session-utils.js", () => ({ listAgentsForGateway }));
vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentConfig,
  resolveDefaultAgentId: () => "main",
}));
vi.mock("../../agents/memory-search.js", () => ({ resolveMemorySearchConfig }));
vi.mock("../../config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/paths.js")>();
  return {
    ...actual,
    resolveStateDir: () => "/state",
  };
});
vi.mock("../../infra/git-commit.js", () => ({ resolveCommitHash: () => "test-commit" }));
vi.mock("../../memory/health-probe-build-info.js", () => ({
  resolveProbeModuleSha: () => "test-probe-sha",
}));

import {
  createWalBackedSqlite,
  fileContentSha256,
  listUserSqliteTables,
  readSqliteHeader,
  sqliteSidecarPaths,
} from "../../memory/health-probe.test-fixtures.js";
import { runMemoryHealthRpc } from "./doctor-memory-health.js";

/** Real probe chain — do not mock `runOpsHealthProbe` in this file. */

describe("doctor.memory.health RPC integration", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hp-rpc-int-"));
    loadConfig.mockReturnValue({
      agents: { list: [{ id: "main" }] },
    } as OpenBotConfig);
    listAgentsForGateway.mockReturnValue({
      defaultId: "main",
      mainKey: "main",
      scope: "per-sender",
      agents: [{ id: "main" }],
    });
  });

  afterEach(() => {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("runs real probe chain and preserves SQLite/WAL/SHM fingerprints", async () => {
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const indexPath = path.join(root, "memory", "main.sqlite");
    createWalBackedSqlite(indexPath);

    resolveAgentConfig.mockReturnValue({ workspace });
    resolveMemorySearchConfig.mockReturnValue({ store: { path: indexPath } });

    const walPath = `${indexPath}-wal`;
    const shmPath = `${indexPath}-shm`;
    const dbBefore = fs.statSync(indexPath);
    const headerBefore = readSqliteHeader(indexPath);
    const walBefore = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
    const shmBefore = fs.existsSync(shmPath)
      ? { stat: fs.statSync(shmPath), hash: fileContentSha256(shmPath) }
      : null;
    const tablesBefore = listUserSqliteTables(indexPath);
    const sidecarPaths = sqliteSidecarPaths(indexPath);

    try {
      const report = await runMemoryHealthRpc({
        mode: "platform",
        client: { sessionDomain: "platform" } as never,
        agentIds: ["main"],
      });

      expect(report.status).toBe("ok");
      if (report.status !== "ok" || report.reportKind !== "ops") {
        throw new Error("expected ops ok report");
      }
      expect(report.agents).toHaveLength(1);
      expect(report.agents[0]?.agentId).toBe("main");
      expect(report.agents[0]?.searchableDocumentCount).toBe(1);
      expect(report.probeIntegrity?.mutationsDetected).toBe(false);

      const dbAfter = fs.statSync(indexPath);
      expect(dbAfter.size).toBe(dbBefore.size);
      expect(dbAfter.mtimeMs).toBe(dbBefore.mtimeMs);
      expect(readSqliteHeader(indexPath)).toBe(headerBefore);
      expect(listUserSqliteTables(indexPath)).toEqual(tablesBefore);
      if (walBefore) {
        const walAfter = fs.statSync(walPath);
        expect(walAfter.size).toBe(walBefore.size);
        expect(walAfter.mtimeMs).toBe(walBefore.mtimeMs);
      }
      if (shmBefore) {
        const shmAfter = fs.statSync(shmPath);
        expect(shmAfter.size).toBe(shmBefore.stat.size);
        expect(fileContentSha256(shmPath)).toBe(shmBefore.hash);
      }
      for (const sidecarPath of sidecarPaths) {
        if (fs.existsSync(sidecarPath)) {
          expect(fs.existsSync(sidecarPath)).toBe(true);
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });
});
