import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listTenantAgentSessionsDirs } from "../gateway/tenant-store-paths.js";
import {
  assembleMonthlySeatUsageResult,
  buildSeatMonthlyUsageRows,
  buildUserMonthlyUsageRows,
  collectUniqueSeatAgentIds,
  loadUsageByAgentIds,
} from "./monthly-seat-usage.js";

describe("monthly-seat-usage", () => {
  it("collects unique seat agent ids including defaultAgentId", () => {
    expect(
      collectUniqueSeatAgentIds({
        agentIds: ["Sales", "sales", "Support"],
        defaultAgentId: "Ops",
      }),
    ).toEqual(["Sales", "Support", "Ops"]);
  });

  it("aggregates per-seat usage and reports unmatched agents", () => {
    const usageByAgent = new Map([
      [
        "sales",
        {
          totalTokens: 100,
          totalCost: 2,
          sessionCount: 3,
          lastActiveAt: 10,
        },
      ],
    ]);
    const built = buildSeatMonthlyUsageRows({
      seats: [
        {
          seatId: "seat-a",
          agentIds: ["Sales", "Ghost"],
          defaultAgentId: "Sales",
        },
      ],
      usageByAgent,
      discoverableAgentIds: new Set(["sales"]),
    });
    expect(built.seats[0]?.totalTokens).toBe(100);
    expect(built.seats[0]?.totalCost).toBe(2);
    expect(built.seats[0]?.unmatchedAgentIds).toEqual(["Ghost"]);
    expect(built.unmatchedAgentIds).toEqual(["Ghost"]);
  });

  it("assembles tenant-scoped result without mixing other seats", () => {
    const result = assembleMonthlySeatUsageResult({
      tenantId: "tenant-a",
      startDate: "2026-07-01",
      endDate: "2026-07-20",
      seats: [
        { seatId: "seat-a", agentIds: ["a1"], defaultAgentId: "a1" },
        { seatId: "seat-b", agentIds: ["b1"], defaultAgentId: "b1" },
      ],
      usageByAgent: new Map([
        ["a1", { totalTokens: 1, totalCost: 0.1, sessionCount: 1, lastActiveAt: 1 }],
        ["b1", { totalTokens: 2, totalCost: 0.2, sessionCount: 1, lastActiveAt: 2 }],
      ]),
      discoverableAgentIds: new Set(["a1", "b1"]),
      agents: [
        {
          agentId: "a1",
          totalTokens: 1,
          totalCost: 0.1,
          sessionCount: 1,
          lastActiveAt: 1,
        },
        {
          agentId: "b1",
          totalTokens: 2,
          totalCost: 0.2,
          sessionCount: 1,
          lastActiveAt: 2,
        },
      ],
    });
    expect(result.tenantId).toBe("tenant-a");
    expect(result.seats.map((seat) => seat.seatId)).toEqual(["seat-a", "seat-b"]);
    expect(result.seats[0]?.totalCost).toBe(0.1);
    expect(result.seats[1]?.totalCost).toBe(0.2);
    expect(result.users).toEqual([]);
  });

  it("rolls seat usage into users[] by bound member and merges same employee", () => {
    const seats = [
      {
        seatId: "seat-a",
        agentIds: ["a1"],
        defaultAgentId: "a1",
        memberUserId: "Alice@Example.com",
      },
      {
        seatId: "seat-b",
        agentIds: ["b1"],
        defaultAgentId: "b1",
        memberUserId: "alice@example.com",
      },
      {
        seatId: "seat-vacant",
        agentIds: ["c1"],
        defaultAgentId: "c1",
        memberUserId: null,
      },
    ];
    const seatRows = buildSeatMonthlyUsageRows({
      seats,
      usageByAgent: new Map([
        ["a1", { totalTokens: 10, totalCost: 1, sessionCount: 2, lastActiveAt: 5 }],
        ["b1", { totalTokens: 20, totalCost: 2, sessionCount: 3, lastActiveAt: 9 }],
        ["c1", { totalTokens: 99, totalCost: 9, sessionCount: 1, lastActiveAt: 1 }],
      ]),
      discoverableAgentIds: new Set(["a1", "b1", "c1"]),
    }).seats;

    const users = buildUserMonthlyUsageRows({ seats, seatRows });
    expect(users).toHaveLength(1);
    expect(users[0]?.userId.toLowerCase()).toBe("alice@example.com");
    expect(users[0]?.totalTokens).toBe(30);
    expect(users[0]?.sessionCount).toBe(5);
    expect(users[0]?.lastActiveAt).toBe(9);

    const assembled = assembleMonthlySeatUsageResult({
      tenantId: "tenant-a",
      startDate: "2026-07-01",
      endDate: "2026-07-20",
      seats,
      usageByAgent: new Map([
        ["a1", { totalTokens: 10, totalCost: 1, sessionCount: 2, lastActiveAt: 5 }],
        ["b1", { totalTokens: 20, totalCost: 2, sessionCount: 3, lastActiveAt: 9 }],
        ["c1", { totalTokens: 99, totalCost: 9, sessionCount: 1, lastActiveAt: 1 }],
      ]),
      discoverableAgentIds: new Set(["a1", "b1", "c1"]),
      agents: [],
    });
    expect(assembled.users).toHaveLength(1);
    expect(assembled.users[0]?.totalTokens).toBe(30);
  });
});

