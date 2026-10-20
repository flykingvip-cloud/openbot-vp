export const GATEWAY_CLIENT_IDS = {
  WEB_CLIPPER: "openbot-web-clipper",
  WEBCHAT_UI: "webchat-ui",
  CONTROL_UI: "openbot-control-ui",
  WEBCHAT: "webchat",
  CLI: "cli",
  GATEWAY_CLIENT: "gateway-client",
  MACOS_APP: "openbot-macos",
  IOS_APP: "openbot-ios",
  ANDROID_APP: "openbot-android",
  NODE_HOST: "node-host",
  TEST: "test",
  FINGERPRINT: "fingerprint",
  PROBE: "openbot-probe",
} as const;

export type GatewayClientId = (typeof GATEWAY_CLIENT_IDS)[keyof typeof GATEWAY_CLIENT_IDS];

/**
 * Back-compat client id aliases (pre-rebrand `openclaw-*` / `moltbot-*`).
 *
 * Older installed apps (e.g. a stale macOS menubar build) still send the legacy
 * client id; the connect-params schema rejected them after the openclaw→openbot
 * rename. We accept these aliases and normalize to the canonical id so previously
 * shipped clients keep connecting without a forced rebuild — consistent with the
 * repo's "openclaw remains a back-compat alias" policy (AGENTS.md naming).
 */
export const LEGACY_GATEWAY_CLIENT_ID_ALIASES: Readonly<Record<string, GatewayClientId>> = {
  "openclaw-macos": GATEWAY_CLIENT_IDS.MACOS_APP,
  "moltbot-macos": GATEWAY_CLIENT_IDS.MACOS_APP,
  "openclaw-ios": GATEWAY_CLIENT_IDS.IOS_APP,
  "openclaw-android": GATEWAY_CLIENT_IDS.ANDROID_APP,
  "openclaw-control-ui": GATEWAY_CLIENT_IDS.CONTROL_UI,
  "openclaw-probe": GATEWAY_CLIENT_IDS.PROBE,
};

/** All client id strings accepted on the wire (canonical + legacy aliases). */
export const ACCEPTED_GATEWAY_CLIENT_ID_VALUES: readonly string[] = [
  ...Object.values(GATEWAY_CLIENT_IDS),
  ...Object.keys(LEGACY_GATEWAY_CLIENT_ID_ALIASES),
];

// Back-compat naming (internal): these values are IDs, not display names.
export const GATEWAY_CLIENT_NAMES = GATEWAY_CLIENT_IDS;
export type GatewayClientName = GatewayClientId;

export const GATEWAY_CLIENT_MODES = {
  WEBCHAT: "webchat",
  CLI: "cli",
  UI: "ui",
  BACKEND: "backend",
  NODE: "node",
  PROBE: "probe",
  TEST: "test",
} as const;

export type GatewayClientMode = (typeof GATEWAY_CLIENT_MODES)[keyof typeof GATEWAY_CLIENT_MODES];

export type GatewayClientInfo = {
  id: GatewayClientId;
  displayName?: string;
  version: string;
  platform: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode: GatewayClientMode;
  instanceId?: string;
};

export const GATEWAY_CLIENT_CAPS = {
  TOOL_EVENTS: "tool-events",
} as const;

export type GatewayClientCap = (typeof GATEWAY_CLIENT_CAPS)[keyof typeof GATEWAY_CLIENT_CAPS];

const GATEWAY_CLIENT_ID_SET = new Set<GatewayClientId>(Object.values(GATEWAY_CLIENT_IDS));
const GATEWAY_CLIENT_MODE_SET = new Set<GatewayClientMode>(Object.values(GATEWAY_CLIENT_MODES));

export function normalizeGatewayClientId(raw?: string | null): GatewayClientId | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (GATEWAY_CLIENT_ID_SET.has(normalized as GatewayClientId)) {
    return normalized as GatewayClientId;
  }
  // Map legacy (pre-rebrand) aliases to their canonical id.
  return LEGACY_GATEWAY_CLIENT_ID_ALIASES[normalized];
}

export function isGatewayControlUiClientId(raw?: string | null): boolean {
  return normalizeGatewayClientId(raw) === GATEWAY_CLIENT_IDS.CONTROL_UI;
}

export function normalizeGatewayClientName(raw?: string | null): GatewayClientName | undefined {
  return normalizeGatewayClientId(raw);
}

export function normalizeGatewayClientMode(raw?: string | null): GatewayClientMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return GATEWAY_CLIENT_MODE_SET.has(normalized as GatewayClientMode)
    ? (normalized as GatewayClientMode)
    : undefined;
}

export function hasGatewayClientCap(
  caps: string[] | null | undefined,
  cap: GatewayClientCap,
): boolean {
  if (!Array.isArray(caps)) {
    return false;
  }
  return caps.includes(cap);
}
