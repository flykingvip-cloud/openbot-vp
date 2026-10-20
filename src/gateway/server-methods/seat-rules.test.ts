import { beforeEach, describe, expect, it, vi } from "vitest";
import { seatRulesHandlers } from "./seat-rules.js";

const readSeatRules = vi.fn();
const saveSeatRules = vi.fn();
const resolveEmployeeWorkbenchActor = vi.fn();
const resolveEnterpriseExecCeiling = vi.fn();

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: (...args: unknown[]) => resolveEmployeeWorkbenchActor(...args),
}));

vi.mock("../seat-rules/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../seat-rules/store.js")>();
  return {
    ...actual,
    readSeatRules: (...args: unknown[]) => readSeatRules(...args),
    saveSeatRules: (...args: unknown[]) => saveSeatRules(...args),
  };
});

vi.mock("../seat-rules/turn-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../seat-rules/turn-context.js")>();
  return {
    ...actual,
    resolveEnterpriseExecCeiling: (...args: unknown[]) => resolveEnterpriseExecCeiling(...args),
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    tools: { exec: { ask: "on-miss", security: "allowlist", host: "gateway" } },
  }),
}));

describe("seat-rules RPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveEnterpriseExecCeiling.mockReturnValue({
      ask: "on-miss",
      security: "allowlist",
      host: "gateway",
    });
    resolveEmployeeWorkbenchActor.mockResolvedValue({
      tenantId: "tenant-a",
      currentSeatId: "seat-1",
      userId: "emp-1",
      userEmail: "a@x.com",
      seatAgentIds: [],
      seatSpaceIds: [],
    });
    readSeatRules.mockResolvedValue({
      tenantId: "tenant-a",
      seatId: "seat-1",
      rules: [],
      execPreference: { ask: "always" },
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("returns ceiling-clamped preference and allowed options", async () => {
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.get-exec-preference"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: {},
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        tenantId: "tenant-a",
        seatId: "seat-1",
        allowed: {
          ask: ["on-miss", "always"],
          security: ["deny", "allowlist"],
        },
        effective: { ask: "always", security: "allowlist" },
      }),
    );
  });

  it("rejects ask looser than the ceiling", async () => {
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.set-exec-preference"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: { ask: "off" },
    } as never);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("ask cannot be looser") }),
    );
    expect(saveSeatRules).not.toHaveBeenCalled();
  });

  it("saves tightened ask within the ceiling", async () => {
    saveSeatRules.mockResolvedValue({
      tenantId: "tenant-a",
      seatId: "seat-1",
      rules: [],
      execPreference: { ask: "always", security: "deny" },
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.set-exec-preference"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: { ask: "always", security: "deny" },
    } as never);
    expect(saveSeatRules).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        seatId: "seat-1",
        execPreference: { ask: "always", security: "deny" },
      }),
      expect.anything(),
    );
    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ seatId: "seat-1" }));
  });

  it("rejects host writes", async () => {
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.set-exec-preference"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: { ask: "always", host: "node" },
    } as never);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("host") }),
    );
  });
  it("returns empty rules with limits when none saved", async () => {
    readSeatRules.mockResolvedValue(null);
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.get"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: {},
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        tenantId: "tenant-a",
        seatId: "seat-1",
        rules: [],
        limits: { maxChars: 500, maxTotalChars: 2000, maxCount: 8 },
      }),
    );
  });

  it("saves AI rules while preserving execPreference", async () => {
    readSeatRules.mockResolvedValue({
      tenantId: "tenant-a",
      seatId: "seat-1",
      rules: [],
      execPreference: { ask: "always", security: "deny" },
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    saveSeatRules.mockResolvedValue({
      tenantId: "tenant-a",
      seatId: "seat-1",
      rules: [{ id: "r1", text: "Prefer concise status updates." }],
      execPreference: { ask: "always", security: "deny" },
      updatedAt: "2026-10-08T00:00:00.000Z",
    });
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.set"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: { rules: [{ id: "r1", text: "Prefer concise status updates." }] },
    } as never);
    expect(saveSeatRules).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        seatId: "seat-1",
        rules: [{ id: "r1", text: "Prefer concise status updates." }],
        execPreference: { ask: "always", security: "deny" },
      }),
      expect.anything(),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        rules: [{ id: "r1", text: "Prefer concise status updates." }],
      }),
    );
  });

  it("rejects non-array rules payload", async () => {
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.set"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: { rules: "nope" },
    } as never);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("rules array") }),
    );
    expect(saveSeatRules).not.toHaveBeenCalled();
  });

  it("surfaces store rejections without writing", async () => {
    const { SeatRulesRejectedError } = await import("../seat-rules/store.js");
    saveSeatRules.mockRejectedValue(
      new SeatRulesRejectedError([{ reason: "seat_rule_max_chars_500" }]),
    );
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.set"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: { rules: [{ text: "x".repeat(501) }] },
    } as never);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("seat_rule_max_chars_500"),
        details: { rejections: [{ reason: "seat_rule_max_chars_500" }] },
      }),
    );
  });

  it("drill returns decide-only result and never saves", async () => {
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.drill"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: { command: "echo seat-drill" },
    } as never);
    expect(saveSeatRules).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        tenantId: "tenant-a",
        seatId: "seat-1",
        command: "echo seat-drill",
        preAuthorization: false,
        persisted: false,
        effective: expect.objectContaining({ ask: "always" }),
      }),
    );
    const payload = respond.mock.calls[0]?.[1] as {
      outcome: string;
      wouldRequireApprovalIfExecuted: boolean;
    };
    expect(["allow", "deny", "tighten"]).toContain(payload.outcome);
    expect(typeof payload.wouldRequireApprovalIfExecuted).toBe("boolean");
  });

  it("drill rejects applyAsPreAuthorization", async () => {
    const respond = vi.fn();
    await seatRulesHandlers["seat-rules.drill"]({
      respond,
      client: { sessionDomain: "employee", user: "a@x.com" },
      params: { applyAsPreAuthorization: true },
    } as never);
    expect(saveSeatRules).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("seat_drill_cannot_preauthorize"),
      }),
    );
  });
});
