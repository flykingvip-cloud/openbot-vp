import { adaptSettingsHost } from "./app-host-adapters.ts";
import { applySettings } from "./app-settings.ts";
import { setGatewayCapabilityRuntimeTestHooks } from "./capability/gateway/runtime.ts";
import type { GatewayHost } from "./gateway-host.ts";
import { inferBasePathFromPathname } from "./navigation.ts";
import {
  resolvePreferredOpenBotGatewayUrl,
  resolveRecoveredGatewayUrlForHostMismatch,
} from "./routing/openbot-subdomain-redirect.ts";

let pageUrlOverrideForTests: string | null = null;

export function setAppGatewayPageUrlForTests(pageUrl: string | null) {
  const normalized = pageUrl?.trim() ?? "";
  pageUrlOverrideForTests = normalized || null;
}

export function setAppGatewayTestHooks(
  hooks: Parameters<typeof setGatewayCapabilityRuntimeTestHooks>[0],
) {
  if (hooks === null) {
    setAppGatewayPageUrlForTests(null);
  }
  setGatewayCapabilityRuntimeTestHooks(hooks);
}

function currentPageUrl(): string | undefined {
  if (pageUrlOverrideForTests) {
    return pageUrlOverrideForTests;
  }
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.location.href;
}

function resolveControlUiBasePathForGateway(): string | undefined {
  if (typeof window !== "undefined") {
    const configured = window.__OPENBOT_CONTROL_UI_BASE_PATH__;
    if (typeof configured === "string" && configured.trim()) {
      return configured.trim();
    }
  }
  const pageUrl = currentPageUrl();
  if (!pageUrl) {
    return undefined;
  }
  try {
    return inferBasePathFromPathname(new URL(pageUrl).pathname) || undefined;
  } catch {
    return undefined;
  }
}

function normalizeGatewayUrlForCurrentPage(gatewayUrl: string): string {
  const pageUrl = currentPageUrl();
  if (!pageUrl) {
    return gatewayUrl;
  }
  try {
    const page = new URL(pageUrl);
    return resolvePreferredOpenBotGatewayUrl({
      gatewayUrl,
      pageHost: page.host,
      pageProtocol: page.protocol,
      basePath: resolveControlUiBasePathForGateway(),
    });
  } catch {
    return gatewayUrl;
  }
}

export function persistGatewayUrlIfChanged(host: GatewayHost, gatewayUrl: string): string {
  const normalized = normalizeGatewayUrlForCurrentPage(gatewayUrl);
  if (normalized.trim() !== host.settings.gatewayUrl.trim()) {
    applySettings(adaptSettingsHost(host), {
      ...host.settings,
      gatewayUrl: normalized,
    });
  }
  return normalized;
}

export function recoverGatewayUrlForReconnect(
  host: GatewayHost,
  currentGatewayUrl: string,
): string | null {
  const recovered = resolveRecoveredGatewayUrlForHostMismatch({
    currentGatewayUrl,
    pageUrl: currentPageUrl(),
    basePath: resolveControlUiBasePathForGateway(),
  });
  if (!recovered) {
    return null;
  }
  if (recovered.trim() !== host.settings.gatewayUrl.trim()) {
    applySettings(adaptSettingsHost(host), {
      ...host.settings,
      gatewayUrl: recovered,
    });
  }
  return recovered;
}
