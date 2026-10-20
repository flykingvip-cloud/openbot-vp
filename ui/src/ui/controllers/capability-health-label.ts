import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import { HEALTH_LABEL_MAP } from "../capability/employee-capability/projection.ts";
import type { CapabilityHealthLabel } from "../capability/employee-capability/types.ts";

export type RuntimeHealthStatus = "healthy" | "warning" | "broken";

export type CapabilityHealthLabelState = {
  gateway: EmployeeCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  subscriptionId: string | null;
  labels: Record<string, CapabilityHealthLabel>;
};

export function createInitialCapabilityHealthLabelState(): CapabilityHealthLabelState {
  return {
    gateway: null,
    loading: false,
    error: null,
    subscriptionId: null,
    labels: {},
  };
}

export function projectHealthStatusToLabel(status: RuntimeHealthStatus): CapabilityHealthLabel {
  return HEALTH_LABEL_MAP[status];
}

export async function subscribeHealthLabel(
  state: CapabilityHealthLabelState,
  capabilityIds: string[],
  onLabel?: (capabilityId: string, label: CapabilityHealthLabel) => void,
): Promise<void> {
  if (!state.gateway) {
    state.error = "暂时无法加载健康标签，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;

  try {
    const response = await state.gateway.healthLabelSubscribe({ capabilityIds });
    state.subscriptionId = response.subscriptionId;
    for (const entry of response.initialLabels) {
      state.labels[entry.capabilityId] = entry.health;
      onLabel?.(entry.capabilityId, entry.health);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = `加载健康标签失败：${message}`;
  } finally {
    state.loading = false;
  }
}
