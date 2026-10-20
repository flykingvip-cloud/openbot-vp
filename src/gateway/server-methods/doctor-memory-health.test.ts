import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";

const loadConfig = vi.hoisted(() => vi.fn(() => ({}) as OpenBotConfig));
const listAgentsForGateway = vi.hoisted(() =>
  vi.fn(() => ({
    defaultId: "main",
    mainKey: "main",
    scope: "per-sender" as const,
    agents: [{ id: "main" }, { id: "tenant-agent" }],
  })),
);
const resolveTenantContext = vi.hoisted(() => vi.fn());
const resolveAgentTenant = vi.hoisted(() => vi.fn());
const resolveAgentConfig = vi.hoisted(() =>
  vi.fn((_cfg: OpenBotConfig, agentId: string) => ({ workspace: `/ws/${agentId}` })),
);
const resolveMemorySearchConfig = vi.hoisted(() => vi.fn(() => null));

vi.mock("../../config/config.js", () => ({ loadConfig }));
vi.mock("../session-utils.js", () => ({ listAgentsForGateway }));
vi.mock("../tenant-context.js", () => ({ resolveTenantContext }));
vi.mock("../agent-tenant.js", () => ({ resolveAgentTenant }));
vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentConfig,
  resolveDefaultAgentId: () => "main",
}));
vi.mock("../../agents/memory-search.js", () => ({ resolveMemorySearchConfig }));
vi.mock("../../config/paths.js", () => ({ resolveStateDir: () => "/state" }));

import { filterAgentsForMemoryHealth, runMemoryHealthRpc } from "./doctor-memory-health.js";

describe("doctor.memory.health scope filtering", () => {
  const runOpsHealthProbe = vi.fn();

  beforeEach(() => {
    loadConfig.mockClear();
    listAgentsForGateway.mockClear();
    resolveTenantContext.mockReset();
    resolveAgentTenant.mockReset();
    runOpsHealthProbe.mockReset();
    resolveAgentTenant.mockImplementation(async (agentId: string) =>
      agentId === "tenant-agent" ? "tenant-a" : null,
    );
  });

  it("returns scope.denied envelope when tenant A requests tenant B agent", async () => {
    resolveTenantContext.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "u1",
      domain: "enterprise",
    });
    const report = await runMemoryHealthRpc(
      {
        mode: "tenant",
        client: { sessionDomain: "enterprise" } as never,
        agentIds: ["main"],
      },
      { runOpsHealthProbe },
    );
    expect(report).toEqual({
      schema: "memory-health-report/v2",
      status: "denied",
      reasonCode: "scope.denied",
      reason: "No agents authorized for caller tenant",
      probeUtc: expect.any(String),
    });
    expect(report).not.toHaveProperty("agents");
    expect(report).not.toHaveProperty("runtime");
    expect(report).not.toHaveProperty("authorizedAgentIds");
    expect(runOpsHealthProbe).not.toHaveBeenCalled();
  });

  it("returns scope.denied when tenant context is missing for tenant mode", async () => {
    resolveTenantContext.mockResolvedValue(null);
    const report = await runMemoryHealthRpc(
      {
        mode: "tenant",
        client: { sessionDomain: "enterprise" } as never,
      },
      { runOpsHealthProbe },
    );
    expect(report).toEqual({
      schema: "memory-health-report/v2",
      status: "denied",
      reasonCode: "scope.denied",
      reason: "Tenant context required for memory health probe",
      probeUtc: expect.any(String),
    });
    expect(runOpsHealthProbe).not.toHaveBeenCalled();
  });

  it("filters agents to caller tenant for tenant mode", async () => {
    resolveTenantContext.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "u1",
      domain: "enterprise",
    });
    runOpsHealthProbe.mockResolvedValue({
      schema: "memory-health-report/v2",
      reportKind: "ops",
      status: "ok",
      reasonCode: "probe.ok",
      callerScope: "tenant",
      authorizedAgentIds: ["tenant-agent"],
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
    });

    const report = await runMemoryHealthRpc(
      {
        mode: "tenant",
        client: { sessionDomain: "enterprise" } as never,
      },
      { runOpsHealthProbe },
    );

    expect(report.status).toBe("ok");
    expect(runOpsHealthProbe).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizedAgentIds: ["tenant-agent"],
        callerScope: "tenant",
      }),
    );
  });

  it("includes all configured agents for platform mode", async () => {
    runOpsHealthProbe.mockResolvedValue({
      schema: "memory-health-report/v2",
      reportKind: "ops",
      status: "ok",
      reasonCode: "probe.ok",
      callerScope: "platform",
      authorizedAgentIds: ["main", "tenant-agent"],
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
    });

    await runMemoryHealthRpc(
      {
        mode: "platform",
        client: { sessionDomain: "platform" } as never,
      },
      { runOpsHealthProbe },
    );

    expect(runOpsHealthProbe).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizedAgentIds: ["main", "tenant-agent"],
        callerScope: "platform",
      }),
    );
  });

  it("returns summary report without runtime or index paths", async () => {
    resolveTenantContext.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "u1",
      domain: "enterprise",
    });
    runOpsHealthProbe.mockResolvedValue({
      schema: "memory-health-report/v2",
      reportKind: "ops",
      status: "ok",
      reasonCode: "probe.ok",
      callerScope: "tenant",
      authorizedAgentIds: ["tenant-agent"],
      runtime: { stateDir: "/state" },
      agents: [
        {
          agentId: "tenant-agent",
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
          workspaceRoot: "/secret/ws",
          workspaceFingerprint: "fp",
          indexPath: "/secret/index.sqlite",
          sqliteInstanceId: "id",
          sidecarFingerprintCount: 0,
          guardIndexStatus: "unknown",
          lastSyncAt: null,
          lastRebuildAt: null,
        },
      ],
      groups: [
        {
          groupId: "g1",
          memoryMdCount: 1,
          mirrorDivergence: "none",
          transcriptPath: "/secret/transcript",
          memoryDir: "/secret/memory",
        },
      ],
      probeIntegrity: {
        preSnapshotHash: "a",
        postSnapshotHash: "a",
        mutationsDetected: false,
      },
      instanceSha: "x",
      probeModuleSha: "y",
      probeModuleVersion: "z",
      probeUtc: "t",
    });

    const report = await runMemoryHealthRpc(
      {
        mode: "summary",
        client: { sessionDomain: "enterprise" } as never,
      },
      { runOpsHealthProbe },
    );

    expect(report.status).toBe("ok");
    if (report.status !== "ok" || report.reportKind !== "summary") {
      throw new Error("expected summary ok report");
    }
    expect(report).not.toHaveProperty("runtime");
    expect(report.agents[0]).not.toHaveProperty("workspaceRoot");
    expect(report.agents[0]).not.toHaveProperty("indexPath");
    expect(report.groups?.[0]).not.toHaveProperty("transcriptPath");
  });
});

describe("filterAgentsForMemoryHealth", () => {
  beforeEach(() => {
    resolveTenantContext.mockReset();
    resolveAgentTenant.mockReset();
    resolveAgentTenant.mockImplementation(async (agentId: string) =>
      agentId === "tenant-agent" ? "tenant-a" : null,
    );
  });

  it("rejects cross-tenant agent ids for tenant mode", async () => {
    resolveTenantContext.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "u1",
      domain: "enterprise",
    });
    const result = await filterAgentsForMemoryHealth({
      mode: "tenant",
      client: { sessionDomain: "enterprise" } as never,
      requestedAgentIds: ["main"],
    });
    expect(result).toEqual({
      allowed: false,
      reason: "No agents authorized for caller tenant",
    });
  });
});
