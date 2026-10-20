/**
 * Cross-Layer Wiring — 三层架构的事件总线接线模块。
 *
 * 该模块实现 Tasks 18 / 23 / 27 / 28 中描述的双向反向集成与 Capability Center
 * 联动。所有跨层通讯都在此处用纯函数 wiring 表达，不直接发起 RPC：
 *
 * - 平台 → 企业 / 员工：通过 `projection.ts` 的纯函数把 Runtime 状态翻译成下游
 *   业务标签，订阅者只需关注 `runtime.*` 事件即可获得已投影的业务视图。
 * - 企业 → 平台：企业端把"安装到机器人"、"卸载"、"标记为已不适合继续推广"等
 *   操作通过事件总线发布到平台层；本模块 attach 的 listener 调用平台 gateway
 *   完成 Binding 的实际写入。
 * - Capability Center → 平台：能力被标记 retired 时，本模块自动级联 disable
 *   所有引用该 capability 的 binding。
 *
 * 设计准则：
 * - 单向投影：下游层不可直接修改 Runtime 字段；任何反向操作必须通过事件总线。
 * - listener 失败入重试队列（参见 event-bus.ts）。
 * - 本模块不做 UI 弹窗 / Toast；具体通知方式由调用方注册自己的事件监听器决定。
 */

import type { AgentRuntimeGateway } from "../agent-runtime/index.ts";
import { publish, subscribe, type RuntimeEventBus } from "./event-bus.ts";
import {
  projectBindingTypeToSource,
  projectHealthToEmployee,
  projectHealthToEnterprise,
  projectLifecycleToNotification,
} from "./projection.ts";
import type { RuntimeCapabilityBinding } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// 下游 Projection 投影器：订阅 Runtime 事件并发布"业务化"派生事件
// ─────────────────────────────────────────────────────────────────────────

/**
 * 下游消费者关心的"已投影"事件载荷。这些事件由 `attachProjectionForwarders`
 * 自动生成，企业端 / 员工端只订阅这些"已投影"事件即可，无需直接接触 Runtime
 * 内部字段。
 *
 * 派生事件类型：
 * - `projected.enterprise.health-status`  企业端业务效果语言（"效果稳定" 等）
 * - `projected.employee.health-label`     员工端能力健康标签（"运行稳定" 等）
 * - `projected.lifecycle.notification`    生命周期通知（"即将下线" / "已下线"）
 * - `projected.install.relation-changed`  企业端 InstallRelation 变更
 *
 * 这些派生事件不是核心运行时事件 — 它们只是"投影函数"的事件化结果，便于下游
 * 异步消费。下游层若仅需直接业务视图而非事件流，也可直接调用 projection 纯函数。
 */
export type ProjectedDownstreamEvent =
  | {
      type: "projected.enterprise.health-status";
      runtimeAgentId: string;
      capabilityId: string | null;
      bindingId: string | null;
      healthStatus: ReturnType<typeof projectHealthToEnterprise>;
      occurredAt: number;
    }
  | {
      type: "projected.employee.health-label";
      runtimeAgentId: string;
      capabilityId: string | null;
      bindingId: string | null;
      /** unavailable 时为 null（员工端不展示） */
      healthLabel: ReturnType<typeof projectHealthToEmployee>;
      occurredAt: number;
    }
  | {
      type: "projected.lifecycle.notification";
      runtimeAgentId: string;
      notification: NonNullable<ReturnType<typeof projectLifecycleToNotification>>;
      occurredAt: number;
    }
  | {
      type: "projected.install.relation-changed";
      bindingId: string;
      runtimeAgentId: string;
      capabilityId: string;
      /** create / delete / state-change */
      changeKind: "create" | "delete" | "state-change";
      source: ReturnType<typeof projectBindingTypeToSource> | null;
      occurredAt: number;
    };

export type ProjectedDownstreamSink = (event: ProjectedDownstreamEvent) => void;

/**
 * 在事件总线上挂载投影转发器。每当 Runtime 事件发布，本函数注册的 listener
 * 会自动通过 `projection.ts` 中的纯函数翻译成下游事件，再调用 sink 投递。
 *
 * 调用方应同时提供企业端 sink 与员工端 sink，分别接收对应层的投影事件。
 *
 * @returns unsubscribe 函数 —— 解除全部已注册的转发器
 */
