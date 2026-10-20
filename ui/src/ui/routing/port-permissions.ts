import type {
  ControlUiAuthMode,
  ControlUiPlatformAuthState,
  ControlUiTrustedProxySession,
} from "../../../../src/gateway/control-ui-contract.js";
import {
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  authorizeOperatorScopesForMethod,
} from "../../../../src/gateway/method-scopes.js";
import { portForTab, type Tab } from "../navigation.ts";
import type { ControlPort, CrossPortContext, FrontendPort } from "./cross-port-context.ts";
import { resolvePortFromSubdomain } from "./subdomain-resolver.ts";

export type PermissionStateLike = {
  bootstrapAuthMode?: ControlUiAuthMode | null;
  bootstrapAuthSession?: ControlUiTrustedProxySession | null;
  platformAuthState?: ControlUiPlatformAuthState | null;
};

export type UiPermissionRole =
  | "local-operator"
  | "operator"
  | "enterprise-admin"
  | "enterprise-member"
  | "employee";

export type UiPermissionSnapshot = {
  role: UiPermissionRole;
  tenantId: string | null;
  scopes: string[];
  readablePorts: FrontendPort[];
  writablePorts: ControlPort[];
};

const ALL_CONTROL_PORTS: ControlPort[] = ["platform", "enterprise", "ops"];
const READ_LIKE_SCOPES = new Set<string>([READ_SCOPE, WRITE_SCOPE, ADMIN_SCOPE]);
const OPS_LIKE_SCOPES = new Set<string>([
  READ_SCOPE,
  WRITE_SCOPE,
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
]);

