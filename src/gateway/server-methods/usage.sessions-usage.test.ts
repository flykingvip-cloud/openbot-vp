import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnvAsync } from "../../test-utils/env.js";

vi.mock("../../config/config.js", () => {
  return {
    loadConfig: vi.fn(() => ({
      agents: {
        list: [{ id: "main" }, { id: "opus" }],
      },
      session: {},
    })),
  };
});

const buildSessionStorePathResolverMock = vi.hoisted(() => vi.fn());

vi.mock("../tenant-context.js", async () => {
  const actual =
    await vi.importActual<typeof import("../tenant-context.js")>("../tenant-context.js");
  return {
    ...actual,
    buildSessionStorePathResolver: buildSessionStorePathResolverMock,
  };
});

vi.mock("../../config/sessions/paths.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/sessions/paths.js")>(
    "../../config/sessions/paths.js",
  );
  return {
    ...actual,
    resolveSessionFilePath: vi.fn(actual.resolveSessionFilePath),
  };
});

const buildEmployeeSessionVisibilityContextMock = vi.hoisted(() => vi.fn());
const resolveEnterpriseTenantIdForClientMock = vi.hoisted(() => vi.fn());
const resolveEnterpriseTenantVisibleAgentIdsMock = vi.hoisted(() => vi.fn());

vi.mock("../employee-workbench-scope.js", async () => {
  const actual = await vi.importActual<typeof import("../employee-workbench-scope.js")>(
    "../employee-workbench-scope.js",
  );
  return {
    ...actual,
    buildEmployeeSessionVisibilityContext: buildEmployeeSessionVisibilityContextMock,
  };
});

vi.mock("../enterprise-tenant-roster-scope.js", () => ({
  resolveEnterpriseTenantIdForClient: (...args: unknown[]) =>
    resolveEnterpriseTenantIdForClientMock(...args),
  resolveEnterpriseTenantVisibleAgentIds: (...args: unknown[]) =>
    resolveEnterpriseTenantVisibleAgentIdsMock(...args),
  filterSpacesForEnterpriseTenantClient: vi.fn(),
  filterAgentsForEnterpriseTenantClient: vi.fn(),
  collectTenantVisibleSpaceIds: vi.fn(),
}));

vi.mock("../session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../session-utils.js")>("../session-utils.js");
  return {
    ...actual,
    loadCombinedSessionStoreForGateway: vi.fn(() => ({ storePath: "(multiple)", store: {} })),
  };
});

vi.mock("../../infra/session-cost-usage.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/session-cost-usage.js")>(
    "../../infra/session-cost-usage.js",
  );
  return {
    ...actual,
    discoverAllSessions: vi.fn(async (params?: { agentId?: string }) => {
      if (params?.agentId === "main") {
        return [
          {
            sessionId: "s-main",
            sessionFile: "/tmp/agents/main/sessions/s-main.jsonl",
            mtime: 100,
            firstUserMessage: "hello",
          },
        ];
      }
      if (params?.agentId === "opus") {
        return [
          {
            sessionId: "s-opus",
            sessionFile: "/tmp/agents/opus/sessions/s-opus.jsonl",
            mtime: 200,
            firstUserMessage: "hi",
          },
        ];
      }
      return [];
    }),
    loadSessionCostSummary: vi.fn(async () => ({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    })),
    loadSessionUsageTimeSeries: vi.fn(async () => ({
      sessionId: "s-opus",
      points: [],
    })),
    loadSessionLogs: vi.fn(async () => []),
  };
});

import { resolveSessionFilePath } from "../../config/sessions/paths.js";
import {
  discoverAllSessions,
  loadSessionCostSummary,
  loadSessionLogs,
  loadSessionUsageTimeSeries,
} from "../../infra/session-cost-usage.js";
import { loadCombinedSessionStoreForGateway } from "../session-utils.js";
import { usageHandlers } from "./usage.js";

async function runSessionsUsage(
  params: Record<string, unknown>,
  client: Record<string, unknown> | null = null,
) {
  const respond = vi.fn();
  await usageHandlers["sessions.usage"]({
    respond,
    params,
    client,
    context: { logGateway: { warn: vi.fn() } },
  } as unknown as Parameters<(typeof usageHandlers)["sessions.usage"]>[0]);
  return respond;
}

