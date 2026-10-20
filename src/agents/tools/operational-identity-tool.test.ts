/**
 * Task: conversation-identity-context-convergence
 *
 * Tool-layer contract: operational_identity consumes ExecutionIdentityContext,
 * forwards tenant/membership to the runtime client, and surfaces typed denials
 * instead of collapsing into NO_SEAT_CONTEXT / environment-variable copy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";

const listAccessMock = vi.hoisted(() => vi.fn());
const enforceAccessMock = vi.hoisted(() => vi.fn());
const executeActionMock = vi.hoisted(() => vi.fn());
const scopeDecisionMock = vi.hoisted(() => vi.fn());

vi.mock("../../gateway/enterprise-operational-identity-runtime.js", () => ({
  listOperationalIdentityRuntimeAccess: (...args: unknown[]) => listAccessMock(...args),
  enforceOperationalIdentityRuntimeAccess: (...args: unknown[]) => enforceAccessMock(...args),
  executeEnterpriseOperationalIdentityRuntimeAction: (...args: unknown[]) =>
    executeActionMock(...args),
  resolveOperationalIdentityRuntimeScopeDecision: (...args: unknown[]) =>
    scopeDecisionMock(...args),
}));

const { createOperationalIdentityTool } = await import("./operational-identity-tool.js");

const EMPLOYEE_TURN = createExecutionIdentityContext({
  user: "employee@acme.example",
  platformUserId: "emp-1",
  sessionDomain: "employee",
  enterpriseId: "001",
  membershipId: "mem-1",
  agentId: "main",
  sessionKey: "agent:main:employee:emp-1",
});

function parseResult(result: unknown): Record<string, unknown> {
  const text =
    typeof result === "object" && result && "content" in result
      ? String(
          (result as { content?: Array<{ type?: string; text?: string }> }).content?.find(
            (block) => block.type === "text",
          )?.text ?? "",
        )
      : JSON.stringify(result);
  return JSON.parse(text) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  listAccessMock.mockResolvedValue(null);
  scopeDecisionMock.mockResolvedValue({
    ok: false,
    code: "NO_CURRENT_SEAT",
    message: "该员工当前没有生效的企业席位，请联系企业管理员分配席位后再调用企业身份。",
  });
  enforceAccessMock.mockResolvedValue({
    ok: false,
    scope: null,
    result: { allowed: false, code: "IDENTITY_ACTION_DENIED", message: "denied" },
    message: "denied",
  });
});

describe("createOperationalIdentityTool identity contract", () => {
  it("forwards the canonical tenant and membership onto the runtime client", async () => {
    scopeDecisionMock.mockResolvedValue({
      ok: true,
      source: "employee",
      scope: { tenantId: "001", seatId: "seat-1", agentId: "main", employeeId: "emp-1" },
    });
    listAccessMock.mockResolvedValue({
      source: "employee",
      scope: { tenantId: "001", seatId: "seat-1", agentId: "main", employeeId: "emp-1" },
      entries: [],
    });
    const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
    await tool.execute("call-1", { action: "list" });
    const client =
      (listAccessMock.mock.calls.at(0)?.[0] as { client: GatewayClient | null } | undefined)
        ?.client ?? null;
    expect(client?.sessionEnterpriseId).toBe("001");
    expect(client?.sessionMembershipId).toBe("mem-1");
    expect(client?.user).toBe("employee@acme.example");
  });

  it("returns a typed no-seat denial instead of NO_SEAT_CONTEXT", async () => {
    const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
    const parsed = parseResult(await tool.execute("call-2", { action: "list" }));
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("NO_CURRENT_SEAT");
    expect(String(parsed.message)).not.toMatch(/environment variable/i);
    expect(JSON.stringify(parsed)).not.toMatch(/\bTENANT\b.*empty/i);
  });

  it("does not collapse a membership denial into NO_CURRENT_SEAT", async () => {
    scopeDecisionMock.mockResolvedValue({
      ok: false,
      code: "MEMBERSHIP_INVALID",
      message: "员工的企业成员关系无效（未找到、已停用或企业已冻结），企业身份调用已拒绝。",
    });
    const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
    const parsed = parseResult(await tool.execute("call-2b", { action: "list" }));
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("MEMBERSHIP_INVALID");
    expect(parsed.code).not.toBe("NO_CURRENT_SEAT");
  });

  it("does not invent NO_CURRENT_SEAT when scope succeeded but listing is empty", async () => {
    scopeDecisionMock.mockResolvedValue({
      ok: true,
      source: "employee",
      scope: { tenantId: "001", seatId: "seat-1", agentId: "main", employeeId: "emp-1" },
    });
    listAccessMock.mockResolvedValue(null);
    const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
    const parsed = parseResult(await tool.execute("call-2c", { action: "list" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.code).not.toBe("NO_CURRENT_SEAT");
    expect(parsed.entries).toEqual([]);
    expect(parsed.tenantId).toBe("001");
  });

  it("returns IDENTITY_ACTION_DENIED when policy rejects the action", async () => {
    enforceAccessMock.mockResolvedValue({
      ok: false,
      scope: { tenantId: "001", seatId: "seat-1", agentId: "main", employeeId: "emp-1" },
      result: {
        allowed: false,
        code: "IDENTITY_ACTION_DENIED",
        message: "该席位策略不允许此操作。",
      },
      message: "该席位策略不允许此操作。",
    });
    const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
    const parsed = parseResult(
      await tool.execute("call-3", {
        action: "resolve",
        identityId: "id-tm",
        operationalAction: "schedule_meeting",
      }),
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("IDENTITY_ACTION_DENIED");
    expect(parsed.seatId).toBe("seat-1");
  });

  it("does not leak tokens, secrets, or full personal identifiers in denials", async () => {
    const tool = createOperationalIdentityTool({
      executionIdentity: createExecutionIdentityContext({
        ...EMPLOYEE_TURN,
        user: "secret.employee@acme.example",
      }),
    });
    const parsed = parseResult(await tool.execute("call-4", { action: "list" }));
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("secret.employee@acme.example");
    expect(serialized).not.toMatch(/token|secret|credential/i);
    expect(parsed.identityPresence).toEqual(
      expect.objectContaining({
        user: true,
        tenant: true,
        membership: true,
      }),
    );
  });

  it("puts the resolved scope source on the execute receipt", async () => {
    executeActionMock.mockResolvedValue({
      ok: true,
      source: "employee",
      scope: { tenantId: "001", seatId: "seat-1", agentId: "main", employeeId: "emp-1" },
      policyId: "policy-1",
      execution: {
        ok: true,
        provider: "tencent-meeting",
        executionId: "exec-1",
        output: { executed: true },
      },
    });
    const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
    const parsed = parseResult(
      await tool.execute("call-5", {
        action: "execute",
        identityId: "id-tm",
        operationalAction: "schedule_meeting",
      }),
    );
    expect(parsed.executed).toBe(true);
    expect(parsed.source).toBe("employee");
    expect(listAccessMock).not.toHaveBeenCalled();
    expect(scopeDecisionMock).not.toHaveBeenCalled();
    expect(executeActionMock).toHaveBeenCalledTimes(1);
  });

  it.each(["collaboration-owner", "enrollment"] as const)(
    "execute success carries %s source from the same runtime result",
    async (source) => {
      executeActionMock.mockResolvedValue({
        ok: true,
        source,
        scope: { tenantId: "001", seatId: "seat-1", agentId: "main", employeeId: "emp-1" },
        policyId: "policy-1",
        execution: { ok: true, provider: "tencent-meeting", executionId: "exec-1", output: {} },
      });
      const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
      const parsed = parseResult(
        await tool.execute(`call-${source}`, {
          action: "execute",
          identityId: "id-tm",
          operationalAction: "schedule_meeting",
        }),
      );
      expect(parsed.source).toBe(source);
      expect(scopeDecisionMock).not.toHaveBeenCalled();
      expect(listAccessMock).not.toHaveBeenCalled();
    },
  );

  it("resolved execute failure carries source", async () => {
    executeActionMock.mockResolvedValue({
      ok: false,
      source: "employee",
      code: "IDENTITY_ACTION_DENIED",
      message: "denied",
      scope: { tenantId: "001", seatId: "seat-1", agentId: "main", employeeId: "emp-1" },
    });
    const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
    const parsed = parseResult(
      await tool.execute("call-denied", {
        action: "execute",
        identityId: "id-tm",
        operationalAction: "cancel_meeting",
      }),
    );
    expect(parsed.executed).toBe(false);
    expect(parsed.source).toBe("employee");
  });

  it("unresolved execute failure does not invent source", async () => {
    executeActionMock.mockResolvedValue({
      ok: false,
      code: "NO_CURRENT_SEAT",
      message: "no seat",
      scope: null,
    });
    const tool = createOperationalIdentityTool({ executionIdentity: EMPLOYEE_TURN });
    const parsed = parseResult(
      await tool.execute("call-unresolved", {
        action: "execute",
        identityId: "id-tm",
        operationalAction: "cancel_meeting",
      }),
    );
    expect(parsed.source).toBeUndefined();
    expect(parsed.code).toBe("NO_CURRENT_SEAT");
  });
});