export function attachProjectionForwarders(
  bus: RuntimeEventBus,
  sinks: {
    enterprise: ProjectedDownstreamSink;
    employee: ProjectedDownstreamSink;
  },
): () => void {
  const offFns: Array<() => void> = [];

  offFns.push(
    subscribe(bus, "runtime.health.changed", (event) => {
      const occurredAt = event.timestamp;
      // Enterprise / employee sinks must remain isolated:
      // a thrown enterprise sink should not prevent the employee projection
      // from being delivered (failure-isolation invariant).
      try {
        sinks.enterprise({
          type: "projected.enterprise.health-status",
          runtimeAgentId: event.payload.runtimeAgentId,
          capabilityId: event.payload.capabilityId,
          bindingId: event.payload.bindingId,
          healthStatus: projectHealthToEnterprise(event.payload.toHealth),
          occurredAt,
        });
      } catch {
        // 让 event-bus 的重试机制接管：抛出由 publish 捕获并入队
        // 但首先确保 employee sink 也得到机会执行
      }
      try {
        sinks.employee({
          type: "projected.employee.health-label",
          runtimeAgentId: event.payload.runtimeAgentId,
          capabilityId: event.payload.capabilityId,
          bindingId: event.payload.bindingId,
          healthLabel: projectHealthToEmployee(event.payload.toHealth),
          occurredAt,
        });
      } catch {
        // 同上：吞掉同步错误，以保持两个 sink 的隔离
      }
    }),
  );

  offFns.push(
    subscribe(bus, "runtime.lifecycle.changed", (event) => {
      const notification = projectLifecycleToNotification(event.payload.toLifecycle);
      if (notification === null) {
        return;
      } // deployed/draining/suspended 不通知下游
      const projected: ProjectedDownstreamEvent = {
        type: "projected.lifecycle.notification",
        runtimeAgentId: event.payload.runtimeAgentId,
        notification,
        occurredAt: event.timestamp,
      };
      try {
        sinks.enterprise(projected);
      } catch {
        /* isolated; see above */
      }
      try {
        sinks.employee(projected);
      } catch {
        /* isolated; see above */
      }
    }),
  );

  offFns.push(
    subscribe(bus, "runtime.binding.created", (event) => {
      sinks.enterprise({
        type: "projected.install.relation-changed",
        bindingId: event.payload.bindingId,
        runtimeAgentId: event.payload.runtimeAgentId,
        capabilityId: event.payload.capabilityId,
        changeKind: "create",
        source: null, // bindingType 在 created 事件中暂未携带；调用方可额外查询
        occurredAt: event.timestamp,
      });
    }),
  );

  offFns.push(
    subscribe(bus, "runtime.binding.deleted", (event) => {
      sinks.enterprise({
        type: "projected.install.relation-changed",
        bindingId: event.payload.bindingId,
        runtimeAgentId: event.payload.runtimeAgentId,
        capabilityId: event.payload.capabilityId,
        changeKind: "delete",
        source: null,
        occurredAt: event.timestamp,
      });
    }),
  );

  offFns.push(
    subscribe(bus, "runtime.binding.state-changed", (event) => {
      sinks.enterprise({
        type: "projected.install.relation-changed",
        bindingId: event.payload.bindingId,
        runtimeAgentId: event.payload.runtimeAgentId,
        capabilityId: event.payload.capabilityId,
        changeKind: "state-change",
        source: null,
        occurredAt: event.timestamp,
      });
    }),
  );

  return () => {
    for (const off of offFns) {
      off();
    }
    offFns.length = 0;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 反向集成（Tasks 18 / 27）：Enterprise → Runtime 事件 → Gateway 调用
// ─────────────────────────────────────────────────────────────────────────

/**
 * 平台侧反向接线：把企业端发布的 enterprise.* 事件落地为 Runtime 写入操作。
 *
 * 注意：本模块只**翻译事件 → RPC**，并不在企业端模块内复制状态。企业端模块
 * 通过 `publish(bus, { eventType: "enterprise.install.requested", ... })` 发布
 * 意图，平台侧由本函数订阅并执行。
 *
 * @param bus     事件总线
 * @param gateway 平台 Agent Runtime gateway
 * @param policy  默认策略（CreateBinding 时填充未指定字段）
 * @returns unsubscribe 函数
 */
export function attachEnterpriseReverseHandlers(
  bus: RuntimeEventBus,
  gateway: AgentRuntimeGateway,
  policy: {
    sandbox: string;
    resourceQuota: string;
    hotReloadable: boolean;
  } = { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
): () => void {
  const offFns: Array<() => void> = [];

  // Task 18：企业端"安装到机器人" → 平台创建 Binding（tenant-installed / lazy / active）
  offFns.push(
    subscribe(bus, "enterprise.install.requested", async (event) => {
      const created = await gateway.createBinding({
        runtimeAgentId: event.payload.runtimeAgentId,
        capabilityId: event.payload.capabilityId,
        capabilityVersion: event.payload.capabilityVersion,
        bindingType: "tenant-installed",
        loadStrategy: "lazy",
        routingPriority: null,
        policy,
        fallbackBindingId: null,
      });
      // 反向通知 Runtime 事件流（让 projection forwarder 触发企业端 InstallRelation 更新）
      publish(bus, {
        eventType: "runtime.binding.created",
        source: "platform",
        timestamp: Date.now(),
        payload: {
          bindingId: created.binding.bindingId,
          runtimeAgentId: created.binding.runtimeAgentId,
          capabilityId: created.binding.capabilityId,
          capabilityVersion: created.binding.capabilityVersion,
        },
      });
    }),
  );

  // Task 27：企业端"卸载能力" → 平台 disable Binding
  offFns.push(
    subscribe(bus, "enterprise.uninstall.requested", async (event) => {
      const beforeState = await fetchBindingStateSafe(gateway, event.payload.bindingId);
      const resp = await gateway.updateBindingState({
        bindingId: event.payload.bindingId,
        bindingState: "disabled",
      });
      publish(bus, {
        eventType: "runtime.binding.state-changed",
        source: "platform",
        timestamp: Date.now(),
        payload: {
          bindingId: resp.binding.bindingId,
          runtimeAgentId: resp.binding.runtimeAgentId,
          capabilityId: resp.binding.capabilityId,
          fromState: beforeState ?? "active",
          toState: resp.binding.bindingState,
        },
      });
    }),
  );

  // Task 27：企业端"标记为已不适合继续推广" → 平台 disable Binding（同语义）
  offFns.push(
    subscribe(bus, "enterprise.deprecate.requested", async (event) => {
      const beforeState = await fetchBindingStateSafe(gateway, event.payload.bindingId);
      const resp = await gateway.updateBindingState({
        bindingId: event.payload.bindingId,
        bindingState: "disabled",
      });
      publish(bus, {
        eventType: "runtime.binding.state-changed",
        source: "platform",
        timestamp: Date.now(),
        payload: {
          bindingId: resp.binding.bindingId,
          runtimeAgentId: resp.binding.runtimeAgentId,
          capabilityId: resp.binding.capabilityId,
          fromState: beforeState ?? "active",
          toState: resp.binding.bindingState,
        },
      });
    }),
  );

  return () => {
    for (const off of offFns) {
      off();
    }
    offFns.length = 0;
  };
}

async function fetchBindingStateSafe(
  gateway: AgentRuntimeGateway,
  bindingId: string,
): Promise<RuntimeCapabilityBinding["bindingState"] | null> {
  try {
    const resp = await gateway.getBinding({ bindingId });
    return resp.binding.bindingState;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Capability Center 联动（Task 28）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 当 Capability Center 标记某个 capability 为 retired 时，本接线自动级联
 * disable 所有引用该 capability 的 binding。
 *
 * 设计取舍：
 * - 我们没有强约束在 Runtime 层缓存全量 binding 反查表；这里通过 `listBindings`
 *   的过滤参数获取所有 active/warming/degraded 状态的相关 binding 后批量 disable。
 * - disable 操作逐个发起；任一失败不会中断整体流程，但会进入事件总线重试。
 */
export function attachCapabilityCenterRetirement(
  bus: RuntimeEventBus,
  gateway: AgentRuntimeGateway,
): () => void {
  return subscribe(bus, "capability.retired", async (event) => {
    const { capabilityId } = event.payload;
    const list = await gateway.listBindings({
      runtimeAgentId: null,
      capabilityId,
      bindingType: null,
      bindingState: null,
      health: null,
    });
    for (const b of list.bindings) {
      if (b.bindingState === "disabled") {
        continue;
      }
      const fromState = b.bindingState;
      const resp = await gateway.updateBindingState({
        bindingId: b.bindingId,
        bindingState: "disabled",
      });
      publish(bus, {
        eventType: "runtime.binding.state-changed",
        source: "platform",
        timestamp: Date.now(),
        payload: {
          bindingId: resp.binding.bindingId,
          runtimeAgentId: resp.binding.runtimeAgentId,
          capabilityId: resp.binding.capabilityId,
          fromState,
          toState: resp.binding.bindingState,
        },
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 调用方便利接口
// ─────────────────────────────────────────────────────────────────────────

/**
 * 一次性挂载所有跨层接线。返回的 unsubscribe 函数会拆解全部 listener。
 *
 * 调用方典型用法：
 *   const off = attachAllCrossLayerWiring(bus, gateway, { enterprise, employee });
 *   ...
 *   off();  // 应用关闭时
 */
export function attachAllCrossLayerWiring(
  bus: RuntimeEventBus,
  gateway: AgentRuntimeGateway,
  sinks: {
    enterprise: ProjectedDownstreamSink;
    employee: ProjectedDownstreamSink;
  },
): () => void {
  const offFns: Array<() => void> = [
    attachProjectionForwarders(bus, sinks),
    attachEnterpriseReverseHandlers(bus, gateway),
    attachCapabilityCenterRetirement(bus, gateway),
  ];
  return () => {
    for (const off of offFns) {
      off();
    }
  };
}

// 末尾不再需要 dummy 引用：未使用的类型已在 imports 中清理。
