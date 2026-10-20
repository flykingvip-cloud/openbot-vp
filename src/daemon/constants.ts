import { LEGACY_GATEWAY_WINDOWS_TASK_NAMES as LEGACY_WINDOWS_GATEWAY_TASK_NAMES } from "../compat/legacy-names.js";

// Default service labels (canonical + legacy compatibility)
export const GATEWAY_LAUNCH_AGENT_LABEL = "ai.openbot.gateway";
export const GATEWAY_SYSTEMD_SERVICE_NAME = "openbot-gateway";
export const GATEWAY_WINDOWS_TASK_NAME = "OpenBot Gateway";
export const GATEWAY_SERVICE_MARKER = "openbot";
export const GATEWAY_SERVICE_KIND = "gateway";
export const NODE_LAUNCH_AGENT_LABEL = "ai.openbot.node";
export const NODE_SYSTEMD_SERVICE_NAME = "openbot-node";
export const NODE_WINDOWS_TASK_NAME = "OpenBot Node";
export const NODE_SERVICE_MARKER = "openbot";
export const NODE_SERVICE_KIND = "node";
export const NODE_WINDOWS_TASK_SCRIPT_NAME = "node.cmd";
export const LEGACY_GATEWAY_SYSTEMD_SERVICE_NAMES: string[] = [
  "clawdbot-gateway",
  "moltbot-gateway",
];
export const LEGACY_GATEWAY_WINDOWS_TASK_NAMES: string[] = [...LEGACY_WINDOWS_GATEWAY_TASK_NAMES];

function firstEnvValue(
  env: Record<string, string | undefined>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function resolveGatewayProfileFromEnv(
  env: Record<string, string | undefined>,
): string | undefined {
  return firstEnvValue(env, "OPENBOT_PROFILE", "OPENCLAW_PROFILE");
}

export function resolveGatewayServiceVersionFromEnv(
  env: Record<string, string | undefined>,
): string | undefined {
  return firstEnvValue(env, "OPENBOT_SERVICE_VERSION", "OPENCLAW_SERVICE_VERSION");
}

export function normalizeGatewayProfile(profile?: string): string | null {
  const trimmed = profile?.trim();
  if (!trimmed || trimmed.toLowerCase() === "default") {
    return null;
  }
  return trimmed;
}

export function resolveGatewayProfileSuffix(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `-${normalized}` : "";
}

export function resolveGatewayLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_LAUNCH_AGENT_LABEL;
  }
  return `ai.openbot.${normalized}`;
}

export function resolveGatewaySystemdServiceName(profile?: string): string {
  const suffix = resolveGatewayProfileSuffix(profile);
  if (!suffix) {
    return GATEWAY_SYSTEMD_SERVICE_NAME;
  }
  return `openbot-gateway${suffix}`;
}

export function resolveGatewayWindowsTaskName(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_WINDOWS_TASK_NAME;
  }
  return `OpenBot Gateway (${normalized})`;
}

export function formatGatewayServiceDescription(params?: {
  profile?: string;
  version?: string;
}): string {
  const profile = normalizeGatewayProfile(params?.profile);
  const version = params?.version?.trim();
  const parts: string[] = [];
  if (profile) {
    parts.push(`profile: ${profile}`);
  }
  if (version) {
    parts.push(`v${version}`);
  }
  if (parts.length === 0) {
    return "OpenBot Gateway";
  }
  return `OpenBot Gateway (${parts.join(", ")})`;
}

export function resolveGatewayServiceDescription(params: {
  env: Record<string, string | undefined>;
  environment?: Record<string, string | undefined>;
  description?: string;
}): string {
  return (
    params.description ??
    formatGatewayServiceDescription({
      profile: resolveGatewayProfileFromEnv(params.env),
      version:
        resolveGatewayServiceVersionFromEnv(params.environment ?? {}) ??
        resolveGatewayServiceVersionFromEnv(params.env),
    })
  );
}

export function resolveNodeLaunchAgentLabel(): string {
  return NODE_LAUNCH_AGENT_LABEL;
}

export function resolveNodeSystemdServiceName(): string {
  return NODE_SYSTEMD_SERVICE_NAME;
}

export function resolveNodeWindowsTaskName(): string {
  return NODE_WINDOWS_TASK_NAME;
}

export function formatNodeServiceDescription(params?: { version?: string }): string {
  const version = params?.version?.trim();
  if (!version) {
    return "OpenBot Node Host";
  }
  return `OpenBot Node Host (v${version})`;
}
