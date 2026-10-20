/**
 * Task: conversation-identity-context-convergence
 *
 * Propagation contract: an authenticated employee Daibai turn keeps tenant and
 * membership from chat.send through tool construction, queued follow-up copies,
 * and operational_identity runtime client construction.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import type { FollowupRun } from "./queue/types.js";

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

const userOiOptionsMock = vi.hoisted(() => vi.fn());

vi.mock("../../agents/tools/user-operational-identity-tool.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../agents/tools/user-operational-identity-tool.js")>();
  return {
    ...actual,
    createUserOperationalIdentityTool: (options: unknown) => {
      userOiOptionsMock(options);
      return actual.createUserOperationalIdentityTool(
        options as Parameters<typeof actual.createUserOperationalIdentityTool>[0],
      );
    },
  };
});

const { createOperationalIdentityTool } =
  await import("../../agents/tools/operational-identity-tool.js");
const { createOpenClawTools } = await import("../../agents/openclaw-tools.js");
const { resolveExecutionIdentityFromRunFields } =
  await import("../../gateway/execution-identity-context.js");

/** Trusted identity as frozen by chat.send for an authenticated employee webchat turn. */
const EMPLOYEE_TURN = {
  gatewayClientUser: "employee@acme.example",
  gatewayClientPlatformUserId: "emp-1",
  gatewayClientSessionDomain: "employee" as const,
  gatewayClientSessionEnterpriseId: "001",
  gatewayClientSessionMembershipId: "mem-1",
  agentSessionKey: "agent:main:employee:emp-1",
};

const EMPLOYEE_SCOPE = {
  tenantId: "001",
  seatId: "seat-1",
  agentId: "main",
  employeeId: "emp-1",
};

function capturedClient(): GatewayClient | null {
  const fromDecision = scopeDecisionMock.mock.calls.at(0)?.[0] as GatewayClient | null | undefined;
  if (fromDecision) {
    return fromDecision;
  }
  const call = listAccessMock.mock.calls.at(0)?.[0] as { client: GatewayClient | null } | undefined;
  return call?.client ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeDecisionMock.mockResolvedValue({
    ok: true,
    source: "employee",
    scope: EMPLOYEE_SCOPE,
  });
  listAccessMock.mockResolvedValue({
    source: "employee",
    scope: EMPLOYEE_SCOPE,
    entries: [],
  });
  enforceAccessMock.mockResolvedValue({ ok: false, scope: null, result: null, message: "denied" });
});

