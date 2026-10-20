/**
 * Supervisor task events — isolated gateway subscription (development-supervisor).
 */

import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";

export function handleSupervisorGatewayEvent(host: GatewayHost, evt: GatewayEventFrame): boolean {
  if (evt.event !== "supervisor.task.event" || typeof window === "undefined") {
    return false;
  }
  window.dispatchEvent(new CustomEvent("openbot:supervisor-task-event", { detail: evt.payload }));
  return true;
}