async function runSessionsUsageTimeseries(
  params: Record<string, unknown>,
  client: Record<string, unknown> | null = null,
) {
  const respond = vi.fn();
  await usageHandlers["sessions.usage.timeseries"]({
    respond,
    params,
    client,
    context: { logGateway: { warn: vi.fn() } },
  } as unknown as Parameters<(typeof usageHandlers)["sessions.usage.timeseries"]>[0]);
  return respond;
}

async function runSessionsUsageLogs(
  params: Record<string, unknown>,
  client: Record<string, unknown> | null = null,
) {
  const respond = vi.fn();
  await usageHandlers["sessions.usage.logs"]({
    respond,
    params,
    client,
    context: { logGateway: { warn: vi.fn() } },
  } as unknown as Parameters<(typeof usageHandlers)["sessions.usage.logs"]>[0]);
  return respond;
}

const BASE_USAGE_RANGE = {
  startDate: "2026-02-01",
  endDate: "2026-02-02",
  limit: 10,
} as const;

const PERSONAL_CLIENT = {
  sessionDomain: "employee",
  user: "employee@example.com",
};

const ENTERPRISE_CLIENT = {
  sessionDomain: "enterprise",
  user: "ceo@example.com",
};

function employeeVisibility(agentIds: string[]) {
  return {
    actor: {
      userId: "user-1",
      userEmail: "employee@example.com",
      tenantId: "tenant-1",
      seatAgentIds: agentIds,
      seatSpaceIds: [],
    },
    visibleAgentIds: new Set(agentIds),
    visibleSpaceIds: new Set<string>(),
    auditableGroupBotSessions: new Set<string>(),
    archivedGroupIds: new Set<string>(),
  };
}

const STORE_BACKED_SESSIONS: Record<string, Record<string, unknown>> = {
  "agent:main:employee:user-1": {
    sessionId: "s-main",
    updatedAt: 100,
    chatType: "direct",
  },
  "agent:opus:direct:user-opus": {
    sessionId: "s-opus",
    updatedAt: 200,
    chatType: "direct",
  },
};

function mockStoreBackedSessions() {
  // The employee branch loads one visible agent store per call; the gateway
  // branch loads a single combined store.
  vi.mocked(loadCombinedSessionStoreForGateway).mockImplementation((cfg) => {
    const agentId = cfg.agents?.list?.[0]?.id;
    if (!agentId || (cfg.agents?.list?.length ?? 0) !== 1) {
      return { storePath: "(multiple)", store: STORE_BACKED_SESSIONS as never };
    }
    const scoped = Object.fromEntries(
      Object.entries(STORE_BACKED_SESSIONS).filter(([key]) => key.startsWith(`agent:${agentId}:`)),
    );
    return { storePath: "(multiple)", store: scoped as never };
  });
}

/** Employee rows are driven by store entries, so transcripts must appear on disk. */
function mockEmployeeTranscriptsOnDisk(mtimeMs = Date.UTC(2026, 1, 1, 12)) {
  return vi.spyOn(fs, "statSync").mockReturnValue({
    isFile: () => true,
    mtimeMs,
  } as unknown as fs.Stats);
}

function expectSuccessfulSessionsUsage(
  respond: ReturnType<typeof vi.fn>,
): Array<{ key: string; agentId: string }> {
  expect(respond).toHaveBeenCalledTimes(1);
  expect(respond.mock.calls[0]?.[0]).toBe(true);
  const result = respond.mock.calls[0]?.[1] as {
    sessions: Array<{ key: string; agentId: string }>;
  };
  return result.sessions;
}

function successfulUsageResult(respond: ReturnType<typeof vi.fn>) {
  expect(respond).toHaveBeenCalledTimes(1);
  expect(respond.mock.calls[0]?.[0]).toBe(true);
  return respond.mock.calls[0]?.[1] as {
    scope?: string;
    aggregatesComplete?: boolean;
    totalSessions?: number;
    sessions: Array<{ key: string; agentId?: string }>;
    totals: { totalTokens: number };
  };
}

