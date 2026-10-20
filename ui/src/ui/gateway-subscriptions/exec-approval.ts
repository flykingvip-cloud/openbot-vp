/**
 * Exec approval gateway events — isolated subscription module.
 */

import { execApprovalCapability } from "../capability/exec-approval/index.ts";
import { adaptExecApprovalEventCapabilityState } from "../capability/view-state.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";

export function handleExecApprovalGatewayEvent(host: GatewayHost, evt: GatewayEventFrame): boolean {
  if (evt.event === "exec.approval.requested") {
    const eventState = adaptExecApprovalEventCapabilityState(host);
    const entry = execApprovalCapability.parseRequested(evt.payload);
    if (entry) {
      execApprovalCapability.addQueueEntry(eventState, entry);
      const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
      window.setTimeout(() => {
        execApprovalCapability.removeQueueEntry(eventState, entry.id);
      }, delay);
    }
    return true;
  }

  if (evt.event === "exec.approval.resolved") {
    const eventState = adaptExecApprovalEventCapabilityState(host);
    const resolved = execApprovalCapability.parseResolved(evt.payload);
    if (resolved) {
      execApprovalCapability.removeQueueEntry(eventState, resolved.id);
    }
    return true;
  }

  return false;
}