describe("monthly-seat-usage tenant session isolation", () => {
  let tenantsRoot = "";
  let prevTenantsRoot: string | undefined;

  beforeEach(async () => {
    tenantsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "org-monthly-tenants-"));
    prevTenantsRoot = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  });

  afterEach(async () => {
    if (prevTenantsRoot === undefined) {
      delete process.env.OPENBOT_TENANTS_ROOT;
    } else {
      process.env.OPENBOT_TENANTS_ROOT = prevTenantsRoot;
    }
    await fs.rm(tenantsRoot, { recursive: true, force: true });
  });

  async function writeSession(params: {
    tenantId: string;
    userId: string;
    agentId: string;
    sessionId: string;
    cost: number;
    tokens: number;
  }) {
    const sessionsDir = path.join(
      tenantsRoot,
      params.tenantId,
      "users",
      params.userId,
      "state",
      "agents",
      params.agentId,
      "sessions",
    );
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, `${params.sessionId}.jsonl`),
      `${JSON.stringify({
        type: "message",
        timestamp: new Date("2026-07-15T12:00:00.000Z").toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-5.2",
          usage: {
            input: 1,
            output: 1,
            totalTokens: params.tokens,
            cost: { total: params.cost },
          },
        },
      })}\n`,
      "utf-8",
    );
  }

  it("lists only the target tenant agent sessions dirs", async () => {
    await writeSession({
      tenantId: "tenant-a",
      userId: "u1",
      agentId: "main",
      sessionId: "sess-a",
      cost: 1,
      tokens: 10,
    });
    await writeSession({
      tenantId: "tenant-b",
      userId: "u1",
      agentId: "main",
      sessionId: "sess-b",
      cost: 9,
      tokens: 90,
    });
    const dirs = await listTenantAgentSessionsDirs({ tenantId: "tenant-a", agentId: "main" });
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toContain(`${path.sep}tenant-a${path.sep}`);
    expect(dirs[0]).not.toContain(`${path.sep}tenant-b${path.sep}`);
  });

  it("does not mix same-named agent usage across tenants when resolveSessionsDirs is set", async () => {
    await writeSession({
      tenantId: "tenant-a",
      userId: "u1",
      agentId: "main",
      sessionId: "sess-a",
      cost: 1.25,
      tokens: 30,
    });
    await writeSession({
      tenantId: "tenant-b",
      userId: "u9",
      agentId: "main",
      sessionId: "sess-b",
      cost: 99,
      tokens: 900,
    });

    const loaded = await loadUsageByAgentIds({
      agentIds: ["main"],
      startMs: Date.parse("2026-07-01T00:00:00.000Z"),
      endMs: Date.parse("2026-07-31T23:59:59.999Z"),
      resolveSessionsDirs: (agentId) =>
        listTenantAgentSessionsDirs({ tenantId: "tenant-a", agentId }),
    });

    expect(loaded.usageByAgent.get("main")?.totalCost).toBeCloseTo(1.25, 5);
    expect(loaded.usageByAgent.get("main")?.totalTokens).toBe(30);
    expect(loaded.usageByAgent.get("main")?.sessionCount).toBe(1);
  });
});
