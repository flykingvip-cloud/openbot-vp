import type {
  CapabilityRecommendation,
  InstallToRobotResponse,
} from "../capability/employee-capability/endpoints.ts";
import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import { normalizeCapabilityInstallPreflight } from "./capability-install-preflight.ts";

export type CapabilityRecommendationState = {
  gateway: EmployeeCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  agentId: string | null;
  recommendations: CapabilityRecommendation[];
  busyCapabilityId: string | null;
  installHints: Record<string, string>;
};

export function createInitialCapabilityRecommendationState(): CapabilityRecommendationState {
  return {
    gateway: null,
    loading: false,
    error: null,
    agentId: null,
    recommendations: [],
    busyCapabilityId: null,
    installHints: {},
  };
}

export async function loadRecommendations(
  state: CapabilityRecommendationState,
  agentId: string,
): Promise<void> {
  if (!state.gateway) {
    state.error = "暂时无法加载可增强的能力，请稍后再试";
    return;
  }
  state.loading = true;
  state.error = null;
  state.agentId = agentId;
  try {
    const response = await state.gateway.recommendations({ agentId });
    state.recommendations = response.recommendations;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = `加载可增强的能力失败：${message}`;
    state.recommendations = [];
  } finally {
    state.loading = false;
  }
}

export async function installRecommendation(
  state: CapabilityRecommendationState,
  capabilityId: string,
): Promise<InstallToRobotResponse | null> {
  if (!state.gateway || !state.agentId) {
    state.error = "暂时无法安装能力，请稍后再试";
    return null;
  }
  state.busyCapabilityId = capabilityId;
  state.error = null;
  try {
    const preflightRaw =
      typeof state.gateway.preflight === "function"
        ? await state.gateway.preflight({
            capabilityId,
            agentId: state.agentId,
          })
        : null;
    const preflight = normalizeCapabilityInstallPreflight(preflightRaw);
    if (preflight && !preflight.canInstall) {
      state.installHints = { ...state.installHints, [capabilityId]: preflight.nextStep };
      return null;
    }
    const response = await state.gateway.installToRobot({
      capabilityId,
      agentId: state.agentId,
    });
    const nextHints = { ...state.installHints };
    delete nextHints[capabilityId];
    state.installHints = nextHints;
    state.recommendations = state.recommendations.filter(
      (entry) => entry.capability.id !== capabilityId,
    );
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state.error = `安装能力失败：${message}`;
    return null;
  } finally {
    state.busyCapabilityId = null;
  }
}
