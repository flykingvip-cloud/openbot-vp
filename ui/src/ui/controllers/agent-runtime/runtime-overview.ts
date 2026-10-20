import { createAgentRuntimeGateway } from "../../capability/agent-runtime/gateway-client.ts";
import type { RuntimeKpiData, TelemetryWindow } from "../../capability/agent-runtime/index.ts";
import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
  RuntimeGovernanceIssue,
  RuntimeTelemetry,
} from "../../capability/runtime-canonical/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";

export type RuntimeOverviewState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  runtimeOverviewLoading: boolean;
  runtimeOverviewError: string | null;
  runtimeAgents: RuntimeAgent[];
  runtimeBindings: RuntimeCapabilityBinding[];
  runtimeTelemetry: RuntimeTelemetry[];
  runtimeGovernanceIssues: RuntimeGovernanceIssue[];
  runtimeKpi: RuntimeKpiData | null;
};

export async function loadRuntimeOverview(
  state: RuntimeOverviewState,
  options?: { telemetryWindow?: TelemetryWindow },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.runtimeOverviewLoading) {
    return;
  }

  state.runtimeOverviewLoading = true;
  state.runtimeOverviewError = null;
  try {
    const gateway = createAgentRuntimeGateway(state.client);
    const [agentsRes, bindingsRes, governanceRes, kpiRes, telemetryRes] = await Promise.all([
      gateway.listAgents({
        lifecycle: null,
        health: null,
        tenantId: null,
        searchQuery: "",
      }),
      gateway.listBindings({
        runtimeAgentId: null,
        capabilityId: null,
        bindingType: null,
        bindingState: null,
        health: null,
      }),
      gateway.listGovernanceIssues({
        category: null,
        severity: null,
        includeAcknowledged: false,
      }),
      gateway.getRuntimeKpi({}),
      gateway.listTelemetry({
        runtimeAgentId: null,
        capabilityId: null,
        window: options?.telemetryWindow ?? "7d",
      }),
    ]);

    state.runtimeAgents = agentsRes.agents;
    state.runtimeBindings = bindingsRes.bindings;
    state.runtimeTelemetry = telemetryRes.samples;
    state.runtimeGovernanceIssues = governanceRes.issues;
    state.runtimeKpi = kpiRes.kpi;
  } catch (error) {
    state.runtimeOverviewError = error instanceof Error ? error.message : "加载 Runtime 概览失败";
  } finally {
    state.runtimeOverviewLoading = false;
  }
}