function normalizeScopes(scopes: readonly string[] | null | undefined): string[] {
  const unique = new Set<string>();
  for (const scope of scopes ?? []) {
    const normalized = typeof scope === "string" ? scope.trim() : "";
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function resolveTrustedSession(input: PermissionStateLike): ControlUiTrustedProxySession | null {
  return input.platformAuthState?.session ?? input.bootstrapAuthSession ?? null;
}

export function resolveUiPermissionSnapshot(input: PermissionStateLike): UiPermissionSnapshot {
  const session = resolveTrustedSession(input);
  const scopes = normalizeScopes(session?.scopes);
  const hasTrustedProxy =
    input.bootstrapAuthMode === "trusted-proxy" || session?.provider === "trusted-proxy";
  const membershipRole = input.platformAuthState?.membershipRole;
  const isPlatformAdmin =
    input.platformAuthState?.sessionKind === "platform-admin" ||
    input.platformAuthState?.sessionKind === "platform-super-admin";
  const hasOperatorRole = session?.role === "operator";
  const hasReadLikeScope =
    hasOperatorRole && scopes.length === 0
      ? true
      : scopes.some((scope) => READ_LIKE_SCOPES.has(scope));
  const hasOpsLikeScope =
    hasOperatorRole && scopes.length === 0
      ? true
      : scopes.some((scope) => OPS_LIKE_SCOPES.has(scope));

  if (!hasTrustedProxy && !session) {
    return {
      role: "local-operator",
      tenantId: null,
      scopes: [],
      readablePorts: ["employee", ...ALL_CONTROL_PORTS],
      writablePorts: [...ALL_CONTROL_PORTS],
    };
  }

  // Trusted-proxy is enabled but no actual session has been forwarded yet
  // (e.g. user landed on the gateway without proxy headers, or the platform
  // auth flow hasn't completed). Treat this like the no-auth bootstrap state
  // so the user can still browse local-operator surfaces; otherwise the
  // initial `/platform` landing would silently downgrade to the public
  // homepage on the first nav click after bootstrap completes.
  if (hasTrustedProxy && !session) {
    return {
      role: "local-operator",
      tenantId: null,
      scopes: [],
      readablePorts: ["employee", ...ALL_CONTROL_PORTS],
      writablePorts: [...ALL_CONTROL_PORTS],
    };
  }

  if (isPlatformAdmin) {
    const readablePorts: FrontendPort[] = ["employee", "enterprise"];
    if (hasReadLikeScope || hasOperatorRole) {
      readablePorts.push("platform");
    }
    if (hasOpsLikeScope || hasOperatorRole) {
      readablePorts.push("ops");
    }
    return {
      role: "operator",
      tenantId: session?.tenantId?.trim() || null,
      scopes,
      readablePorts,
      writablePorts: hasOperatorRole ? [...ALL_CONTROL_PORTS] : [],
    };
  }

  if (membershipRole === "enterprise-admin") {
    return {
      role: "enterprise-admin",
      tenantId: session?.tenantId?.trim() || null,
      scopes,
      readablePorts: ["employee", "enterprise"],
      writablePorts: ["enterprise"],
    };
  }

  if (membershipRole === "member") {
    return {
      role: "enterprise-member",
      tenantId: session?.tenantId?.trim() || null,
      scopes,
      readablePorts: ["employee", "enterprise"],
      writablePorts: [],
    };
  }

  if (hasOperatorRole || hasReadLikeScope || hasOpsLikeScope) {
    const readablePorts: FrontendPort[] = ["employee", "enterprise"];
    if (hasReadLikeScope) {
      readablePorts.push("platform");
    }
    if (hasOpsLikeScope) {
      readablePorts.push("ops");
    }
    const writablePorts: ControlPort[] = [];
    if (scopes.includes(ADMIN_SCOPE)) {
      writablePorts.push(...ALL_CONTROL_PORTS);
    }
    return {
      role: "operator",
      tenantId: session?.tenantId?.trim() || null,
      scopes,
      readablePorts,
      writablePorts,
    };
  }

  return {
    role: "employee",
    tenantId: null,
    scopes,
    readablePorts: ["employee"],
    writablePorts: [],
  };
}

export function canAccessPort(input: PermissionStateLike, port: FrontendPort): boolean {
  return resolveUiPermissionSnapshot(input).readablePorts.includes(port);
}

export function canAccessTab(input: PermissionStateLike, tab: Tab): boolean {
  return canAccessPort(input, portForTab(tab));
}

export function filterTabsByPermission<TTab extends Tab>(
  input: PermissionStateLike,
  tabs: readonly TTab[],
): TTab[] {
  return tabs.filter((tab) => canAccessTab(input, tab));
}

/**
 * When a requested tab is forbidden, fall back to the login/home surface for the
 * current OpenBot subdomain instead of always bouncing to the employee shell.
 * admin → platformLogin, biz → enterpriseLogin, otherwise → me.
 */
export function resolveUnauthorizedFallbackTab(host?: string | null): Tab {
  const pageHost =
    host?.trim() || (typeof window !== "undefined" ? window.location.host.trim() : "");
  if (!pageHost) {
    return "me";
  }
  const port = resolvePortFromSubdomain(pageHost).port;
  if (port === "platform") {
    return "platformLogin";
  }
  if (port === "enterprise") {
    return "enterpriseLogin";
  }
  return "me";
}

export function resolveAuthorizedTab(
  input: PermissionStateLike,
  requestedTab: Tab,
  host?: string | null,
): Tab {
  if (canAccessTab(input, requestedTab)) {
    return requestedTab;
  }
  return resolveUnauthorizedFallbackTab(host);
}

export function canExecuteGatewayMethod(input: PermissionStateLike, method: string): boolean {
  const snapshot = resolveUiPermissionSnapshot(input);
  if (snapshot.role === "local-operator") {
    return true;
  }
  return authorizeOperatorScopesForMethod(method, snapshot.scopes).allowed;
}

const PORT_CONTEXT_KEYS: Record<FrontendPort, Array<keyof CrossPortContext>> = {
  employee: ["agentId", "userId", "groupId", "sourcePort", "sourcePage"],
  enterprise: [
    "tenantId",
    "capabilityId",
    "enterpriseCapabilityRoute",
    "usageManagementRoute",
    "userId",
    "groupId",
    "runtimeId",
    "executionId",
    "sourcePort",
    "sourcePage",
  ],
  platform: [
    "tenantId",
    "agentId",
    "capabilityId",
    "runtimeId",
    "incidentId",
    "sourcePort",
    "sourcePage",
  ],
  ops: [
    "tenantId",
    "agentId",
    "capabilityId",
    "runtimeId",
    "executionId",
    "incidentId",
    "sourcePort",
    "sourcePage",
  ],
};

export function sanitizeCrossPortContextForPort(
  port: FrontendPort,
  context: CrossPortContext | null | undefined,
): CrossPortContext | null {
  if (!context) {
    return null;
  }
  const allowedKeys = PORT_CONTEXT_KEYS[port];
  const next: CrossPortContext = {};
  for (const key of allowedKeys) {
    const value = context[key];
    if (typeof value === "string" && value.trim()) {
      if (
        key === "sourcePort" &&
        (value === "platform" || value === "enterprise" || value === "ops")
      ) {
        next.sourcePort = value;
        continue;
      }
      if (key !== "sourcePort") {
        next[key] = value.trim();
      }
    }
  }
  return Object.keys(next).length > 0 ? next : null;
}
