import type { ControlUiPlatformAuthState } from "../../../../src/gateway/control-ui-contract.js";
import { matchTabRoute } from "../navigation.ts";
import { resolvePortFromSubdomain } from "../routing/subdomain-resolver.ts";
import { switchPlatformAuthSessionKind, type PlatformAuthHost } from "./platform-auth.ts";

export type EnterprisePortSessionAlignHost = PlatformAuthHost & {
  settings?: { recentEnterpriseTenantIds?: string[] };
  hello?: { auth?: { tenantId?: string | null } } | null;
  bootstrapAuthSession?: { tenantId?: string | null } | null;
};

type AlignableSessionKind = "member" | "platform-admin" | "platform-super-admin";

const ALIGNABLE_SESSION_KINDS = new Set<string>([
  "member",
  "platform-admin",
  "platform-super-admin",
]);

let pendingAlign: Promise<boolean> | null = null;
let pendingAlignKey: string | null = null;
const failedAlignKeys = new Set<string>();

/** @internal test helper */
export function resetEnterprisePortSessionAlignForTests() {
  pendingAlign = null;
  pendingAlignKey = null;
  failedAlignKeys.clear();
}

export function isEnterprisePortHost(pageHost?: string | null): boolean {
  if (typeof window === "undefined" && !pageHost) {
    return false;
  }
  const host = (pageHost ?? window.location.host).trim();
  return resolvePortFromSubdomain(host).port === "enterprise";
}

export function isAlignableEnterprisePortSessionKind(
  sessionKind: ControlUiPlatformAuthState["sessionKind"] | undefined,
): sessionKind is AlignableSessionKind {
  return typeof sessionKind === "string" && ALIGNABLE_SESSION_KINDS.has(sessionKind);
}

/**
 * Shared-cookie multi-port: the last login on www/admin may leave a member or
 * platform session on biz. When the same account also has enterprise-admin,
 * auto-switch to that identity for the enterprise entry.
 */
export function shouldAlignEnterprisePortSession(
  host: Pick<EnterprisePortSessionAlignHost, "platformAuthState">,
  pageHost?: string | null,
): boolean {
  if (!isEnterprisePortHost(pageHost)) {
    return false;
  }
  return isAlignableEnterprisePortSessionKind(host.platformAuthState?.sessionKind);
}

export function resolveEnterprisePortAlignTenantId(
  host: EnterprisePortSessionAlignHost,
  basePath = "",
): string | undefined {
  const candidates = [
    host.platformAuthState?.enterprise?.id,
    host.platformAuthState?.session?.tenantId,
    host.bootstrapAuthSession?.tenantId,
    host.hello?.auth?.tenantId,
    host.settings?.recentEnterpriseTenantIds?.[0],
  ];
  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed) {
      return trimmed;
    }
  }
  if (typeof window !== "undefined") {
    const fromRoute = matchTabRoute(
      window.location.pathname,
      basePath || host.basePath || "",
    )?.context?.tenantId?.trim();
    if (fromRoute) {
      return fromRoute;
    }
  }
  return undefined;
}

function buildAlignKey(host: EnterprisePortSessionAlignHost, tenantId?: string): string {
  const sessionKind = host.platformAuthState?.sessionKind ?? "none";
  const user =
    host.platformAuthState?.session?.user?.trim().toLowerCase() ||
    host.bootstrapAuthSession?.user?.trim().toLowerCase() ||
    "anonymous";
  return `${sessionKind}:${user}:${tenantId ?? "*"}`;
}

/**
 * Returns true when the active session is (or was just switched to) enterprise-admin.
 * Failed attempts are remembered per session/user/tenant so we do not loop.
 */
export async function ensureEnterprisePortSessionAligned(
  host: EnterprisePortSessionAlignHost,
  options?: { pageHost?: string | null },
): Promise<boolean> {
  if (host.platformAuthState?.sessionKind === "enterprise-admin") {
    return true;
  }
  if (!shouldAlignEnterprisePortSession(host, options?.pageHost)) {
    return false;
  }

  const tenantId = resolveEnterprisePortAlignTenantId(host);
  const alignKey = buildAlignKey(host, tenantId);
  if (failedAlignKeys.has(alignKey)) {
    return false;
  }
  if (pendingAlign && pendingAlignKey === alignKey) {
    return pendingAlign;
  }

  pendingAlignKey = alignKey;
  pendingAlign = (async () => {
    const ok = await switchPlatformAuthSessionKind(
      host,
      {
        targetSessionKind: "enterprise-admin",
        tenantId,
      },
      { quiet: true },
    );
    if (ok && host.platformAuthState?.sessionKind === "enterprise-admin") {
      return true;
    }
    failedAlignKeys.add(alignKey);
    return false;
  })().finally(() => {
    if (pendingAlignKey === alignKey) {
      pendingAlign = null;
      pendingAlignKey = null;
    }
  });

  return pendingAlign;
}

export function ensureEnterprisePortSessionAlignedFireAndForget(
  host: EnterprisePortSessionAlignHost,
  options?: { pageHost?: string | null },
): void {
  if (!shouldAlignEnterprisePortSession(host, options?.pageHost)) {
    return;
  }
  void ensureEnterprisePortSessionAligned(host, options);
}
