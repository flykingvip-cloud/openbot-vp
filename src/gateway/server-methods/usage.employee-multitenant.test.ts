/**
 * Multi-tenant / multi-account negative probe for employee usage.
 *
 * Unlike `usage.sessions-usage.test.ts` (which stubs the store and transcript
 * loaders), this suite writes REAL session stores and REAL `.jsonl` transcripts
 * to disk and drives `sessions.usage` through the real store loader, the real
 * `resolveSessionFilePath` tenant addressing, and the real
 * `loadSessionCostSummary` transcript parser.
 *
 * Only the two genuine trust boundaries are injected:
 *   - `buildSessionStorePathResolver` (tenant addressing, normally derived from
 *     the authenticated client's tenant/user context)
 *   - `buildEmployeeSessionVisibilityContext` (the authenticated actor + its
 *     visible agents/spaces)
 *
 * Everything the authorization fix relies on — path pinning, ACL evaluation,
 * completeness accounting, transcript parsing — runs for real against the files.
 *
 * Fixtures use a NON-steward agent (`agt-sales`). The builtin steward (`main`)
 * carries an extra guard of its own, so a non-steward agent is what actually
 * exercises the group-ACL path this fix hardens.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.hoisted(() => vi.fn());
vi.mock("../../config/config.js", () => ({ loadConfig: loadConfigMock }));

const buildSessionStorePathResolverMock = vi.hoisted(() => vi.fn());
vi.mock("../tenant-context.js", async () => {
  const actual =
    await vi.importActual<typeof import("../tenant-context.js")>("../tenant-context.js");
  return { ...actual, buildSessionStorePathResolver: buildSessionStorePathResolverMock };
});

const buildEmployeeSessionVisibilityContextMock = vi.hoisted(() => vi.fn());
vi.mock("../employee-workbench-scope.js", async () => {
  const actual = await vi.importActual<typeof import("../employee-workbench-scope.js")>(
    "../employee-workbench-scope.js",
  );
  return {
    ...actual,
    buildEmployeeSessionVisibilityContext: buildEmployeeSessionVisibilityContextMock,
  };
});

import { usageHandlers } from "./usage.js";

const PERSONAL_CLIENT = { sessionDomain: "employee", user: "alice@example.com" };
const RANGE = { startDate: "2026-02-01", endDate: "2026-02-28", limit: 50 } as const;
const OWN_AGENT = "agt-sales";
const FOREIGN_AGENT = "agt-foreign";

/** Timestamp inside the requested window. */
const IN_WINDOW = Date.UTC(2026, 1, 10, 12);

let root: string;

