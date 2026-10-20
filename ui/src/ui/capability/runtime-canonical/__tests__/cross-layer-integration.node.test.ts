// @vitest-environment node
// Feature: platform-agent-runtime-center, Task 30: End-to-end cross-layer integration
//
// 4 个集成场景，覆盖 Tasks 18 / 23 / 27 / 28：
//   1. 企业端"安装到机器人" → 平台创建 Binding → 企业端 InstallRelation 更新
//   2. RuntimeHealth degraded → 企业端"偶尔结果不理想" + 员工端"偶尔异常"
//   3. RuntimeLifecycle deprecated → 企业端和员工端"即将下线"提示
//   4. Capability retired → 所有 Binding disabled → Projection 同步到下游
import { describe, expect, it, vi } from "vitest";
import {
  createAgentRuntimeMockBackend,
  __mockBackendInternals,
} from "../../agent-runtime/index.ts";
import {
  attachAllCrossLayerWiring,
  createRuntimeEventBus,
  type ProjectedDownstreamEvent,
  publish,
} from "../index.ts";

function createSinks(): {
  enterprise: ProjectedDownstreamEvent[];
  employee: ProjectedDownstreamEvent[];
  enterpriseSink: (e: ProjectedDownstreamEvent) => void;
  employeeSink: (e: ProjectedDownstreamEvent) => void;
} {
  const enterprise: ProjectedDownstreamEvent[] = [];
  const employee: ProjectedDownstreamEvent[] = [];
  return {
    enterprise,
    employee,
    enterpriseSink: (e) => enterprise.push(e),
    employeeSink: (e) => employee.push(e),
  };
}

describe("Scenario 1: Enterprise install request → platform creates Binding → InstallRelation update", () => {
  it("publishes runtime.binding.created and projects to enterprise sink", async () => {
    __mockBackendInternals.reset();
    const bus = createRuntimeEventBus();
    const gateway = createAgentRuntimeMockBackend();
    const sinks = createSinks();
    const off = attachAllCrossLayerWiring(bus, gateway, {
      enterprise: sinks.enterpriseSink,
      employee: sinks.employeeSink,
    });

    publish(bus, {
      eventType: "enterprise.install.requested",
      source: "enterprise",
      timestamp: Date.now(),
      payload: {
        runtimeAgentId: "agent-da-bai-guan-jia",
        capabilityId: "cap-new-emotion",
        capabilityVersion: "1.0.0",
        triggeredBy: "admin-push",
      },
    });

    // 等待 microtasks（mock backend 内部 setTimeout 50ms）
    await new Promise((r) => setTimeout(r, 100));

    const installRelations = sinks.enterprise.filter(
      (e) => e.type === "projected.install.relation-changed",
    );
    expect(installRelations.length).toBeGreaterThan(0);
    expect(installRelations[0]?.changeKind).toBe("create");
    off();
  });
});

describe("Scenario 2: RuntimeHealth degraded → projects to enterprise + employee labels", () => {
  it("emits 偶尔结果不理想 to enterprise and 偶尔异常 to employee", () => {
    const bus = createRuntimeEventBus();
    const gateway = createAgentRuntimeMockBackend();
    const sinks = createSinks();
    const off = attachAllCrossLayerWiring(bus, gateway, {
      enterprise: sinks.enterpriseSink,
      employee: sinks.employeeSink,
    });

    publish(bus, {
      eventType: "runtime.health.changed",
      source: "platform",
      timestamp: 1234,
      payload: {
        runtimeAgentId: "agent-1",
        capabilityId: null,
        bindingId: null,
        fromHealth: "healthy",
        toHealth: "degraded",
      },
    });

    const enterpriseHealth = sinks.enterprise.find(
      (e): e is Extract<ProjectedDownstreamEvent, { type: "projected.enterprise.health-status" }> =>
        e.type === "projected.enterprise.health-status",
    );
    const employeeHealth = sinks.employee.find(
      (e): e is Extract<ProjectedDownstreamEvent, { type: "projected.employee.health-label" }> =>
        e.type === "projected.employee.health-label",
    );
    expect(enterpriseHealth?.healthStatus).toBe("偶尔结果不理想");
    expect(employeeHealth?.healthLabel).toBe("偶尔异常");
    off();
  });

  it("RuntimeHealth unavailable produces null employee label (not displayed)", () => {
    const bus = createRuntimeEventBus();
    const gateway = createAgentRuntimeMockBackend();
    const sinks = createSinks();
    const off = attachAllCrossLayerWiring(bus, gateway, {
      enterprise: sinks.enterpriseSink,
      employee: sinks.employeeSink,
    });

    publish(bus, {
      eventType: "runtime.health.changed",
      source: "platform",
      timestamp: 1234,
      payload: {
        runtimeAgentId: "agent-1",
        capabilityId: null,
        bindingId: null,
        fromHealth: "degraded",
        toHealth: "unavailable",
      },
    });

    const employeeHealth = sinks.employee.find(
      (e): e is Extract<ProjectedDownstreamEvent, { type: "projected.employee.health-label" }> =>
        e.type === "projected.employee.health-label",
    );
    expect(employeeHealth?.healthLabel).toBeNull();
    off();
  });
});