describe("sessions.usage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    buildSessionStorePathResolverMock.mockResolvedValue(
      (agentId: string) => `/tmp/agents/${agentId}/sessions/sessions.json`,
    );
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(null);
    resolveEnterpriseTenantIdForClientMock.mockReset();
    resolveEnterpriseTenantVisibleAgentIdsMock.mockReset();
    vi.mocked(loadCombinedSessionStoreForGateway).mockReturnValue({
      storePath: "(multiple)",
      store: {},
    });
  });

  it("discovers sessions across configured agents and keeps agentId in key", async () => {
    const respond = await runSessionsUsage(BASE_USAGE_RANGE);

    expect(vi.mocked(discoverAllSessions)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(discoverAllSessions).mock.calls[0]?.[0]?.agentId).toBe("main");
    expect(vi.mocked(discoverAllSessions).mock.calls[1]?.[0]?.agentId).toBe("opus");

    const sessions = expectSuccessfulSessionsUsage(respond);
    expect(sessions).toHaveLength(2);

    // Sorted by most recent first (mtime=200 -> opus first).
    expect(sessions[0].key).toBe("agent:opus:s-opus");
    expect(sessions[0].agentId).toBe("opus");
    expect(sessions[1].key).toBe("agent:main:s-main");
    expect(sessions[1].agentId).toBe("main");
  });

  it("scopes personal-workbench usage to attributable sessions on visible agents", async () => {
    mockStoreBackedSessions();
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const statSyncSpy = mockEmployeeTranscriptsOnDisk();

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, aggregateAll: true },
        PERSONAL_CLIENT,
      );
      const result = successfulUsageResult(respond);

      // Employee rows come from authorized store entries; no transcript directory scan.
      expect(vi.mocked(discoverAllSessions)).not.toHaveBeenCalled();
      expect(vi.mocked(loadCombinedSessionStoreForGateway)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(loadCombinedSessionStoreForGateway).mock.calls[0]?.[0]).toMatchObject({
        session: { store: "/tmp/agents/main/sessions/sessions.json" },
        agents: { list: [{ id: "main", default: true }] },
      });
      expect(result.scope).toBe("employee-visible");
      expect(result.aggregatesComplete).toBe(true);
      expect(result.totalSessions).toBe(1);
      expect(result.sessions.map((session) => session.key)).toEqual(["agent:main:employee:user-1"]);
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("excludes discovered-only transcripts from employee usage", async () => {
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));

    const respond = await runSessionsUsage(
      { ...BASE_USAGE_RANGE, aggregateAll: true },
      PERSONAL_CLIENT,
    );
    const result = successfulUsageResult(respond);

    expect(vi.mocked(discoverAllSessions)).not.toHaveBeenCalled();
    expect(result.scope).toBe("employee-visible");
    expect(result.sessions).toEqual([]);
    expect(result.totalSessions).toBe(0);
    expect(result.aggregatesComplete).toBe(true);
    expect(vi.mocked(loadSessionCostSummary)).not.toHaveBeenCalled();
  });

  it("fails closed when a visible employee session store cannot be read", async () => {
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const readFileSpy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, aggregateAll: true },
        PERSONAL_CLIENT,
      );

      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: "UNAVAILABLE", retryable: true }),
      );
      expect(vi.mocked(loadCombinedSessionStoreForGateway)).not.toHaveBeenCalled();
      expect(vi.mocked(loadSessionCostSummary)).not.toHaveBeenCalled();
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("fails closed when an authorized employee transcript cannot be read", async () => {
    mockStoreBackedSessions();
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const statSyncSpy = vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, aggregateAll: true },
        PERSONAL_CLIENT,
      );

      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: "UNAVAILABLE", retryable: true }),
      );
      expect(vi.mocked(loadSessionCostSummary)).not.toHaveBeenCalled();
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("fails closed when a personal-workbench visibility context cannot be resolved", async () => {
    const respond = await runSessionsUsage(BASE_USAGE_RANGE, PERSONAL_CLIENT);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNAVAILABLE", retryable: true }),
    );
    expect(vi.mocked(discoverAllSessions)).not.toHaveBeenCalled();
    expect(vi.mocked(loadCombinedSessionStoreForGateway)).not.toHaveBeenCalled();
  });

  it("aggregates every scoped session while limiting returned detail rows", async () => {
    mockStoreBackedSessions();
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      employeeVisibility(["main", "opus"]),
    );
    vi.mocked(loadSessionCostSummary)
      .mockResolvedValueOnce({
        input: 20,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        missingCostEntries: 0,
      })
      .mockResolvedValueOnce({
        input: 10,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 10,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        missingCostEntries: 0,
      });
    const statSyncSpy = mockEmployeeTranscriptsOnDisk();

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, limit: 1, aggregateAll: true },
        PERSONAL_CLIENT,
      );
      const result = successfulUsageResult(respond);

      expect(result.sessions).toHaveLength(1);
      expect(result.totalSessions).toBe(2);
      expect(result.totals.totalTokens).toBe(30);
      expect(result.aggregatesComplete).toBe(true);
      expect(vi.mocked(loadSessionCostSummary)).toHaveBeenCalledTimes(2);
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("marks aggregates incomplete when any scoped transcript summary is unavailable", async () => {
    mockStoreBackedSessions();
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      employeeVisibility(["main", "opus"]),
    );
    vi.mocked(loadSessionCostSummary)
      .mockResolvedValueOnce({
        input: 20,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        missingCostEntries: 0,
      })
      .mockResolvedValueOnce(null);
    const statSyncSpy = mockEmployeeTranscriptsOnDisk();

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, limit: 1, aggregateAll: true },
        PERSONAL_CLIENT,
      );
      const result = successfulUsageResult(respond);

      expect(result.totalSessions).toBe(2);
      expect(result.totals.totalTokens).toBe(20);
      expect(result.aggregatesComplete).toBe(false);
      expect(vi.mocked(loadSessionCostSummary)).toHaveBeenCalledTimes(2);
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("preserves limited aggregation for gateway callers unless aggregateAll is requested", async () => {
    mockStoreBackedSessions();
    vi.mocked(loadSessionCostSummary).mockResolvedValueOnce({
      input: 20,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 20,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    });

    const respond = await runSessionsUsage({ ...BASE_USAGE_RANGE, limit: 1 });
    const result = successfulUsageResult(respond);

    expect(result.scope).toBe("gateway");
    expect(result.sessions).toHaveLength(1);
    expect(result.totalSessions).toBe(2);
    expect(result.totals.totalTokens).toBe(20);
    expect(result.aggregatesComplete).toBe(false);
    expect(vi.mocked(loadSessionCostSummary)).toHaveBeenCalledTimes(1);
  });

  it("hides a foreign specific key before store, path, or stat I/O", async () => {
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const statSyncSpy = vi.spyOn(fs, "statSync");

    try {
      const respond = await runSessionsUsage(
        {
          ...BASE_USAGE_RANGE,
          key: "agent:opus:direct:user-opus",
          aggregateAll: true,
        },
        PERSONAL_CLIENT,
      );
      const result = successfulUsageResult(respond);

      expect(result.scope).toBe("employee-visible");
      expect(result.sessions).toEqual([]);
      expect(result.totalSessions).toBe(0);
      expect(buildSessionStorePathResolverMock).not.toHaveBeenCalled();
      expect(vi.mocked(loadCombinedSessionStoreForGateway)).not.toHaveBeenCalled();
      expect(vi.mocked(resolveSessionFilePath)).not.toHaveBeenCalled();
      expect(statSyncSpy).not.toHaveBeenCalled();
      expect(vi.mocked(loadSessionCostSummary)).not.toHaveBeenCalled();
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("resolves store entries by sessionId when queried via discovered agent-prefixed key", async () => {
    const storeKey = "agent:opus:slack:dm:u123";
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-usage-test-"));

    try {
      await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
        const agentSessionsDir = path.join(stateDir, "agents", "opus", "sessions");
        fs.mkdirSync(agentSessionsDir, { recursive: true });
        const sessionFile = path.join(agentSessionsDir, "s-opus.jsonl");
        fs.writeFileSync(sessionFile, "", "utf-8");

        // Swap the store mock for this test: the canonical key differs from the discovered key
        // but points at the same sessionId.
        vi.mocked(loadCombinedSessionStoreForGateway).mockReturnValue({
          storePath: "(multiple)",
          store: {
            [storeKey]: {
              sessionId: "s-opus",
              sessionFile: "s-opus.jsonl",
              label: "Named session",
              updatedAt: 999,
            },
          },
        });

        // Query via discovered key: agent:<id>:<sessionId>
        const respond = await runSessionsUsage({ ...BASE_USAGE_RANGE, key: "agent:opus:s-opus" });
        const sessions = expectSuccessfulSessionsUsage(respond);
        expect(sessions).toHaveLength(1);
        expect(sessions[0]?.key).toBe(storeKey);
        expect(vi.mocked(loadSessionCostSummary)).toHaveBeenCalled();
        expect(
          vi.mocked(loadSessionCostSummary).mock.calls.some((call) => call[0]?.agentId === "opus"),
        ).toBe(true);
      });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("rejects traversal-style keys in specific session usage lookups", async () => {
    const respond = await runSessionsUsage({
      ...BASE_USAGE_RANGE,
      key: "agent:opus:../../etc/passwd",
    });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    const error = respond.mock.calls[0]?.[2] as { message?: string } | undefined;
    expect(error?.message).toContain("Invalid session reference");
  });

  it("passes parsed agentId into sessions.usage.timeseries", async () => {
    await runSessionsUsageTimeseries({
      key: "agent:opus:s-opus",
    });

    expect(vi.mocked(loadSessionUsageTimeSeries)).toHaveBeenCalled();
    expect(vi.mocked(loadSessionUsageTimeSeries).mock.calls[0]?.[0]?.agentId).toBe("opus");
  });

  it("passes parsed agentId into sessions.usage.logs", async () => {
    await runSessionsUsageLogs({
      key: "agent:opus:s-opus",
    });

    expect(vi.mocked(loadSessionLogs)).toHaveBeenCalled();
    expect(vi.mocked(loadSessionLogs).mock.calls[0]?.[0]?.agentId).toBe("opus");
  });

  it("rejects traversal-style keys in timeseries/log lookups", async () => {
    const timeseriesRespond = await runSessionsUsageTimeseries({
      key: "agent:opus:../../etc/passwd",
    });
    expect(timeseriesRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("Invalid session key"),
      }),
    );

    const logsRespond = await runSessionsUsageLogs({
      key: "agent:opus:../../etc/passwd",
    });
    expect(logsRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("Invalid session key"),
      }),
    );
  });

  it("fails closed on usage timeseries/logs when personal-workbench visibility is unresolved", async () => {
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(null);
    const timeseriesRespond = await runSessionsUsageTimeseries(
      { key: "agent:main:employee:user-1" },
      PERSONAL_CLIENT,
    );
    expect(timeseriesRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNAVAILABLE", retryable: true }),
    );
    expect(buildSessionStorePathResolverMock).not.toHaveBeenCalled();
    expect(vi.mocked(loadSessionUsageTimeSeries)).not.toHaveBeenCalled();

    const logsRespond = await runSessionsUsageLogs(
      { key: "agent:main:employee:user-1" },
      PERSONAL_CLIENT,
    );
    expect(logsRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNAVAILABLE", retryable: true }),
    );
    expect(vi.mocked(loadSessionLogs)).not.toHaveBeenCalled();
  });

  it("denies usage timeseries/logs for keys outside personal-workbench visibility", async () => {
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const timeseriesRespond = await runSessionsUsageTimeseries(
      { key: "agent:opus:s-opus" },
      PERSONAL_CLIENT,
    );
    expect(timeseriesRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("permission"),
      }),
    );
    expect(buildSessionStorePathResolverMock).not.toHaveBeenCalled();
    expect(vi.mocked(loadSessionUsageTimeSeries)).not.toHaveBeenCalled();

    const logsRespond = await runSessionsUsageLogs({ key: "agent:opus:s-opus" }, PERSONAL_CLIENT);
    expect(logsRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("permission"),
      }),
    );
    expect(vi.mocked(loadSessionLogs)).not.toHaveBeenCalled();
  });

  it("fails closed when a visible employee store is valid JSON but mis-shaped", async () => {
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    // Valid JSON that is not a session-key record (array). loadSessionStore would
    // silently treat this as an empty store and certify a confident zero.
    const readFileSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("[]" as never);

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, aggregateAll: true },
        PERSONAL_CLIENT,
      );

      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({ code: "UNAVAILABLE", retryable: true }),
      );
      expect(vi.mocked(loadSessionCostSummary)).not.toHaveBeenCalled();
    } finally {
      readFileSpy.mockRestore();
    }
  });

  it("pins a specific-key employee lookup to the tenant store root, not the global agent dir", async () => {
    mockStoreBackedSessions();
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const statSyncSpy = mockEmployeeTranscriptsOnDisk();

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, key: "agent:main:employee:user-1", aggregateAll: true },
        PERSONAL_CLIENT,
      );
      const result = successfulUsageResult(respond);
      expect(result.scope).toBe("employee-visible");
      expect(result.sessions.map((session) => session.key)).toEqual(["agent:main:employee:user-1"]);

      // The transcript path MUST be resolved against the per-agent tenant store
      // path (its dirname), never the global agent transcripts dir (which would
      // resolve with only `{ agentId }` and no sessionsDir).
      const calls = vi.mocked(resolveSessionFilePath).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const pathOpts = calls[calls.length - 1]?.[2] as { sessionsDir?: string } | undefined;
      expect(pathOpts?.sessionsDir).toBe("/tmp/agents/main/sessions");
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("marks aggregates incomplete when a scoped transcript summary reports parse errors", async () => {
    mockStoreBackedSessions();
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    vi.mocked(loadSessionCostSummary).mockResolvedValueOnce({
      input: 5,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 5,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
      parseErrors: 2,
    });
    const statSyncSpy = mockEmployeeTranscriptsOnDisk();

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, aggregateAll: true },
        PERSONAL_CLIENT,
      );
      const result = successfulUsageResult(respond);

      expect(result.totalSessions).toBe(1);
      expect(result.totals.totalTokens).toBe(5);
      // A partially unreadable transcript must never be certified complete.
      expect(result.aggregatesComplete).toBe(false);
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("keeps aggregates complete when a missing transcript belongs to a row outside the window", async () => {
    // Pruned/rotated history: the store row itself predates startMs, so its
    // absent transcript is out of scope and must not permanently mark the
    // employee scope incomplete.
    vi.mocked(loadCombinedSessionStoreForGateway).mockReturnValue({
      storePath: "(multiple)",
      store: {
        "agent:main:employee:user-1": {
          sessionId: "s-stale",
          // Well before BASE_USAGE_RANGE.startDate (2026-02-01).
          updatedAt: Date.UTC(2025, 0, 1),
          chatType: "direct",
        },
      } as never,
    });
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const statSyncSpy = vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, aggregateAll: true },
        PERSONAL_CLIENT,
      );
      const result = successfulUsageResult(respond);

      expect(result.totalSessions).toBe(0);
      expect(result.aggregatesComplete).toBe(true);
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("marks aggregates incomplete when an authorized employee transcript is missing (ENOENT)", async () => {
    // The store row claims activity inside the requested window, so a missing
    // transcript is a genuine integrity gap (not pruned out-of-window history).
    vi.mocked(loadCombinedSessionStoreForGateway).mockReturnValue({
      storePath: "(multiple)",
      store: {
        "agent:main:employee:user-1": {
          sessionId: "s-main",
          updatedAt: Date.UTC(2026, 1, 1, 12),
          chatType: "direct",
        },
      } as never,
    });
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const statSyncSpy = vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, aggregateAll: true },
        PERSONAL_CLIENT,
      );
      const result = successfulUsageResult(respond);

      // The authorized row is dropped (no transcript), but the scope must NOT be
      // certified as a confident, complete zero.
      expect(result.totalSessions).toBe(0);
      expect(result.aggregatesComplete).toBe(false);
      expect(vi.mocked(loadSessionCostSummary)).not.toHaveBeenCalled();
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("scopes enterprise-admin personal workbench usage as employee-visible by default", async () => {
    mockStoreBackedSessions();
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(employeeVisibility(["main"]));
    const statSyncSpy = mockEmployeeTranscriptsOnDisk();

    try {
      const respond = await runSessionsUsage(
        { ...BASE_USAGE_RANGE, aggregateAll: true, scope: "self" },
        ENTERPRISE_CLIENT,
      );
      const result = successfulUsageResult(respond);

      expect(resolveEnterpriseTenantIdForClientMock).not.toHaveBeenCalled();
      expect(buildEmployeeSessionVisibilityContextMock).toHaveBeenCalled();
      expect(result.scope).toBe("employee-visible");
      expect(result.totalSessions).toBe(1);
    } finally {
      statSyncSpy.mockRestore();
    }
  });

  it("keeps enterprise mesh tenant-wide usage when scope is tenant", async () => {
    resolveEnterpriseTenantIdForClientMock.mockResolvedValue("tenant-1");
    resolveEnterpriseTenantVisibleAgentIdsMock.mockResolvedValue(new Set(["main", "opus"]));

    const respond = await runSessionsUsage(
      { ...BASE_USAGE_RANGE, aggregateAll: true, scope: "tenant" },
      ENTERPRISE_CLIENT,
    );
    const result = successfulUsageResult(respond);

    expect(buildEmployeeSessionVisibilityContextMock).not.toHaveBeenCalled();
    expect(resolveEnterpriseTenantIdForClientMock).toHaveBeenCalled();
    expect(result.scope).toBe("enterprise-tenant");
  });
});
