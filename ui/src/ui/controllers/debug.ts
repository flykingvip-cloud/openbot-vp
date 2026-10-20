import type { GatewayBrowserClient } from "../gateway.ts";
import type { HealthSnapshot, StatusSummary } from "../types.ts";

export type DebugState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  debugLoading: boolean;
  debugModelProbeLoading: boolean;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugModelProbeSummary: unknown;
  debugModelProbeError: string | null;
  debugHeartbeat: unknown;
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
};

export type DebugLoadState = Pick<
  DebugState,
  | "client"
  | "connected"
  | "debugLoading"
  | "debugModelProbeLoading"
  | "debugStatus"
  | "debugHealth"
  | "debugModels"
  | "debugModelProbeSummary"
  | "debugModelProbeError"
  | "debugHeartbeat"
  | "debugCallError"
>;

export type DebugProbeModelsState = Pick<
  DebugState,
  | "client"
  | "connected"
  | "debugModelProbeLoading"
  | "debugModelProbeSummary"
  | "debugModelProbeError"
>;

export type DebugCallState = Pick<
  DebugState,
  | "client"
  | "connected"
  | "debugCallMethod"
  | "debugCallParams"
  | "debugCallResult"
  | "debugCallError"
>;

export async function loadDebug(state: DebugLoadState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.debugLoading) {
    return;
  }
  state.debugLoading = true;
  try {
    const [status, health, models, heartbeat] = await Promise.all([
      state.client.request("status", {}),
      state.client.request("health", {}),
      state.client.request("models.list", {}),
      state.client.request("last-heartbeat", {}),
    ]);
    state.debugStatus = status as StatusSummary;
    state.debugHealth = health as HealthSnapshot;
    const modelPayload = models as { models?: unknown[] } | undefined;
    state.debugModels = Array.isArray(modelPayload?.models) ? modelPayload?.models : [];
    state.debugHeartbeat = heartbeat;
  } catch (err) {
    state.debugCallError = String(err);
  } finally {
    state.debugLoading = false;
  }
}

export async function callDebugMethod(state: DebugCallState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.debugCallError = null;
  state.debugCallResult = null;
  try {
    const params = state.debugCallParams.trim()
      ? (JSON.parse(state.debugCallParams) as unknown)
      : {};
    const res = await state.client.request(state.debugCallMethod.trim(), params);
    state.debugCallResult = JSON.stringify(res, null, 2);
  } catch (err) {
    state.debugCallError = String(err);
  }
}

export async function probeModels(
  state: DebugProbeModelsState,
  params?: {
    provider?: string;
    modelRef?: string;
    timeoutMs?: number;
    concurrency?: number;
    maxTokens?: number;
  },
) {
  if (!state.client || !state.connected) {
    return null;
  }
  if (state.debugModelProbeLoading) {
    return null;
  }
  state.debugModelProbeLoading = true;
  state.debugModelProbeError = null;
  try {
    state.debugModelProbeSummary = await state.client.request("models.probe", {
      ...(params?.provider ? { provider: params.provider } : {}),
      ...(params?.modelRef ? { modelRef: params.modelRef } : {}),
      ...(params?.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
      ...(params?.concurrency ? { concurrency: params.concurrency } : {}),
      ...(params?.maxTokens ? { maxTokens: params.maxTokens } : {}),
    });
    return state.debugModelProbeSummary;
  } catch (err) {
    state.debugModelProbeError = String(err);
    return null;
  } finally {
    state.debugModelProbeLoading = false;
  }
}