describe("Scenario 3: RuntimeLifecycle deprecated → notification on both downstream layers", () => {
  it("notifies enterprise and employee with 即将下线", () => {
    const bus = createRuntimeEventBus();
    const gateway = createAgentRuntimeMockBackend();
    const sinks = createSinks();
    const off = attachAllCrossLayerWiring(bus, gateway, {
      enterprise: sinks.enterpriseSink,
      employee: sinks.employeeSink,
    });

    publish(bus, {
      eventType: "runtime.lifecycle.changed",
      source: "platform",
      timestamp: 1234,
      payload: {
        runtimeAgentId: "agent-1",
        fromLifecycle: "deployed",
        toLifecycle: "deprecated",
        triggersDownstreamNotification: true,
      },
    });

    const enterpriseNotice = sinks.enterprise.find(
      (e): e is Extract<ProjectedDownstreamEvent, { type: "projected.lifecycle.notification" }> =>
        e.type === "projected.lifecycle.notification",
    );
    const employeeNotice = sinks.employee.find(
      (e): e is Extract<ProjectedDownstreamEvent, { type: "projected.lifecycle.notification" }> =>
        e.type === "projected.lifecycle.notification",
    );
    expect(enterpriseNotice?.notification.message).toBe("即将下线");
    expect(employeeNotice?.notification.message).toBe("即将下线");
    off();
  });

  it("does NOT emit notifications for non-deprecated/archived transitions", () => {
    const bus = createRuntimeEventBus();
    const gateway = createAgentRuntimeMockBackend();
    const sinks = createSinks();
    const off = attachAllCrossLayerWiring(bus, gateway, {
      enterprise: sinks.enterpriseSink,
      employee: sinks.employeeSink,
    });

    publish(bus, {
      eventType: "runtime.lifecycle.changed",
      source: "platform",
      timestamp: 1234,
      payload: {
        runtimeAgentId: "agent-1",
        fromLifecycle: "deployed",
        toLifecycle: "draining",
        triggersDownstreamNotification: false,
      },
    });

    const lifecycleEvents = [...sinks.enterprise, ...sinks.employee].filter(
      (e) => e.type === "projected.lifecycle.notification",
    );
    expect(lifecycleEvents).toEqual([]);
    off();
  });
});

describe("Scenario 4: Capability retired → cascade disable all bindings + projection", () => {
  it("disables every active binding pointing at the retired capability", async () => {
    __mockBackendInternals.reset();
    const bus = createRuntimeEventBus();
    const gateway = createAgentRuntimeMockBackend();
    const sinks = createSinks();
    const off = attachAllCrossLayerWiring(bus, gateway, {
      enterprise: sinks.enterpriseSink,
      employee: sinks.employeeSink,
    });

    // 选择 cap-meeting-summary —— mock 数据中此能力存在多个绑定（version drift）
    publish(bus, {
      eventType: "capability.retired",
      source: "platform",
      timestamp: Date.now(),
      payload: { capabilityId: "cap-meeting-summary" },
    });

    // mock 后端使用 50ms 延迟，等足
    await new Promise((r) => setTimeout(r, 200));

    // 验证：所有 cap-meeting-summary 的 binding 都已 disabled
    const list = await gateway.listBindings({
      runtimeAgentId: null,
      capabilityId: "cap-meeting-summary",
      bindingType: null,
      bindingState: null,
      health: null,
    });
    for (const b of list.bindings) {
      expect(b.bindingState).toBe("disabled");
    }

    // 同时企业端应收到一组 install-relation-changed (state-change)
    const stateChanges = sinks.enterprise.filter(
      (e) => e.type === "projected.install.relation-changed" && e.changeKind === "state-change",
    );
    expect(stateChanges.length).toBeGreaterThan(0);
    off();
  });
});

describe("Failure isolation across cross-layer listeners", () => {
  it("a throwing enterprise sink does not block employee sink", () => {
    const bus = createRuntimeEventBus();
    const gateway = createAgentRuntimeMockBackend();
    const enterpriseSink = vi.fn(() => {
      throw new Error("enterprise-sink-broken");
    });
    const employeeSink = vi.fn();
    const off = attachAllCrossLayerWiring(bus, gateway, {
      enterprise: enterpriseSink,
      employee: employeeSink,
    });

    publish(bus, {
      eventType: "runtime.health.changed",
      source: "platform",
      timestamp: 1234,
      payload: {
        runtimeAgentId: "agent-1",
        capabilityId: null,
        bindingId: null,
        fromHealth: "healthy",
        toHealth: "degraded",
      },
    });

    expect(employeeSink).toHaveBeenCalled();
    off();
  });
});
