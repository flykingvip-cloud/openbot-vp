import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HealthReport } from "../memory/health-report.js";
import { runMemoryHealthCli, registerMemoryHealthCli } from "./memory-health-cli.js";

const okOpsReport: HealthReport = {
  schema: "memory-health-report/v2",
  reportKind: "ops",
  status: "ok",
  reasonCode: "probe.ok",
  callerScope: "platform",
  authorizedAgentIds: ["main"],
  runtime: { stateDir: "/state" },
  agents: [],
  groups: [],
  probeIntegrity: {
    preSnapshotHash: "a",
    postSnapshotHash: "a",
    mutationsDetected: false,
  },
  instanceSha: "x",
  probeModuleSha: "y",
  probeModuleVersion: "z",
  probeUtc: "t",
};

const deniedReport: HealthReport = {
  schema: "memory-health-report/v2",
  status: "denied",
  reasonCode: "scope.denied",
  reason: "No agents authorized for caller tenant",
  probeUtc: "t",
};

describe("memory health cli", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("does not import MemoryManager or getMemorySearchManager", () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL("./memory-health-cli.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("getMemorySearchManager");
    expect(source).not.toContain("memory/index.js");
    expect(source).not.toContain("memory/manager.js");
    expect(source).not.toContain("chokidar");
  });

  it("prints HealthReport JSON and does not call manager-backed RPC when injected", async () => {
    const runMemoryHealthRpc = vi.fn(async () => okOpsReport);
    const lines: string[] = [];
    const report = await runMemoryHealthCli(
      { json: true },
      {
        runMemoryHealthRpc,
        log: (line) => lines.push(line),
      },
    );
    expect(runMemoryHealthRpc).toHaveBeenCalledWith({
      mode: "platform",
      client: null,
      agentIds: undefined,
    });
    expect(report.status).toBe("ok");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      schema: "memory-health-report/v2",
      reportKind: "ops",
      status: "ok",
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("uses summary mode and agent filter", async () => {
    const summaryReport: HealthReport = {
      schema: "memory-health-report/v2",
      reportKind: "summary",
      status: "ok",
      reasonCode: "probe.ok",
      callerScope: "tenant",
      authorizedAgentIds: ["main"],
      agents: [],
      instanceSha: "x",
      probeModuleSha: "y",
      probeModuleVersion: "z",
      probeUtc: "t",
    };
    const runMemoryHealthRpc = vi.fn(async () => summaryReport);
    const lines: string[] = [];
    await runMemoryHealthCli(
      { json: true, summary: true, agent: "main" },
      { runMemoryHealthRpc, log: (line) => lines.push(line) },
    );
    expect(runMemoryHealthRpc).toHaveBeenCalledWith({
      mode: "summary",
      client: null,
      agentIds: ["main"],
    });
    expect(JSON.parse(lines[0] ?? "{}")).not.toHaveProperty("runtime");
  });

  it("prints archive-safe JSON with --redact", async () => {
    const leaky: HealthReport = {
      ...okOpsReport,
      runtime: { stateDir: "/root/.openbot", tenantsRoot: "/root/tenants" },
      agents: [
        {
          agentId: "main",
          storage: "ready",
          authority: "unknown",
          rootTopology: "unobserved",
          topologyEvidence: "unknown",
          destructiveOps: "maintenance-grant-required",
          search: "empty",
          documentState: "empty",
          searchableDocumentCount: 0,
          reasonCode: "search.empty",
          reason: "empty",
          backend: "unknown",
          workspaceRoot: "/root/.openbot/workspace-main",
          workspaceFingerprint: "fp",
          indexPath: "/root/.openbot/memory/main.sqlite",
          sqliteInstanceId: "id",
          sidecarFingerprintCount: 0,
          guardIndexStatus: "unknown",
          lastSyncAt: null,
          lastRebuildAt: null,
        },
      ],
    };
    const runMemoryHealthRpc = vi.fn(async () => leaky);
    const lines: string[] = [];
    const report = await runMemoryHealthCli(
      { redact: true },
      { runMemoryHealthRpc, log: (line) => lines.push(line) },
    );
    const parsed = JSON.parse(lines[0] ?? "{}") as HealthReport;
    expect(parsed).toEqual(report);
    expect(JSON.stringify(parsed)).not.toContain("/root");
    expect(parsed).toMatchObject({ runtime: { stateDir: "redacted" } });
    if (parsed.status === "ok" && parsed.reportKind === "ops") {
      expect(parsed.agents[0]).not.toHaveProperty("workspaceRoot");
      expect(parsed.agents[0]).not.toHaveProperty("indexPath");
    }
  });

  it("sets exit code 1 on scope.denied and omits agents from text output", async () => {
    const runMemoryHealthRpc = vi.fn(async () => deniedReport);
    const lines: string[] = [];
    await runMemoryHealthCli(
      { json: false },
      { runMemoryHealthRpc, log: (line) => lines.push(line) },
    );
    expect(process.exitCode).toBe(1);
    expect(lines[0]).toContain("scope.denied");
    expect(lines[0]).not.toContain("workspaceRoot");
    expect(lines[0]).not.toContain("/state");
  });

  it("registers health as a memory subcommand", () => {
    const program = new Command();
    program.name("test");
    const memory = program.command("memory");
    registerMemoryHealthCli(memory);
    const health = memory.commands.find((command) => command.name() === "health");
    expect(health).toBeDefined();
    expect(health?.description()).toContain("Read-only");
  });
});

describe("memory health cli source path", () => {
  it("lives next to memory-cli without sharing manager imports", () => {
    expect(path.basename(fileURLToPath(new URL("./memory-health-cli.ts", import.meta.url)))).toBe(
      "memory-health-cli.ts",
    );
  });
});
