import type {
  ChatAbortHost,
  ChatHistoryHost,
  ChatQueueHost,
  ChatRefreshHost,
  ChatSendHost,
} from "./app-chat.ts";
import type { GatewayHost } from "./app-gateway.ts";
import type { LifecycleHost } from "./app-lifecycle.ts";
import type { PollingHost } from "./app-polling.ts";
import type { ScrollHost } from "./app-scroll.ts";
import type { SettingsHost } from "./app-settings.ts";
import type { ToolStreamHost } from "./app-tool-stream.ts";
import type { OpenBotApp } from "./app.ts";
import type { DevicesCapabilityLoadState } from "./capability/devices/index.ts";
import type { DaibaiState } from "./controllers/daibai.ts";
import type { PlatformAuthHost } from "./controllers/platform-auth.ts";

/**
 * Transitional host adapters used to centralize structural casts while the UI
 * shell still passes a single mutable app object through multiple seams.
 */
export function adaptOpenBotAppHost(value: object): OpenBotApp {
  return value as OpenBotApp;
}

export function adaptSettingsHost(value: object): SettingsHost {
  return value as SettingsHost;
}

export function adaptGatewayHost(value: object): GatewayHost {
  return value as GatewayHost;
}

export function adaptDevicesLoadCapabilityState(value: object): DevicesCapabilityLoadState {
  return value as DevicesCapabilityLoadState;
}

export function adaptPollingHost(value: object): PollingHost {
  return value as PollingHost;
}

export function adaptScrollHost(value: object): ScrollHost {
  return value as ScrollHost;
}

export function adaptToolStreamHost(value: object): ToolStreamHost {
  return value as ToolStreamHost;
}

export function adaptChatAbortHost(value: object): ChatAbortHost {
  return value as ChatAbortHost;
}

export function adaptChatHistoryHost(value: object): ChatHistoryHost {
  return value as ChatHistoryHost;
}

export function adaptChatRefreshHost(value: object): ChatRefreshHost {
  return value as ChatRefreshHost;
}

export function adaptChatSendHost(value: object): ChatSendHost {
  return value as ChatSendHost;
}

export function adaptChatQueueHost(value: object): ChatQueueHost {
  return value as ChatQueueHost;
}

export function adaptLifecycleHost(value: object): LifecycleHost {
  return value as LifecycleHost;
}

export function adaptDaibaiState(value: object): DaibaiState {
  return value as DaibaiState;
}

export function adaptPlatformAuthHost(value: object): PlatformAuthHost {
  return value as PlatformAuthHost;
}

export function adaptEnterpriseOperationalIdentityHost(
  value: object,
): import("./controllers/enterprise-operational-identity.ts").EnterpriseOperationalIdentityHost {
  return value as import("./controllers/enterprise-operational-identity.ts").EnterpriseOperationalIdentityHost;
}
