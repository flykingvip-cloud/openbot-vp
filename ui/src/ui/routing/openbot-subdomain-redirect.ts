import { canonicalizeTab, pathForTab, portForTab, type Tab } from "../navigation.ts";
import { canonicalizeEmployeeCloudGatewayUrl } from "./canonical-employee-gateway.ts";
import type { FrontendPort } from "./cross-port-context.ts";
import {
  isLegacyEmployeeSubdomainHost,
  originForPort,
  resolvePortFromSubdomain,
  subdomainForPort,
} from "./subdomain-resolver.ts";

/** Tabs that may stay on the public marketing host (bare apex only). */
const PUBLIC_HOME_ALLOWED_TABS = new Set<Tab>(["me", "pricing"]);

function originProtocolFromPageProtocol(pageProtocol: string): "http" | "https" {
  return pageProtocol === "http:" ? "http" : "https";
}

function portsShareHost(left: FrontendPort, right: FrontendPort): boolean {
  return subdomainForPort(left) === subdomainForPort(right);
}

function buildCrossHostRedirectUrl(params: {
  host: string;
  targetPort: FrontendPort;
  pathname: string;
  search?: string;
  hash?: string;
  protocol?: string;
}): string | null {
  const pageProtocol = params.protocol ?? "https:";
  const targetOrigin = originForPort(
    params.targetPort,
    originProtocolFromPageProtocol(pageProtocol),
  );
  try {
    const current = new URL(`${pageProtocol}//${params.host}`);
    const target = new URL(targetOrigin);
    if (current.hostname === target.hostname && current.port === target.port) {
      return null;
    }
    return new URL(
      `${params.pathname}${params.search ?? ""}${params.hash ?? ""}`,
      targetOrigin,
    ).toString();
  } catch {
    return null;
  }
}

/**
 * When the current OpenBot host does not own the requested tab's port, return
 * the absolute URL on the canonical subdomain (www / biz / admin).
 *
 * - Public home (bare apex): only `me` + `pricing` stay; login and console
 *   tabs jump to their port hosts.
 * - Legacy gw host: always canonicalize to www for employee surfaces.
 * - Port subdomains: e.g. admin + enterpriseLogin → biz.
 * - Non-OpenBot hosts (localhost, self-host): never redirect.
 */
export function resolveOpenBotSubdomainRedirectUrl(params: {
  host: string;
  tab: Tab;
  pathname: string;
  search?: string;
  hash?: string;
  protocol?: string;
}): string | null {
  const resolution = resolvePortFromSubdomain(params.host);
  if (!resolution.isOpenBotDomain) {
    return null;
  }

  const tab = canonicalizeTab(params.tab);
  const targetPort = portForTab(tab);

  if (isLegacyEmployeeSubdomainHost(params.host) && targetPort === "employee") {
    return buildCrossHostRedirectUrl({
      host: params.host,
      targetPort: "employee",
      pathname: params.pathname,
      search: params.search,
      hash: params.hash,
      protocol: params.protocol,
    });
  }

  if (resolution.isPublicHome) {
    if (PUBLIC_HOME_ALLOWED_TABS.has(tab)) {
      return null;
    }
    return buildCrossHostRedirectUrl({
      host: params.host,
      targetPort,
      pathname: params.pathname,
      search: params.search,
      hash: params.hash,
      protocol: params.protocol,
    });
  }

  if (!resolution.port) {
    return null;
  }

  if (portsShareHost(resolution.port, targetPort)) {
    return null;
  }

  return buildCrossHostRedirectUrl({
    host: params.host,
    targetPort,
    pathname: params.pathname,
    search: params.search,
    hash: params.hash,
    protocol: params.protocol,
  });
}

