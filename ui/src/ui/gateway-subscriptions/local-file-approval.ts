/**
 * Local disk read approval gateway events — isolated subscription module.
 *
 * The auto-expire timer matters more here than for exec approvals: the gateway
 * treats a timeout as a denial, so a card left on screen past its window would be
 * showing buttons that no longer decide anything.
 */

import { localFileApprovalCapability } from "../capability/local-file-approval/index.ts";
import { adaptLocalFileApprovalEventCapabilityState } from "../capability/view-state.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";

export function handleLocalFileApprovalGatewayEvent(
  host: GatewayHost,
  evt: GatewayEventFrame,
): boolean {
  if (evt.event === "localFiles.approval.requested") {
    const eventState = adaptLocalFileApprovalEventCapabilityState(host);
    const entry = localFileApprovalCapability.parseRequested(evt.payload);
    if (entry) {
      localFileApprovalCapability.addQueueEntry(eventState, entry);
      const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
      // `globalThis` rather than `window`: identical in the browser, but it also
      // lets this module be exercised in a node test environment. The sibling
      // exec-approval module uses `window` and therefore cannot be unit tested.
      globalThis.setTimeout(() => {
        localFileApprovalCapability.removeQueueEntry(eventState, entry.id);
      }, delay);
    }
    return true;
  }

  if (evt.event === "localFiles.approval.resolved") {
    const eventState = adaptLocalFileApprovalEventCapabilityState(host);
    const resolved = localFileApprovalCapability.parseResolved(evt.payload);
    if (resolved) {
      localFileApprovalCapability.removeQueueEntry(eventState, resolved.id);
    }
    return true;
  }

  return false;
}
