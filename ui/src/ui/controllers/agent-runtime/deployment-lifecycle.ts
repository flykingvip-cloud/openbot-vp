/**
 * Agent Runtime Center — Deployment Lifecycle Controller。
 *
 * 实现：
 * - Task 22 的"状态转换前展示影响评估"流程
 * - Task 23 的"Projection 触发"客户端钩子（通过 onLifecycleProjected 回调上抛）
 *
 * 操作流：
 *   1. `requestTransition(agentId, target)`：客户端先用状态机校验合法性，
 *      若合法则向 Gateway 请求"影响评估" + 立即应用转换（服务端原子）。
 *   2. 服务端响应中含 `impact` 与 `triggersDownstreamNotification` 旗标，
 *      用于 UI 弹窗提示是否会触发企业端 / 员工端的通知。
 *   3. 服务端写入成功后，本控制器会调用 `onLifecycleProjected` 回调，
 *      由调用方负责把 Projection 事件投递到事件总线（参见 task 23 / 26）。
 *
 * 注意：本模块不直接发起企业端 / 员工端的 RPC，所有跨层通讯都走事件总线。
 */

import type {
  AgentRuntimeGateway,
  GetLifecycleHistoryResponse,
  UpdateLifecycleResponse,
} from "../../capability/agent-runtime/index.ts";
import type { RuntimeAgent, RuntimeLifecycle } from "../../capability/runtime-canonical/index.ts";
import {
  type LifecycleTransitionValidation,
  validateTransition,
} from "../../capability/runtime-canonical/lifecycle-state-machine.ts";

export type LifecycleProjectedHook = (event: {
  runtimeAgentId: string;
  fromLifecycle: RuntimeLifecycle;
  toLifecycle: RuntimeLifecycle;
  triggersDownstreamNotification: boolean;
  occurredAt: number;
}) => void;

export type DeploymentLifecycleState = {
  gateway: AgentRuntimeGateway | null;
  agents: RuntimeAgent[];
  busyAgentId: string | null;
  error: string | null;
  /** 服务端最近一次 update-lifecycle 的响应缓存，便于 UI 展示 impact。 */
  lastTransition: UpdateLifecycleResponse | null;
  /** 各 Agent 的生命周期历史（懒加载）。 */
  history: Map<string, GetLifecycleHistoryResponse>;
  /** 转换成功后的回调钩子；由调用方注入事件总线发布逻辑。 */
  onLifecycleProjected: LifecycleProjectedHook | null;
};

export function createInitialLifecycleState(): DeploymentLifecycleState {
  return {
    gateway: null,
    agents: [],
    busyAgentId: null,
    error: null,
    lastTransition: null,
    history: new Map(),
    onLifecycleProjected: null,
  };
}

/** 客户端预校验：在请求服务端之前先用纯函数判定合法性，节省一次往返。 */
export function preflightTransition(
  current: RuntimeLifecycle,
  target: RuntimeLifecycle,
): LifecycleTransitionValidation {
  return validateTransition(current, target);
}

/**
 * 触发生命周期转换。
 *
 * 流程：
 *   1. 客户端 `validateTransition` 先做合法性预检；非法则不发请求并返回。
 *   2. 调用 `agent-runtime.update-lifecycle`。
 *   3. 成功后用响应中的最新 agent 替换本地缓存；
 *   4. 若服务端旗标 `triggersDownstreamNotification === true`，
 *      调用 `onLifecycleProjected`，由调用方将事件投递到事件总线。
 */
export async function requestTransition(
  state: DeploymentLifecycleState,
  runtimeAgentId: string,
  targetLifecycle: RuntimeLifecycle,
  reason: string,
): Promise<UpdateLifecycleResponse | null> {
  if (state.gateway === null || state.busyAgentId === runtimeAgentId) {
    return null;
  }
  const agent = state.agents.find((a) => a.runtimeAgentId === runtimeAgentId);
  if (!agent) {
    state.error = `Agent ${runtimeAgentId} 不存在`;
    return null;
  }
  const fromLifecycle = agent.lifecycle;
  const validation = validateTransition(fromLifecycle, targetLifecycle);
  if (!validation.ok) {
    state.error = validation.reason;
    return null;
  }

  state.busyAgentId = runtimeAgentId;
  state.error = null;
  try {
    const resp = await state.gateway.updateLifecycle({
      runtimeAgentId,
      targetLifecycle,
      reason,
    });
    state.lastTransition = resp;

    if (resp.rejectionReason !== null) {
      state.error = resp.rejectionReason;
      return resp;
    }

    // 同步 agents 缓存
    const idx = state.agents.findIndex((a) => a.runtimeAgentId === runtimeAgentId);
    if (idx >= 0) {
      state.agents = [...state.agents.slice(0, idx), resp.agent, ...state.agents.slice(idx + 1)];
    }

    // Task 23：通过钩子向上抛 Projection 事件
    if (resp.impact.triggersDownstreamNotification && state.onLifecycleProjected) {
      state.onLifecycleProjected({
        runtimeAgentId,
        fromLifecycle,
        toLifecycle: resp.agent.lifecycle,
        triggersDownstreamNotification: true,
        occurredAt: Date.now(),
      });
    }
    return resp;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "生命周期转换失败";
    return null;
  } finally {
    state.busyAgentId = null;
  }
}

/** 加载某个 Agent 的生命周期事件历史（用于 audit 视图）。 */
export async function loadHistory(
  state: DeploymentLifecycleState,
  runtimeAgentId: string,
): Promise<void> {
  if (state.gateway === null) {
    return;
  }
  try {
    const resp = await state.gateway.getLifecycleHistory({ runtimeAgentId });
    const next = new Map(state.history);
    next.set(runtimeAgentId, resp);
    state.history = next;
  } catch (error) {
    state.error = error instanceof Error ? error.message : "加载生命周期历史失败";
  }
}