/** Write a transcript whose assistant turn reports an exact, identifiable token count. */
function writeTranscript(file: string, tokens: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = {
    type: "message",
    timestamp: new Date(IN_WINDOW).toISOString(),
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-5.2",
      usage: {
        input: tokens,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: tokens,
        cost: { total: 0 },
      },
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(entry)}\n`, "utf-8");
  fs.utimesSync(file, IN_WINDOW / 1000, IN_WINDOW / 1000);
}

function writeStore(storePath: string, rows: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(rows, null, 2), "utf-8");
}

/** Production-shaped tenant store path. */
function tenantStore(tenantId: string, userId: string, agentId: string) {
  return path.join(
    root,
    "tenants",
    tenantId,
    "users",
    userId,
    "state",
    "agents",
    agentId,
    "sessions",
    "sessions.json",
  );
}

/** Process-global (non-tenant) store path — the fallback that must never win. */
function globalStore(agentId: string) {
  return path.join(root, "agents", agentId, "sessions", "sessions.json");
}

function sessionsDirOf(storePath: string) {
  return path.dirname(storePath);
}

function visibility(params: {
  agentIds: string[];
  spaceIds?: string[];
  archivedGroupIds?: string[];
}) {
  return {
    actor: {
      userId: "user-alice",
      userEmail: "alice@example.com",
      tenantId: "tenant-a",
      seatAgentIds: params.agentIds,
      seatSpaceIds: params.spaceIds ?? [],
    },
    visibleAgentIds: new Set(params.agentIds),
    visibleSpaceIds: new Set(params.spaceIds ?? []),
    auditableGroupBotSessions: new Set<string>(),
    archivedGroupIds: new Set(params.archivedGroupIds ?? []),
  };
}

async function runUsage(params: Record<string, unknown>) {
  const respond = vi.fn();
  await usageHandlers["sessions.usage"]({
    respond,
    params,
    client: PERSONAL_CLIENT,
    context: { logGateway: { warn: vi.fn() } },
  } as unknown as Parameters<(typeof usageHandlers)["sessions.usage"]>[0]);
  return respond;
}

function okResult(respond: ReturnType<typeof vi.fn>) {
  expect(respond).toHaveBeenCalledTimes(1);
  expect(respond.mock.calls[0]?.[0]).toBe(true);
  return respond.mock.calls[0]?.[1] as {
    scope?: string;
    aggregatesComplete?: boolean;
    totalSessions?: number;
    sessions: Array<{ key: string; sessionId: string; usage?: { totalTokens: number } | null }>;
    totals: { totalTokens: number };
  };
}

describe("sessions.usage employee multi-tenant isolation (real files)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-mt-usage-"));
    // No `session.store` configured: the handler then relies purely on the
    // injected tenant resolver (mirrors shared-tenant addressing in production).
    loadConfigMock.mockReturnValue({
      agents: { list: [{ id: OWN_AGENT }, { id: FOREIGN_AGENT }] },
      session: {},
    });
    // Tenant A / Alice is the authenticated context.
    buildSessionStorePathResolverMock.mockResolvedValue((agentId: string) =>
      tenantStore("tenant-a", "user-alice", agentId),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads the tenant transcript, not the global-root file with the same sessionId", async () => {
    const sessionId = "collision-sid";
    const key = `agent:${OWN_AGENT}:direct:thread-1`;
    // Same sessionId in BOTH roots with different token counts. Production has 47
    // such cross-root sessionIds, so picking the wrong root is a real misread.
    const tenantPath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    writeStore(tenantPath, { [key]: { sessionId, updatedAt: IN_WINDOW, chatType: "direct" } });
    writeTranscript(path.join(sessionsDirOf(tenantPath), `${sessionId}.jsonl`), 111);

    const globalPath = globalStore(OWN_AGENT);
    writeStore(globalPath, { [key]: { sessionId, updatedAt: IN_WINDOW, chatType: "direct" } });
    writeTranscript(path.join(sessionsDirOf(globalPath), `${sessionId}.jsonl`), 999);

    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT] }),
    );

    // List view must read the tenant root.
    const listResult = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(listResult.scope).toBe("employee-visible");
    expect(listResult.totals.totalTokens).toBe(111);

    // Specific-key view must pin to the SAME tenant root (the fixed branch);
    // before the fix this fell back to the global root and returned 999.
    const keyResult = okResult(await runUsage({ ...RANGE, key, aggregateAll: true }));
    expect(keyResult.totals.totalTokens).toBe(111);
    expect(keyResult.sessions[0]?.usage?.totalTokens).toBe(111);
  });

  it("never exposes another tenant's or another user's agent sessions", async () => {
    const ownKey = `agent:${OWN_AGENT}:direct:thread-1`;
    const ownPath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    writeStore(ownPath, {
      [ownKey]: { sessionId: "alice-sid", updatedAt: IN_WINDOW, chatType: "direct" },
    });
    writeTranscript(path.join(sessionsDirOf(ownPath), "alice-sid.jsonl"), 10);

    // Another tenant + another user, with real data on disk.
    const foreignKey = `agent:${FOREIGN_AGENT}:direct:thread-9`;
    const foreignPath = tenantStore("tenant-b", "user-bob", FOREIGN_AGENT);
    writeStore(foreignPath, {
      [foreignKey]: { sessionId: "bob-sid", updatedAt: IN_WINDOW, chatType: "direct" },
    });
    writeTranscript(path.join(sessionsDirOf(foreignPath), "bob-sid.jsonl"), 777);

    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT] }),
    );

    const result = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(result.totals.totalTokens).toBe(10);
    expect(result.sessions.map((s) => s.sessionId)).toEqual(["alice-sid"]);

    // Explicitly addressing the foreign agent yields nothing.
    const foreign = okResult(await runUsage({ ...RANGE, key: foreignKey, aggregateAll: true }));
    expect(foreign.sessions).toEqual([]);
    expect(foreign.totalSessions).toBe(0);
    expect(foreign.totals.totalTokens).toBe(0);
  });

  it("hides a groupId-only row from a non-member but shows it to a member", async () => {
    // Blocking case: groupId set, chatType/kind absent, key does not prove group.
    const key = `agent:${OWN_AGENT}:opaque-row`;
    const storePath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    writeStore(storePath, {
      [key]: { sessionId: "group-sid", updatedAt: IN_WINDOW, groupId: "foreign-group" },
    });
    writeTranscript(path.join(sessionsDirOf(storePath), "group-sid.jsonl"), 500);

    // Non-member: hidden even though the agent itself is visible.
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT] }),
    );
    const hidden = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(hidden.sessions).toEqual([]);
    expect(hidden.totals.totalTokens).toBe(0);

    // Member of that space: visible.
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT], spaceIds: ["foreign-group"] }),
    );
    const shown = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(shown.sessions.map((s) => s.sessionId)).toEqual(["group-sid"]);
    expect(shown.totals.totalTokens).toBe(500);
  });

  it("hides sessions belonging to an archived space", async () => {
    const key = `agent:${OWN_AGENT}:space:team-x`;
    const storePath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    writeStore(storePath, {
      [key]: {
        sessionId: "archived-sid",
        updatedAt: IN_WINDOW,
        chatType: "group",
        groupId: "team-x",
      },
    });
    writeTranscript(path.join(sessionsDirOf(storePath), "archived-sid.jsonl"), 42);

    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT], spaceIds: ["team-x"], archivedGroupIds: ["team-x"] }),
    );

    const result = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(result.sessions).toEqual([]);
    expect(result.totals.totalTokens).toBe(0);
  });

  it("reports incomplete for a real malformed transcript but still returns recovered tokens", async () => {
    const key = `agent:${OWN_AGENT}:direct:thread-corrupt`;
    const storePath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    writeStore(storePath, {
      [key]: { sessionId: "corrupt-sid", updatedAt: IN_WINDOW, chatType: "direct" },
    });
    const file = path.join(sessionsDirOf(storePath), "corrupt-sid.jsonl");
    const good = {
      type: "message",
      timestamp: new Date(IN_WINDOW).toISOString(),
      message: {
        role: "assistant",
        provider: "openai",
        model: "gpt-5.2",
        usage: { input: 7, output: 0, totalTokens: 7, cost: { total: 0 } },
      },
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(good)}\n{ broken json\n42\n`, "utf-8");
    fs.utimesSync(file, IN_WINDOW / 1000, IN_WINDOW / 1000);

    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT] }),
    );

    const result = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(result.totals.totalTokens).toBe(7);
    // Partially unreadable transcript must never be certified complete.
    expect(result.aggregatesComplete).toBe(false);
  });

  it("marks incomplete when an in-window row's transcript is genuinely absent", async () => {
    const storePath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    writeStore(storePath, {
      [`agent:${OWN_AGENT}:direct:present`]: {
        sessionId: "present-sid",
        updatedAt: IN_WINDOW,
        chatType: "direct",
      },
      [`agent:${OWN_AGENT}:direct:absent`]: {
        sessionId: "absent-sid",
        updatedAt: IN_WINDOW,
        chatType: "direct",
      },
    });
    writeTranscript(path.join(sessionsDirOf(storePath), "present-sid.jsonl"), 5);
    // absent-sid.jsonl intentionally not written.

    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT] }),
    );

    const result = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(result.totals.totalTokens).toBe(5);
    expect(result.aggregatesComplete).toBe(false);
  });

  it("stays complete when an absent transcript belongs to an out-of-window row", async () => {
    // Mirrors production: 42/240 store rows have no transcript on disk, many of
    // them long out of window. Pruned history must not permanently degrade the panel.
    const storePath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    writeStore(storePath, {
      [`agent:${OWN_AGENT}:direct:present`]: {
        sessionId: "present-sid",
        updatedAt: IN_WINDOW,
        chatType: "direct",
      },
      [`agent:${OWN_AGENT}:direct:pruned`]: {
        sessionId: "pruned-sid",
        updatedAt: Date.UTC(2025, 0, 1),
        chatType: "direct",
      },
    });
    writeTranscript(path.join(sessionsDirOf(storePath), "present-sid.jsonl"), 5);

    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT] }),
    );

    const result = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(result.totals.totalTokens).toBe(5);
    expect(result.totalSessions).toBe(1);
    expect(result.aggregatesComplete).toBe(true);
  });

  it("fails closed when a real employee store is valid JSON but mis-shaped", async () => {
    const storePath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "[]", "utf-8");

    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT] }),
    );

    const respond = await runUsage({ ...RANGE, aggregateAll: true });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "UNAVAILABLE", retryable: true }),
    );
  });

  it("certifies a fully readable tenant scope as complete", async () => {
    const storePath = tenantStore("tenant-a", "user-alice", OWN_AGENT);
    writeStore(storePath, {
      [`agent:${OWN_AGENT}:direct:t1`]: {
        sessionId: "s1",
        updatedAt: IN_WINDOW,
        chatType: "direct",
      },
      [`agent:${OWN_AGENT}:direct:t2`]: {
        sessionId: "s2",
        updatedAt: IN_WINDOW,
        chatType: "direct",
      },
    });
    writeTranscript(path.join(sessionsDirOf(storePath), "s1.jsonl"), 3);
    writeTranscript(path.join(sessionsDirOf(storePath), "s2.jsonl"), 4);

    buildEmployeeSessionVisibilityContextMock.mockResolvedValue(
      visibility({ agentIds: [OWN_AGENT] }),
    );

    const result = okResult(await runUsage({ ...RANGE, aggregateAll: true }));
    expect(result.totalSessions).toBe(2);
    expect(result.totals.totalTokens).toBe(7);
    expect(result.aggregatesComplete).toBe(true);
  });
});
