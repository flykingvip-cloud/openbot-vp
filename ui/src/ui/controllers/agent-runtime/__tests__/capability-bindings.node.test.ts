// @vitest-environment node
// Feature: platform-agent-runtime-center, Task 16/17: Binding mutations + detail
import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeGateway,
  GetBindingResponse,
  UpdateBindingPriorityResponse,
  UpdateBindingStateResponse,
  UpdateBindingStrategyResponse,
} from "../../../capability/agent-runtime/index.ts";

// Reference a mocked gateway method as a plain spy to avoid unbound-method lint.
function spy(gw: AgentRuntimeGateway, key: keyof AgentRuntimeGateway) {
  return (gw as unknown as Record<string, ReturnType<typeof vi.fn>>)[key as string];
}
import type { RuntimeCapabilityBinding } from "../../../capability/runtime-canonical/index.ts";
import {
  changeBindingPriority,
  changeBindingState,
  changeBindingStrategy,
  createInitialBindingsState,
  loadBindings,
  resetBindingsFilters,
  selectBindingDetail,
  updateBindingsFilter,
} from "../capability-bindings.ts";

function makeBinding(overrides: Partial<RuntimeCapabilityBinding> = {}): RuntimeCapabilityBinding {
  return {
    bindingId: "b-1",
    runtimeAgentId: "agent-1",
    capabilityId: "cap-1",
    capabilityVersion: "1.0.0",
    bindingType: "tenant-installed",
    routingPriority: 50,
    loadStrategy: "lazy",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d: 100,
      successRate7d: 1,
      avgLatencyMs: 100,
      p95LatencyMs: 200,
      errorCount7d: 0,
      tokenConsumption7d: 0,
    },
    policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    fallbackBindingId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeGatewayMock(initial: RuntimeCapabilityBinding): {
  gateway: AgentRuntimeGateway;
  current: { value: RuntimeCapabilityBinding };
} {
  const current = { value: initial };
  const gateway = {
    listBindings: vi.fn(async () => ({ bindings: [current.value] })),
    getBinding: vi.fn(
      async (): Promise<GetBindingResponse> => ({
        binding: current.value,
        agentName: "Agent One",
        capabilityName: "Cap One",
      }),
    ),
    updateBindingState: vi.fn(
      async ({ bindingId, bindingState }): Promise<UpdateBindingStateResponse> => {
        const next = { ...current.value, bindingState, bindingId };
        current.value = next;
        return { binding: next };
      },
    ),
    updateBindingPriority: vi.fn(
      async ({ bindingId, routingPriority }): Promise<UpdateBindingPriorityResponse> => {
        const next = { ...current.value, routingPriority, bindingId };
        current.value = next;
        return { binding: next };
      },
    ),
    updateBindingStrategy: vi.fn(
      async ({ bindingId, loadStrategy }): Promise<UpdateBindingStrategyResponse> => {
        const next = { ...current.value, loadStrategy, bindingId };
        current.value = next;
        return { binding: next };
      },
    ),
  } as unknown as AgentRuntimeGateway;
  return { gateway, current };
}

describe("CapabilityBindingsState — initial state", () => {
  it("createInitialBindingsState returns clean defaults", () => {
    const s = createInitialBindingsState();
    expect(s.gateway).toBeNull();
    expect(s.bindings).toEqual([]);
    expect(s.filters.runtimeAgentId).toBeNull();
    expect(s.busyBindingId).toBeNull();
    expect(s.auditLog).toEqual([]);
  });
});

describe("loadBindings", () => {
  it("populates bindings from gateway", async () => {
    const initial = makeBinding();
    const { gateway } = makeGatewayMock(initial);
    const s = createInitialBindingsState();
    s.gateway = gateway;
    await loadBindings(s);
    expect(s.bindings).toEqual([initial]);
    expect(s.error).toBeNull();
  });

  it("preserves bindings on error", async () => {
    const s = createInitialBindingsState();
    s.gateway = {
      listBindings: vi.fn(async () => {
        throw new Error("network");
      }),
    } as unknown as AgentRuntimeGateway;
    s.bindings = [makeBinding()];
    await loadBindings(s);
    expect(s.bindings.length).toBe(1);
    expect(s.error).toContain("network");
  });
});

describe("filter mutations", () => {
  it("updateBindingsFilter modifies the keyed slot only", () => {
    const s = createInitialBindingsState();
    updateBindingsFilter(s, "bindingState", "disabled");
    expect(s.filters.bindingState).toBe("disabled");
    expect(s.filters.bindingType).toBeNull();
  });

  it("resetBindingsFilters returns to initial", () => {
    const s = createInitialBindingsState();
    updateBindingsFilter(s, "health", "unhealthy");
    resetBindingsFilters(s);
    expect(s.filters.health).toBeNull();
  });
});

describe("changeBindingState", () => {
  it("updates binding cache and appends audit log entry", async () => {
    const initial = makeBinding({ bindingState: "active" });
    const { gateway } = makeGatewayMock(initial);
    const s = createInitialBindingsState();
    s.gateway = gateway;
    s.bindings = [initial];

    await changeBindingState(s, "b-1", "disabled");

    expect(s.bindings[0]?.bindingState).toBe("disabled");
    expect(s.auditLog.length).toBe(1);
    expect(s.auditLog[0]?.action).toBe("state-change");
    expect(s.auditLog[0]?.before).toContain("active");
    expect(s.auditLog[0]?.after).toContain("disabled");
  });

  it("ignores re-entrant calls while busy", async () => {
    const initial = makeBinding({ bindingState: "active" });
    let resolveFn: ((v: UpdateBindingStateResponse) => void) | null = null;
    const updateMock = vi.fn(
      () =>
        new Promise<UpdateBindingStateResponse>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const gateway = {
      listBindings: vi.fn(async () => ({ bindings: [initial] })),
      updateBindingState: updateMock,
    } as unknown as AgentRuntimeGateway;
    const s = createInitialBindingsState();
    s.gateway = gateway;
    s.bindings = [initial];
    const firstCall = changeBindingState(s, "b-1", "disabled");
    // 第二次调用应被忽略（busy）
    await changeBindingState(s, "b-1", "disabled");
    expect(updateMock).toHaveBeenCalledTimes(1);
    // 完成第一次调用，避免 hang
    if (resolveFn) {
      (resolveFn as (v: UpdateBindingStateResponse) => void)({
        binding: { ...initial, bindingState: "disabled" },
      });
    }
    await firstCall;
  });

  it("records error message on failure", async () => {
    const gateway = {
      updateBindingState: vi.fn(async () => {
        throw new Error("rpc-failed");
      }),
    } as unknown as AgentRuntimeGateway;
    const s = createInitialBindingsState();
    s.gateway = gateway;
    s.bindings = [makeBinding()];
    await changeBindingState(s, "b-1", "disabled");
    expect(s.error).toContain("rpc-failed");
    expect(s.busyBindingId).toBeNull();
  });
});

describe("changeBindingPriority", () => {
  it("rejects non-finite or negative priorities without RPC", async () => {
    const initial = makeBinding();
    const { gateway } = makeGatewayMock(initial);
    const s = createInitialBindingsState();
    s.gateway = gateway;
    s.bindings = [initial];

    await changeBindingPriority(s, "b-1", -1);
    expect(s.error).toContain("非负");
    expect(spy(gateway, "updateBindingPriority")).not.toHaveBeenCalled();

    await changeBindingPriority(s, "b-1", Number.POSITIVE_INFINITY);
    expect(spy(gateway, "updateBindingPriority")).not.toHaveBeenCalled();
  });

  it("commits valid priority and audits before/after", async () => {
    const initial = makeBinding({ routingPriority: 30 });
    const { gateway } = makeGatewayMock(initial);
    const s = createInitialBindingsState();
    s.gateway = gateway;
    s.bindings = [initial];
    await changeBindingPriority(s, "b-1", 80);
    expect(s.bindings[0]?.routingPriority).toBe(80);
    expect(s.auditLog[0]?.before).toContain("30");
    expect(s.auditLog[0]?.after).toContain("80");
  });
});

describe("changeBindingStrategy", () => {
  it("commits strategy update", async () => {
    const initial = makeBinding({ loadStrategy: "lazy" });
    const { gateway } = makeGatewayMock(initial);
    const s = createInitialBindingsState();
    s.gateway = gateway;
    s.bindings = [initial];
    await changeBindingStrategy(s, "b-1", "eager");
    expect(s.bindings[0]?.loadStrategy).toBe("eager");
    expect(s.auditLog[0]?.action).toBe("strategy-change");
  });
});

describe("selectBindingDetail", () => {
  it("loads detail for the given id", async () => {
    const initial = makeBinding();
    const { gateway } = makeGatewayMock(initial);
    const s = createInitialBindingsState();
    s.gateway = gateway;
    await selectBindingDetail(s, "b-1");
    expect(s.selectedDetail?.binding.bindingId).toBe("b-1");
    expect(s.selectedDetail?.agentName).toBe("Agent One");
  });

  it("clears detail when id is null", async () => {
    const s = createInitialBindingsState();
    s.selectedDetail = {
      binding: makeBinding(),
      agentName: "x",
      capabilityName: "y",
    };
    await selectBindingDetail(s, null);
    expect(s.selectedDetail).toBeNull();
  });
});

describe("audit log behaviour", () => {
  it("caps audit log at 50 entries", async () => {
    const initial = makeBinding();
    const { gateway } = makeGatewayMock(initial);
    const s = createInitialBindingsState();
    s.gateway = gateway;
    s.bindings = [initial];
    for (let i = 0; i < 60; i += 1) {
      await changeBindingPriority(s, "b-1", i);
    }
    expect(s.auditLog.length).toBe(50);
    // most recent should be at index 0
    expect(s.auditLog[0]?.after).toContain("59");
  });
});
