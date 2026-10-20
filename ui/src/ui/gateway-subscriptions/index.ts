/**
 * Gateway event dispatch — domain subscription modules wired in stable order.
 */

import { GATEWAY_EVENT_UPDATE_AVAILABLE } from "../../../../src/gateway/events.js";
import type { GatewayUpdateAvailableEventPayload } from "../../../../src/gateway/events.js";
import { adaptSettingsHost } from "../app-host-adapters.ts";
import { loadCron } from "../app-settings.ts";
import { devicesCapability } from "../capability/devices/index.ts";
import { adaptDevicesLoadCapabilityState } from "../capability/view-state.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";
import { canonicalizeTab } from "../navigation.ts";
import type { PresenceEntry } from "../types.ts";
import { handleAccountComputerLoginGatewayEvent } from "./account-computer-login.ts";
import { handleAgentGrowthGatewayEvent } from "./agent-growth.ts";
import { handleChatGatewaySubscription } from "./chat.ts";
import { handleCollaborationGatewayEvent } from "./collaboration.ts";
import { handleExecApprovalGatewayEvent } from "./exec-approval.ts";
import { handleLocalFileApprovalGatewayEvent } from "./local-file-approval.ts";
import { handleSecureFormGatewayEvent } from "./secure-form.ts";
import { handleSupervisorGatewayEvent } from "./supervisor.ts";
import { handleVaultSyncGatewayEvent } from "./vault-sync.ts";

export function dispatchGatewaySubscriptionEvent(host: GatewayHost, evt: GatewayEventFrame): void {
  const activeTab = canonicalizeTab(host.tab);
  host.eventLogBuffer = [
    { ts: Date.now(), event: evt.event, payload: evt.payload },
    ...host.eventLogBuffer,
  ].slice(0, 250);
  if (activeTab === "platformAdvanced") {
    host.eventLog = host.eventLogBuffer;
  }

  if (handleChatGatewaySubscription(host, evt)) {
    return;
  }
  if (handleCollaborationGatewayEvent(host, evt)) {
    return;
  }
  if (handleAgentGrowthGatewayEvent(host, evt)) {
    return;
  }

  if (evt.event === "presence") {
    const payload = evt.payload as { presence?: PresenceEntry[] } | undefined;
    if (payload?.presence && Array.isArray(payload.presence)) {
      host.presenceEntries = payload.presence;
      host.presenceError = null;
      host.presenceStatus = null;
    }
    return;
  }

  if (
    evt.event === "cron" &&
    (activeTab === "platformSystemSettings" || activeTab === "platformAdvanced")
  ) {
    void loadCron(adaptSettingsHost(host));
    return;
  }

  if (evt.event === "device.pair.requested" || evt.event === "device.pair.resolved") {
    void devicesCapability.load(adaptDevicesLoadCapabilityState(host), { quiet: true });
    return;
  }

  if (handleExecApprovalGatewayEvent(host, evt)) {
    return;
  }

  if (handleSecureFormGatewayEvent(host, evt)) {
    return;
  }

  if (handleAccountComputerLoginGatewayEvent(host, evt)) {
    return;
  }

  if (handleLocalFileApprovalGatewayEvent(host, evt)) {
    return;
  }

  if (handleSupervisorGatewayEvent(host, evt)) {
    return;
  }

  if (handleVaultSyncGatewayEvent(host, evt)) {
    return;
  }

  if (evt.event === GATEWAY_EVENT_UPDATE_AVAILABLE) {
    const payload = evt.payload as GatewayUpdateAvailableEventPayload | undefined;
    host.updateAvailable = payload?.updateAvailable ?? null;
  }
}
