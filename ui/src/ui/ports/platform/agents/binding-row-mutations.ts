/**
 * Single-binding row mutations for the platform agents matrix.
 *
 * These map 1:1 onto existing single-row gateway methods.
 * Batch enable/disable/strategy goes through binding-batch.ts and must not loop
 * these single-row methods. Version upgrade stays deferred.
 */

import type {
  BindingState,
  LoadStrategy,
  RuntimeCapabilityBinding,
} from "../../../capability/runtime-canonical/index.ts";

export const BINDING_MUTATION_SCOPE = "operator.admin";

/** UI treats routingPriority >= 100 as the primary capability. */
export const BINDING_PRIMARY_ROUTING_PRIORITY = 100;

/** Store default for a new binding. Demote writes this value, not bindingType. */
export const BINDING_STANDBY_ROUTING_PRIORITY = 50;

export const BINDING_UPDATE_STATE_METHOD = "agent-runtime.update-binding-state";
export const BINDING_UPDATE_PRIORITY_METHOD = "agent-runtime.update-binding-priority";
export const BINDING_UPDATE_STRATEGY_METHOD = "agent-runtime.update-binding-strategy";

const LOAD_STRATEGY_LABELS: Record<LoadStrategy, string> = {
  eager: "预加载",
  lazy: "延迟加载",
  "on-demand": "按需加载",
};

export type BindingMutationRequester = {
  request: <T>(method: string, params: unknown) => Promise<T>;
};

export type BindingRowMutation = {
  bindingId: string;
  method: string;
  params: Record<string, unknown>;
  confirm: string;
  matches: (binding: RuntimeCapabilityBinding) => boolean;
};

export type BindingMutationResult =
  | { ok: true; binding: RuntimeCapabilityBinding }
  | { ok: false; error: string };

export function canMutateRuntimeBindings(params: {
  scopes: readonly string[] | null | undefined;
  clientConnected: boolean;
}): { allowed: boolean; reason: string } {
  if (!params.clientConnected) {
    return { allowed: false, reason: "网关未连接，绑定变更不可执行" };
  }
  if (!params.scopes?.includes(BINDING_MUTATION_SCOPE)) {
    return {
      allowed: false,
      reason: "需要 operator.admin 才能变更绑定",
    };
  }
  return { allowed: true, reason: "" };
}

function sameBinding(
  binding: RuntimeCapabilityBinding,
  bindingId: string,
  extra: (binding: RuntimeCapabilityBinding) => boolean,
): boolean {
  return binding.bindingId === bindingId && extra(binding);
}

export function enableBindingMutation(binding: RuntimeCapabilityBinding): BindingRowMutation {
  const bindingState: BindingState = "active";
  return {
    bindingId: binding.bindingId,
    method: BINDING_UPDATE_STATE_METHOD,
    params: { bindingId: binding.bindingId, bindingState },
    confirm: `确认启用绑定 ${binding.bindingId}？将调用 ${BINDING_UPDATE_STATE_METHOD}，只改这一条。`,
    matches: (next) =>
      sameBinding(next, binding.bindingId, (row) => row.bindingState === bindingState),
  };
}

export function disableBindingMutation(binding: RuntimeCapabilityBinding): BindingRowMutation {
  const bindingState: BindingState = "disabled";
  return {
    bindingId: binding.bindingId,
    method: BINDING_UPDATE_STATE_METHOD,
    params: { bindingId: binding.bindingId, bindingState },
    confirm: `确认停用绑定 ${binding.bindingId}？将调用 ${BINDING_UPDATE_STATE_METHOD}，只改这一条。`,
    matches: (next) =>
      sameBinding(next, binding.bindingId, (row) => row.bindingState === bindingState),
  };
}

export function promoteBindingMutation(binding: RuntimeCapabilityBinding): BindingRowMutation {
  return {
    bindingId: binding.bindingId,
    method: BINDING_UPDATE_PRIORITY_METHOD,
    params: {
      bindingId: binding.bindingId,
      routingPriority: BINDING_PRIMARY_ROUTING_PRIORITY,
    },
    confirm: `确认将绑定 ${binding.bindingId} 的 routingPriority 设为 ${BINDING_PRIMARY_ROUTING_PRIORITY}？将调用 ${BINDING_UPDATE_PRIORITY_METHOD}。`,
    matches: (next) =>
      sameBinding(
        next,
        binding.bindingId,
        (row) => row.routingPriority === BINDING_PRIMARY_ROUTING_PRIORITY,
      ),
  };
}

export function demoteBindingMutation(binding: RuntimeCapabilityBinding): BindingRowMutation {
  return {
    bindingId: binding.bindingId,
    method: BINDING_UPDATE_PRIORITY_METHOD,
    params: {
      bindingId: binding.bindingId,
      routingPriority: BINDING_STANDBY_ROUTING_PRIORITY,
    },
    confirm: `确认将绑定 ${binding.bindingId} 的 routingPriority 设为 ${BINDING_STANDBY_ROUTING_PRIORITY}？只调整优先级，不会把 bindingType 改成 fallback。将调用 ${BINDING_UPDATE_PRIORITY_METHOD}。`,
    matches: (next) =>
      sameBinding(
        next,
        binding.bindingId,
        (row) => row.routingPriority === BINDING_STANDBY_ROUTING_PRIORITY,
      ),
  };
}

export function strategyBindingMutation(
  binding: RuntimeCapabilityBinding,
  loadStrategy: LoadStrategy,
): BindingRowMutation {
  const label = LOAD_STRATEGY_LABELS[loadStrategy];
  return {
    bindingId: binding.bindingId,
    method: BINDING_UPDATE_STRATEGY_METHOD,
    params: { bindingId: binding.bindingId, loadStrategy },
    confirm: `确认将绑定 ${binding.bindingId} 的加载策略改为${label}？将调用 ${BINDING_UPDATE_STRATEGY_METHOD}，只改这一条。`,
    matches: (next) =>
      sameBinding(next, binding.bindingId, (row) => row.loadStrategy === loadStrategy),
  };
}

export async function requestBindingRowMutation(
  request: BindingMutationRequester["request"],
  mutation: BindingRowMutation,
): Promise<BindingMutationResult> {
  try {
    const payload = await request<{ binding?: RuntimeCapabilityBinding }>(
      mutation.method,
      mutation.params,
    );
    const binding = payload?.binding;
    if (!binding || !mutation.matches(binding)) {
      return { ok: false, error: "网关返回与请求不一致，未记为成功" };
    }
    return { ok: true, binding };
  } catch (error) {
    const message = error instanceof Error ? error.message : "绑定变更失败";
    return { ok: false, error: message };
  }
}
