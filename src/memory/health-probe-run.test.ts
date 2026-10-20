import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runOpsHealthProbe } from "./health-probe-run.js";
import type { MemoryHealthProbe, MemoryHealthProbeResult } from "./health-probe.js";

describe("health-probe-run invalid envelope", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function meta() {
    return {
      schema: "memory-health-report/v2" as const,
      instanceSha: "test-instance",
      probeModuleSha: "test-module",
      probeModuleVersion: "0.0.0-test",
      probeUtc: "2026-08-18T08:00:00.000Z",
    };
  }

  it("T-7: maps integrity failure to probe.invalid without agents/runtime", async () => {
    const fakeProbe: MemoryHealthProbe = {
      probeAgent: vi.fn(),
      collectSnapshot: vi.fn(() => []),
      runIntegrityCheck: vi.fn(async () => ({
        preSnapshotHash: "before",
        postSnapshotHash: "after",
        mutationsDetected: true,
        changedPaths: ["/tmp/touched"],
      })),
    };
    const report = await runOpsHealthProbe(
      {
        meta: meta(),
        callerScope: "platform",
        authorizedAgentIds: ["agent"],
        runtime: { stateDir: "/state" },
        agents: [
          {
            agentId: "agent",
            workspaceRoot: "/ws",
            indexPath: "/state/memory/agent.sqlite",
          },
        ],
      },
      {
        createProbe: () => fakeProbe,
      },
    );
    expect(report.status).toBe("invalid");
    if (report.status !== "invalid") {
      return;
    }
    expect(report.reasonCode).toBe("probe.invalid");
    expect(report).not.toHaveProperty("agents");
    expect(report).not.toHaveProperty("groups");
    expect(report).not.toHaveProperty("runtime");
    expect(report).not.toHaveProperty("authorizedAgentIds");
    expect(report.probeIntegrity?.mutationsDetected).toBe(true);
    expect(fakeProbe.probeAgent).not.toHaveBeenCalled();
  });

  it("includes listAgentProbeWatchPaths in pre-integrity snapshot", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hp-run-watch-"));
    dirs.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "memory", "note.md"), "# note\n");
    const indexPath = path.join(root, "memory", "agent.sqlite");
    const capturedPaths: string[][] = [];
    const fakeProbe: MemoryHealthProbe = {
      probeAgent: vi.fn(
        (): MemoryHealthProbeResult => ({
          agent: {
            agentId: "agent",
            storage: "ready",
            authority: "unknown",
            rootTopology: "unobserved",
            topologyEvidence: "unknown",
            destructiveOps: "maintenance-grant-required",
            search: "empty",
            documentState: "empty",
            searchableDocumentCount: null,
            reasonCode: "search.empty",
            reason: "empty",
            backend: "unknown",
            workspaceRoot: workspace,
            workspaceFingerprint: "fp",
            indexPath,
            sqliteInstanceId: "",
            sidecarFingerprintCount: 0,
            guardIndexStatus: "unknown",
            lastSyncAt: null,
            lastRebuildAt: null,
          },
          snapshotPaths: [path.join(workspace, "memory", "note.md")],
        }),
      ),
      collectSnapshot: vi.fn(() => []),
      runIntegrityCheck: vi.fn(async (paths, fn) => {
        capturedPaths.push([...paths]);
        await fn();
        return {
          preSnapshotHash: "a",
          postSnapshotHash: "a",
          mutationsDetected: false,
        };
      }),
    };

    await runOpsHealthProbe(
      {
        meta: meta(),
        callerScope: "platform",
        authorizedAgentIds: ["agent"],
        runtime: { stateDir: "/state" },
        agents: [{ agentId: "agent", workspaceRoot: workspace, indexPath }],
      },
      { createProbe: () => fakeProbe },
    );

    expect(capturedPaths).toHaveLength(1);
    const watchSet = new Set(capturedPaths[0]);
    expect(watchSet.has(indexPath)).toBe(true);
    expect(watchSet.has(`${indexPath}-wal`)).toBe(true);
    expect(watchSet.has(path.join(workspace, "memory"))).toBe(true);
    expect(watchSet.has(path.join(workspace, "memory", "note.md"))).toBe(true);
  });

  it("detects markdown mutations because watch paths are collected before probe", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hp-run-md-"));
    dirs.push(root);
    const workspace = path.join(root, "workspace");
    const memoryDir = path.join(workspace, "memory");
    fs.mkdirSync(memoryDir, { recursive: true });
    const notePath = path.join(memoryDir, "note.md");
    fs.writeFileSync(notePath, "# before\n");
    const indexPath = path.join(root, "memory", "agent.sqlite");

    const report = await runOpsHealthProbe({
      meta: meta(),
      callerScope: "platform",
      authorizedAgentIds: ["agent"],
      runtime: { stateDir: root },
      agents: [{ agentId: "agent", workspaceRoot: workspace, indexPath }],
    });
    expect(report.status).toBe("ok");

    const { createMemoryHealthProbe, listAgentProbeWatchPaths } = await import("./health-probe.js");
    const probe = createMemoryHealthProbe();
    const watchPaths = listAgentProbeWatchPaths({
      agentId: "agent",
      workspaceRoot: workspace,
      indexPath,
    });
    expect(watchPaths).toContain(notePath);
    const diff = await probe.runIntegrityCheck(watchPaths, () => {
      fs.writeFileSync(notePath, "# after\n");
    });
    expect(diff.mutationsDetected).toBe(true);
    expect(diff.changedPaths).toContain(path.resolve(notePath));
  });
});