describe("operational_identity execution identity propagation", () => {
  it("forwards the authenticated employee tenant and membership to the runtime client", async () => {
    const tool = createOperationalIdentityTool(EMPLOYEE_TURN);
    await tool.execute("call-1", { action: "list" });

    const client = capturedClient();
    expect(client?.user).toBe("employee@acme.example");
    expect(client?.platformUserId).toBe("emp-1");
    expect(client?.sessionEnterpriseId).toBe("001");
    expect(client?.sessionMembershipId).toBe("mem-1");
  });

  it("does not claim a missing seat when the employee identity was never delivered", async () => {
    const tool = createOperationalIdentityTool(EMPLOYEE_TURN);
    const result = await tool.execute("call-2", { action: "list" });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/environment variable/i);
    expect(text).not.toMatch(/\bTENANT\b.*\bempty\b/i);
  });

  it("createOpenClawTools threads tenant and membership into the seat-bound tool", async () => {
    createOpenClawTools({
      agentSessionKey: EMPLOYEE_TURN.agentSessionKey,
      requesterAgentIdOverride: "main",
      gatewayClientUser: EMPLOYEE_TURN.gatewayClientUser,
      gatewayClientPlatformUserId: EMPLOYEE_TURN.gatewayClientPlatformUserId,
      gatewayClientSessionDomain: EMPLOYEE_TURN.gatewayClientSessionDomain,
      gatewayClientSessionEnterpriseId: EMPLOYEE_TURN.gatewayClientSessionEnterpriseId,
      gatewayClientSessionMembershipId: EMPLOYEE_TURN.gatewayClientSessionMembershipId,
    });
    const tool = createOperationalIdentityTool({
      agentSessionKey: EMPLOYEE_TURN.agentSessionKey,
      gatewayClientUser: EMPLOYEE_TURN.gatewayClientUser,
      gatewayClientPlatformUserId: EMPLOYEE_TURN.gatewayClientPlatformUserId,
      gatewayClientSessionDomain: EMPLOYEE_TURN.gatewayClientSessionDomain,
      gatewayClientSessionEnterpriseId: EMPLOYEE_TURN.gatewayClientSessionEnterpriseId,
      gatewayClientSessionMembershipId: EMPLOYEE_TURN.gatewayClientSessionMembershipId,
    });
    await tool.execute("call-3", { action: "list" });
    expect(capturedClient()?.sessionEnterpriseId).toBe("001");
  });

  it("queued follow-up copies keep the same tenant/membership/agent as the originating turn", async () => {
    const originating = createExecutionIdentityContext({
      user: EMPLOYEE_TURN.gatewayClientUser,
      platformUserId: EMPLOYEE_TURN.gatewayClientPlatformUserId,
      sessionDomain: EMPLOYEE_TURN.gatewayClientSessionDomain,
      enterpriseId: EMPLOYEE_TURN.gatewayClientSessionEnterpriseId,
      membershipId: EMPLOYEE_TURN.gatewayClientSessionMembershipId,
      agentId: "main",
      sessionKey: EMPLOYEE_TURN.agentSessionKey,
    });
    const queued: FollowupRun["run"] = {
      agentId: "main",
      agentDir: "/tmp/agent",
      sessionId: "sess-1",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp/workspace",
      config: {} as FollowupRun["run"]["config"],
      provider: "openai",
      model: "gpt-test",
      timeoutMs: 1,
      blockReplyBreak: "text_end",
      executionIdentity: originating,
      gatewayClientUser: originating.user,
      gatewayClientSessionDomain: originating.sessionDomain,
      gatewayClientPlatformUserId: originating.platformUserId,
    };
    const roundTripped = JSON.parse(JSON.stringify(queued.executionIdentity)) as typeof originating;
    const followupIdentity = resolveExecutionIdentityFromRunFields({
      executionIdentity: roundTripped,
      gatewayClientUser: queued.gatewayClientUser,
      gatewayClientSessionDomain: queued.gatewayClientSessionDomain,
      gatewayClientPlatformUserId: queued.gatewayClientPlatformUserId,
      agentId: queued.agentId,
    });
    const followupTool = createOperationalIdentityTool({
      executionIdentity: followupIdentity,
      requesterAgentIdOverride: queued.agentId,
    });
    const parsed = JSON.parse(
      String(
        (
          (await followupTool.execute("followup-1", { action: "list" })) as {
            content?: Array<{ type?: string; text?: string }>;
          }
        ).content?.find((block) => block.type === "text")?.text ?? "{}",
      ),
    ) as { tenantId?: string; seatId?: string; agentId?: string; employeeId?: string };
    expect(followupIdentity.enterpriseId).toBe(originating.enterpriseId);
    expect(followupIdentity.membershipId).toBe(originating.membershipId);
    expect(capturedClient()?.sessionEnterpriseId).toBe("001");
    expect(parsed.tenantId).toBe("001");
    expect(parsed.seatId).toBe("seat-1");
    expect(parsed.agentId).toBe("main");
    expect(parsed.employeeId).toBe("emp-1");
  });

  it("does not let a second employee reuse the first employee's tenant or membership", async () => {
    const toolA = createOperationalIdentityTool(EMPLOYEE_TURN);
    await toolA.execute("call-a", { action: "list" });
    expect(capturedClient()?.sessionEnterpriseId).toBe("001");
    expect(capturedClient()?.sessionMembershipId).toBe("mem-1");
    expect(capturedClient()?.platformUserId).toBe("emp-1");

    vi.clearAllMocks();
    scopeDecisionMock.mockResolvedValue({
      ok: true,
      source: "employee",
      scope: { tenantId: "002", seatId: "seat-2", agentId: "main", employeeId: "emp-2" },
    });
    listAccessMock.mockResolvedValue({
      source: "employee",
      scope: { tenantId: "002", seatId: "seat-2", agentId: "main", employeeId: "emp-2" },
      entries: [],
    });

    const toolB = createOperationalIdentityTool({
      gatewayClientUser: "other@acme.example",
      gatewayClientPlatformUserId: "emp-2",
      gatewayClientSessionDomain: "employee",
      gatewayClientSessionEnterpriseId: "002",
      gatewayClientSessionMembershipId: "mem-2",
      agentSessionKey: "agent:main:employee:emp-2",
    });
    await toolB.execute("call-b", { action: "list" });
    expect(capturedClient()?.user).toBe("other@acme.example");
    expect(capturedClient()?.platformUserId).toBe("emp-2");
    expect(capturedClient()?.sessionEnterpriseId).toBe("002");
    expect(capturedClient()?.sessionMembershipId).toBe("mem-2");
    expect(capturedClient()?.sessionEnterpriseId).not.toBe("001");
  });

  it("does not pass enterprise or membership identity into user operational identity", () => {
    createOpenClawTools({
      agentSessionKey: EMPLOYEE_TURN.agentSessionKey,
      requesterAgentIdOverride: "main",
      gatewayClientUser: EMPLOYEE_TURN.gatewayClientUser,
      gatewayClientPlatformUserId: EMPLOYEE_TURN.gatewayClientPlatformUserId,
      gatewayClientSessionDomain: EMPLOYEE_TURN.gatewayClientSessionDomain,
      gatewayClientSessionEnterpriseId: EMPLOYEE_TURN.gatewayClientSessionEnterpriseId,
      gatewayClientSessionMembershipId: EMPLOYEE_TURN.gatewayClientSessionMembershipId,
    });
    expect(userOiOptionsMock).toHaveBeenCalled();
    const options = userOiOptionsMock.mock.calls.at(0)?.[0] as Record<string, unknown>;
    expect(options.gatewayClientUser).toBe(EMPLOYEE_TURN.gatewayClientUser);
    expect(options.gatewayClientPlatformUserId).toBe(EMPLOYEE_TURN.gatewayClientPlatformUserId);
    expect(options.gatewayClientSessionDomain).toBe(EMPLOYEE_TURN.gatewayClientSessionDomain);
    expect(options).not.toHaveProperty("gatewayClientSessionEnterpriseId");
    expect(options).not.toHaveProperty("gatewayClientSessionMembershipId");
    expect(options).not.toHaveProperty("executionIdentity");
  });
});
