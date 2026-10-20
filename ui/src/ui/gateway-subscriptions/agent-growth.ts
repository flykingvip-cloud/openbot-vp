/**
 * Agent growth lifecycle WS events → refresh workbench growth state.
 */

import { recomputeGrowth } from "../controllers/agent-growth.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";
import {
  resolveGrowthEntityFromSessionKey,
  type GrowthSessionSyncHost,
} from "../ports/employee/growth-session-sync.ts";

function asGrowthHost(host: GatewayHost): GrowthSessionSyncHost | null {
  if (!("workbenchActiveGrowthStatus" in host)) {
    return null;
  }
  return host as GatewayHost & GrowthSessionSyncHost;
}

export function handleAgentGrowthGatewayEvent(host: GatewayHost, evt: GatewayEventFrame): boolean {
  if (evt.event !== "agent_growth.false_ready_detected") {
    return false;
  }
  const growthHost = asGrowthHost(host);
  if (!growthHost?.client || !growthHost.connected) {
    return true;
  }
  const payload = evt.payload as { agentId?: string; groupId?: string } | undefined;
  const ref = resolveGrowthEntityFromSessionKey(growthHost.sessionKey ?? "");
  if (!ref) {
    return true;
  }
  if (ref.kind === "robot" && payload?.agentId && ref.entityId !== payload.agentId.trim()) {
    return true;
  }
  if (ref.kind === "group" && payload?.groupId && ref.entityId !== payload.groupId.trim()) {
    return true;
  }
  void recomputeGrowth(growthHost, ref, {
    preferCultivate: growthHost.workbenchGrowthPreferCultivate === true,
  }).then((status) => {
    growthHost.workbenchActiveGrowthStatus = status;
    growthHost.requestUpdate?.();
  });
  return true;
}
