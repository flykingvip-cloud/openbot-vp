// @vitest-environment node
// Feature: platform-agent-runtime-center, Task 22/23: Lifecycle controller + Projection hook
import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeGateway,
  UpdateLifecycleResponse,
} from "../../../capability/agent-runtime/index.ts";
import type { RuntimeAgent } from "../../../capability/runtime-canonical/index.ts";
import {
  createInitialLifecycleState,
  preflightTransition,
  requestTransition,
} from "../deployment-lifecycle.ts";

// Reference a mocked gateway method as a plain spy to avoid unbound-method lint.
function spy(gw: AgentRuntimeGateway, key: keyof AgentRuntimeGateway) {
  return (gw as unknown as Record<string, ReturnType<typeof vi.fn>>)[key as string];
}

function makeAgent(overrides: Partial<RuntimeAgent> = {}): RuntimeAgent {
  return {
    runtimeAgentId: "agent-1",
    name: "Agent One",
    runtimeVersion: "1.0.0",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-a"],
    boundCapabilityCount: 3,
    activeSessionCount: 5,
    resourceUsage: { cpuPercent: 10, memoryPercent: 20, tokenBudgetUsedPercent: 5 },
    deployedAt: 0,
    lastActiveAt: 0,
    ...overrides,
  };
}

describe("preflightTransition (pure)", () => {
  it("ok for legal transitions", () => {
    expect(preflightTransition("deployed", "draining")).toEqual({ ok: true });
    expect(preflightTransition("deprecated", "archived")).toEqual({ ok: true });
  });

  it("not-ok for illegal transitions", () => {
    const r = preflightTransition("archived", "deployed");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("终态");
    }
  });

  it("not-ok for self-loops", () => {
    const r = preflightTransition("deployed", "deployed");
    expect(r.ok).toBe(false);
  });
});

describe("requestTransition", () => {
  function makeGateway(response: Partial<UpdateLifecycleResponse> = {}): AgentRuntimeGateway {
    const defaultAgent = makeAgent({ lifecycle: "deprecated" });
    const defaultResponse: UpdateLifecycleResponse = {
      agent: defaultAgent,
      rejectionReason: null,
      impact: {
        affectedBindingCount: 3,
        activeSessionCount: 5,
        affectedTenantCount: 1,
        triggersDownstreamNotification: true,
      },
      ...response,
    };
    return {
      updateLifecycle: vi.fn(async () => defaultResponse),
    } as unknown as AgentRuntimeGateway;
  }

  it("rejects illegal transition without RPC", async () => {
    const s = createInitialLifecycleState();
    const gateway = makeGateway();
    s.gateway = gateway;
    s.agents = [makeAgent({ lifecycle: "archived" })];
    const r = await requestTransition(s, "agent-1", "deployed", "test");
    expect(r).toBeNull();
    expect(s.error).toContain("终态");
    expect(spy(gateway, "updateLifecycle")).not.toHaveBeenCalled();
  });

  it("commits legal transition and updates agent cache", async () => {
    const s = createInitialLifecycleState();
    s.gateway = makeGateway();
    s.agents = [makeAgent()];
    const r = await requestTransition(s, "agent-1", "deprecated", "审批通过");
    expect(r).not.toBeNull();
    expect(s.agents[0]?.lifecycle).toBe("deprecated");
    expect(s.error).toBeNull();
  });

  it("invokes onLifecycleProjected hook when downstream notification is required", async () => {
    const s = createInitialLifecycleState();
    s.gateway = makeGateway();
    s.agents = [makeAgent()];
    const hook = vi.fn();
    s.onLifecycleProjected = hook;
    await requestTransition(s, "agent-1", "deprecated", "");
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]?.[0]?.fromLifecycle).toBe("deployed");
    expect(hook.mock.calls[0]?.[0]?.toLifecycle).toBe("deprecated");
    expect(hook.mock.calls[0]?.[0]?.triggersDownstreamNotification).toBe(true);
  });

  it("does NOT invoke hook when triggersDownstreamNotification is false", async () => {
    const s = createInitialLifecycleState();
    s.gateway = makeGateway({
      agent: makeAgent({ lifecycle: "draining" }),
      impact: {
        affectedBindingCount: 0,
        activeSessionCount: 0,
        affectedTenantCount: 0,
        triggersDownstreamNotification: false,
      },
    });
    s.agents = [makeAgent()];
    const hook = vi.fn();
    s.onLifecycleProjected = hook;
    await requestTransition(s, "agent-1", "draining", "");
    expect(hook).not.toHaveBeenCalled();
  });

  it("surfaces rejectionReason from server", async () => {
    const s = createInitialLifecycleState();
    s.gateway = makeGateway({
      rejectionReason: "存在活跃会话，禁止归档",
    });
    s.agents = [makeAgent()];
    const r = await requestTransition(s, "agent-1", "deprecated", "");
    expect(r?.rejectionReason).toBe("存在活跃会话，禁止归档");
    expect(s.error).toBe("存在活跃会话，禁止归档");
  });

  it("ignores re-entrant calls while busy", async () => {
    const s = createInitialLifecycleState();
    let resolveFn: ((v: UpdateLifecycleResponse) => void) | null = null;
    const updateMock = vi.fn(
      () =>
        new Promise<UpdateLifecycleResponse>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const gateway = {
      updateLifecycle: updateMock,
    } as unknown as AgentRuntimeGateway;
    s.gateway = gateway;
    s.agents = [makeAgent()];
    const first = requestTransition(s, "agent-1", "deprecated", "");
    await requestTransition(s, "agent-1", "deprecated", "");
    expect(updateMock).toHaveBeenCalledTimes(1);
    if (resolveFn) {
      (resolveFn as (v: UpdateLifecycleResponse) => void)({
        agent: makeAgent({ lifecycle: "deprecated" }),
        rejectionReason: null,
        impact: {
          affectedBindingCount: 0,
          activeSessionCount: 0,
          affectedTenantCount: 0,
          triggersDownstreamNotification: false,
        },
      });
    }
    await first;
  });
});