export function shouldDiscardPublicHomeGatewayUrl(params: {
  savedGatewayUrl: string;
  pageHost: string;
}): boolean {
  const savedHost = parseGatewayHost(params.savedGatewayUrl, params.pageHost);
  const currentResolution = resolvePortFromSubdomain(params.pageHost);
  if (!currentResolution.isOpenBotDomain || currentResolution.isPublicHome) {
    return false;
  }
  if (!currentResolution.port) {
    return false;
  }
  const savedResolution = resolvePortFromSubdomain(savedHost);
  return savedResolution.isPublicHome;
}

function parseGatewayHost(gatewayUrl: string, pageHost: string): string {
  try {
    const pageProtocol = pageHost.includes("localhost") ? "https:" : "wss:";
    const parsed = new URL(gatewayUrl, `${pageProtocol}//${pageHost}`);
    return parsed.host;
  } catch {
    return gatewayUrl;
  }
}

function normalizeGatewayHost(host: string): string {
  return host.trim().toLowerCase();
}

export function buildOpenBotGatewayUrlForPageHost(params: {
  pageHost: string;
  pageProtocol?: string;
  basePath?: string;
}): string {
  const pageProtocol = params.pageProtocol ?? "https:";
  const proto = pageProtocol === "https:" ? "wss" : "ws";
  const basePath = params.basePath?.replace(/\/+$/, "") ?? "";
  return `${proto}://${params.pageHost}${basePath}`;
}

export function resolvePreferredOpenBotGatewayUrl(params: {
  gatewayUrl: string;
  pageHost: string;
  pageProtocol?: string;
  basePath?: string;
}): string {
  const currentResolution = resolvePortFromSubdomain(params.pageHost);
  if (!currentResolution.isOpenBotDomain || currentResolution.isPublicHome) {
    return canonicalizeEmployeeCloudGatewayUrl(params.gatewayUrl);
  }
  if (!currentResolution.port) {
    return canonicalizeEmployeeCloudGatewayUrl(params.gatewayUrl);
  }

  const preferred = buildOpenBotGatewayUrlForPageHost({
    pageHost: params.pageHost,
    pageProtocol: params.pageProtocol,
    basePath: params.basePath,
  });
  const savedHost = parseGatewayHost(params.gatewayUrl, params.pageHost);
  const savedResolution = resolvePortFromSubdomain(savedHost);
  if (
    savedResolution.isPublicHome ||
    normalizeGatewayHost(savedHost) !== normalizeGatewayHost(params.pageHost)
  ) {
    return preferred;
  }
  return canonicalizeEmployeeCloudGatewayUrl(params.gatewayUrl);
}

/**
 * After tab authorization, redirect when the resolved tab belongs on another
 * OpenBot subdomain (e.g. employee `me` resolved while visiting admin).
 */
export function resolveAuthorizedTabSubdomainRedirectUrl(params: {
  host: string;
  tab: Tab;
  basePath?: string;
  tenantId?: string;
  search?: string;
  hash?: string;
  protocol?: string;
}): string | null {
  const tab = canonicalizeTab(params.tab);
  const pathname = pathForTab(tab, params.basePath, {
    tenantId: params.tenantId,
  });
  return resolveOpenBotSubdomainRedirectUrl({
    host: params.host,
    tab,
    pathname,
    search: params.search,
    hash: params.hash,
    protocol: params.protocol,
  });
}

export function resolveRecoveredGatewayUrlForHostMismatch(params: {
  currentGatewayUrl: string;
  pageUrl?: string;
  basePath?: string;
}): string | null {
  const pageUrl =
    params.pageUrl ?? (typeof window === "undefined" ? undefined : window.location.href);
  if (!pageUrl) {
    return null;
  }
  try {
    const page = new URL(pageUrl);
    const preferred = resolvePreferredOpenBotGatewayUrl({
      gatewayUrl: params.currentGatewayUrl,
      pageHost: page.host,
      pageProtocol: page.protocol,
      basePath: params.basePath,
    });
    return preferred.trim() !== params.currentGatewayUrl.trim() ? preferred : null;
  } catch {
    return null;
  }
}
