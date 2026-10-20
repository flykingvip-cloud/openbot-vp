/**
 * Agent Runtime Center — Runtime Health Controller。
 *
 * 实现：
 * - Task 19：健康全景（已在 page 中静态渲染；此控制器为可交互版本）
 * - Task 20：迷你趋势图所需的 telemetry 时间序列
 * - Task 21：健康事件告警机制（HealthEvent 流 + 阈值触发回调）
 *
 * 数据流：
 *   loadSummary()  → 拉取整体健康摘要（agentCountByHealth / unhealthyAgents 等）
 *   loadTimeline(window) → 拉取 telemetry 列表用于趋势图渲染
 *   recordHealthEvent(prev, next) → 客户端检测健康降级并产出 HealthEvent，
 *                                    通过 onHealthEventEmitted 回调投递到事件总线
 *
 * 注意：本控制器**不**直接弹告警通知；告警渠道由调用方（page / 系统设置）配置后
 * 通过 onHealthEventEmitted 注入。
 */

import type {
  AgentRuntimeGateway,
  GetHealthSummaryResponse,
  ListTelemetryResponse,
  TelemetryWindow,
} from "../../capability/agent-runtime/index.ts";
import {
  RUNTIME_HEALTH_RANK,
  type RuntimeAgent,
  type RuntimeCapabilityBinding,
  type RuntimeHealth,
  type RuntimeTelemetry,
} from "../../capability/runtime-canonical/index.ts";

export type HealthEvent = {
  id: string;
  /** 主体类型与标识：Agent 或 Binding 之一。 */
  subject:
    | { kind: "agent"; runtimeAgentId: string; agentName: string }
    | { kind: "binding"; bindingId: string; runtimeAgentId: string };
  fromHealth: RuntimeHealth;
  toHealth: RuntimeHealth;
  /** 健康度变差为 true，恢复为 false。 */
  isDegradation: boolean;
  occurredAt: number;
};

export type HealthEventListener = (event: HealthEvent) => void;

export type RuntimeHealthState = {
  gateway: AgentRuntimeGateway | null;
  loading: boolean;
  error: string | null;
  summary: GetHealthSummaryResponse | null;
  /** 当前选定的时间窗口（与 trend chart 对齐）。 */
  window: TelemetryWindow;
  /** Telemetry 时间序列：按 (runtimeAgentId, capabilityId) 维度按时间升序。 */
  telemetry: RuntimeTelemetry[];
  /** 健康事件回调；由调用方注册告警渠道。 */
  onHealthEventEmitted: HealthEventListener | null;
  /** 最近健康事件缓存（最多 100 条）。 */
  recentEvents: HealthEvent[];
};

const HEALTH_EVENT_LIMIT = 100;

export function createInitialHealthState(): RuntimeHealthState {
  return {
    gateway: null,
    loading: false,
    error: null,
    summary: null,
    window: "24h",
    telemetry: [],
    onHealthEventEmitted: null,
    recentEvents: [],
  };
}

export async function loadSummary(state: RuntimeHealthState): Promise<void> {
  if (state.gateway === null) {
    state.error = "尚未连接到 Gateway";
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    state.summary = await state.gateway.getHealthSummary({ window: state.window });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "加载健康摘要失败";
  } finally {
    state.loading = false;
  }
}

export async function loadTimeline(
  state: RuntimeHealthState,
  filters: { runtimeAgentId: string | null; capabilityId: string | null } = {
    runtimeAgentId: null,
    capabilityId: null,
  },
): Promise<void> {
  if (state.gateway === null) {
    return;
  }
  try {
    const resp: ListTelemetryResponse = await state.gateway.listTelemetry({
      runtimeAgentId: filters.runtimeAgentId,
      capabilityId: filters.capabilityId,
      window: state.window,
    });
    // 升序排序便于趋势图直接 .map
    state.telemetry = [...resp.samples].toSorted((a, b) => a.lastSampleAt - b.lastSampleAt);
  } catch (error) {
    state.error = error instanceof Error ? error.message : "加载 Telemetry 失败";
  }
}

export function setHealthWindow(state: RuntimeHealthState, window: TelemetryWindow): void {
  state.window = window;
}

// ─────────────────────────────────────────────────────────────────────────
// Task 21：健康事件 / 告警
// ─────────────────────────────────────────────────────────────────────────

function makeEventId(): string {
  return `health-evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushEvent(state: RuntimeHealthState, event: HealthEvent): void {
  state.recentEvents = [event, ...state.recentEvents].slice(0, HEALTH_EVENT_LIMIT);
  if (state.onHealthEventEmitted) {
    state.onHealthEventEmitted(event);
  }
}

/**
 * 客户端比对前后两次 Agent 健康状态，若发生变化则产出 HealthEvent。
 *
 * 调用方在 polling / WebSocket 推送场景下可周期性调用，将快照传入；
 * 本函数不修改入参，纯函数逻辑由 RUNTIME_HEALTH_RANK 决定方向。
 */
export function diffAgentHealth(
  state: RuntimeHealthState,
  prev: RuntimeAgent[],
  next: RuntimeAgent[],
): HealthEvent[] {
  const prevById = new Map(prev.map((a) => [a.runtimeAgentId, a]));
  const events: HealthEvent[] = [];
  const occurredAt = Date.now();
  for (const n of next) {
    const p = prevById.get(n.runtimeAgentId);
    if (!p || p.health === n.health) {
      continue;
    }
    const isDegradation = RUNTIME_HEALTH_RANK[n.health] < RUNTIME_HEALTH_RANK[p.health];
    const event: HealthEvent = {
      id: makeEventId(),
      subject: { kind: "agent", runtimeAgentId: n.runtimeAgentId, agentName: n.name },
      fromHealth: p.health,
      toHealth: n.health,
      isDegradation,
      occurredAt,
    };
    events.push(event);
    pushEvent(state, event);
  }
  return events;
}

/** 与 `diffAgentHealth` 对应的 binding 版本。 */
export function diffBindingHealth(
  state: RuntimeHealthState,
  prev: RuntimeCapabilityBinding[],
  next: RuntimeCapabilityBinding[],
): HealthEvent[] {
  const prevById = new Map(prev.map((b) => [b.bindingId, b]));
  const events: HealthEvent[] = [];
  const occurredAt = Date.now();
  for (const n of next) {
    const p = prevById.get(n.bindingId);
    if (!p || p.healthStatus === n.healthStatus) {
      continue;
    }
    const isDegradation = RUNTIME_HEALTH_RANK[n.healthStatus] < RUNTIME_HEALTH_RANK[p.healthStatus];
    const event: HealthEvent = {
      id: makeEventId(),
      subject: {
        kind: "binding",
        bindingId: n.bindingId,
        runtimeAgentId: n.runtimeAgentId,
      },
      fromHealth: p.healthStatus,
      toHealth: n.healthStatus,
      isDegradation,
      occurredAt,
    };
    events.push(event);
    pushEvent(state, event);
  }
  return events;
}
