import { WORKBENCH_SIGNALS_INVALIDATE_EVENT } from "../../../../src/gateway/workbench/signals-invalidate.ts";
import { adaptSpacesLoadCapabilityState } from "../capability/view-state.ts";
import { refreshWorkbenchSignals } from "../controllers/spaces.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";

const REFRESH_DEBOUNCE_MS = 250;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshHost: GatewayHost | null = null;

function scheduleInvalidateRefresh(host: GatewayHost): void {
  if (typeof window === "undefined") {
    return;
  }
  refreshHost = host;
  if (refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const target = refreshHost;
    refreshHost = null;
    if (!target?.connected || !target.client) {
      return;
    }
    void refreshWorkbenchSignals(adaptSpacesLoadCapabilityState(target));
  }, REFRESH_DEBOUNCE_MS);
}

/** @internal test helper */
export function resetWorkbenchSignalsInvalidateDebounceForTests(): void {
  if (typeof window !== "undefined" && refreshTimer !== null) {
    window.clearTimeout(refreshTimer);
  }
  refreshTimer = null;
  refreshHost = null;
}

export function handleWorkbenchSignalsGatewayEvent(
  host: GatewayHost,
  evt: GatewayEventFrame,
): boolean {
  if (evt.event !== WORKBENCH_SIGNALS_INVALIDATE_EVENT) {
    return false;
  }
  scheduleInvalidateRefresh(host);
  return true;
}
