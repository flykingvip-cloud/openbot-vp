import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import type { CapabilityUsageBrief } from "../capability/employee-capability/types.ts";

export type CapabilityUsageBriefState = {
  gateway: EmployeeCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  capabilityId: string | null;
  usage: CapabilityUsageBrief | null;
};

export function createInitialCapabilityUsageBriefState(): CapabilityUsageBriefState {
  return {
    gateway: null,
    loading: false,
    error: null,
    capabilityId: null,
    usage: null,
  };
}

export function requiresUsageBriefConfirmation(usage: CapabilityUsageBrief | null): boolean {
  return Boolean(usage && usage.robots.length > 0);
}

export const shouldConfirmBeforeCapabilityChange = requiresUsageBriefConfirmation;

export async function loadUsageBrief(
  state: CapabilityUsageBriefState,
  capabilityId: string,
): Promise<CapabilityUsageBrief | null> {
  if (!state.gateway) {
    state.error = "暂时无法加载使用简述，请稍后再试";
    return null;
  }

  state.loading = true;
  state.error = null;
  state.capabilityId = capabilityId;

  try {
    const response = await state.gateway.usageBrief({ capabilityId });
    state.usage = response.usage;
    return response.usage;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = `加载使用简述失败：${message}`;
    state.usage = null;
    return null;
  } finally {
    state.loading = false;
  }
}
