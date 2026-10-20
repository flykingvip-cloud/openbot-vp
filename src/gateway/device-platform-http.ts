/**
 * Gateway mount for device-platform management routes.
 *
 * OpenBot host: `/api/device-platform/v1/admin/*` for a platform-admin session,
 * and `/api/device-platform/v1/me/*` for a signed-in member. The device platform
 * itself is a different process. `HttpDevicePlatformControl` calls that origin.
 *
 * The loopback `/api/integrations/v1` stub is not mounted.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveAgentConfig } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { handleDevicePlatformRequest } from "../integrations/device-platform/api.js";
import { ConnectorHttpControl } from "../integrations/device-platform/connector-http-control.js";
import {
  digitalHumanUseAllowed,
  type DigitalHumanRecord,
  type IdentityDirectory,
  type TrustedActor,
} from "../integrations/device-platform/identity.js";
import { resolveDevicePlatformPaths } from "../integrations/device-platform/paths.js";
import { DevicePlatformService } from "../integrations/device-platform/service.js";
import { DevicePlatformStore } from "../integrations/device-platform/store.js";
import { DEVICE_PLATFORM_API_PREFIX } from "../integrations/device-platform/types.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import { isLocalDirectRequest } from "./auth.js";
import { readJsonBodyOrError, sendJson } from "./http-common.js";
import { isPlatformUser } from "./platform-auth/auth-helpers.js";
import { buildPlatformEmployeeAccess } from "./platform-auth/memberships.js";
import { loadSeatAssetsStoreForTenantId } from "./platform-auth/seat-store-loader.js";
import { readPlatformAuthSessionContextFromRequest } from "./platform-auth/session-context.js";

const ADMIN_PREFIX = `${DEVICE_PLATFORM_API_PREFIX}/admin/`;
const USER_PREFIX = `${DEVICE_PLATFORM_API_PREFIX}/me/`;
const MAX_BODY_BYTES = 64 * 1024;

export type DevicePlatformGatewaySession = {
  userId: string;
  displayName: string;
  status: "active" | "suspended";
  sessionKind: string;
  /** True when the user record is a platform admin, independent of the current session kind. */
  platformUser: boolean;
  tenantId?: string;
  membershipId?: string;
  membershipRole?: "member" | "enterprise-admin";
  /** Seat and ownership agent ids. Not taken from the request body. */
  permittedAgentIds?: string[];
};

export type DevicePlatformHttpHandlerOptions = {
  resolveSession?: (req: IncomingMessage) => Promise<DevicePlatformGatewaySession | null>;
  service?: DevicePlatformService;
};

class GatewayDeviceDirectory implements IdentityDirectory {
  private readonly permits = new Map<
    string,
    { tenantId: string; agentIds: string[]; refs: number }
  >();

  remember(userId: string, tenantId: string, agentIds: readonly string[]): string {
    const key = `${tenantId}:${userId}`;
    const existing = this.permits.get(key);
    if (existing) {
      existing.refs += 1;
      existing.tenantId = tenantId;
      existing.agentIds = [...agentIds];
      return key;
    }
    this.permits.set(key, { tenantId, agentIds: [...agentIds], refs: 1 });
    return key;
  }

  forget(key: string): void {
    const existing = this.permits.get(key);
    if (!existing) {
      return;
    }
    existing.refs -= 1;
    if (existing.refs <= 0) {
      this.permits.delete(key);
    }
  }

  resolveActor(): null {
    return null;
  }

  getDigitalHuman(digitalHumanId: string): DigitalHumanRecord | null {
    const matches = [...this.permits.values()].filter((permit) =>
      permit.agentIds.includes(digitalHumanId),
    );
    const tenantIds = new Set(matches.map((permit) => permit.tenantId));
    if (tenantIds.size !== 1) {
      return null;
    }
    const tenantId = [...tenantIds][0] ?? "";
    return humanRecord(digitalHumanId, tenantId);
  }

  hasDigitalHumanUse(actor: TrustedActor, human: DigitalHumanRecord): boolean {
    const permit = this.permits.get(`${actor.tenantId}:${actor.userId}`);
    if (!permit || permit.tenantId !== actor.tenantId) {
      return false;
    }
    return digitalHumanUseAllowed({
      actor,
      human,
      permittedAgentIds: permit.agentIds,
    });
  }

  listUsableDigitalHumans(actor: TrustedActor): DigitalHumanRecord[] {
    const permit = this.permits.get(`${actor.tenantId}:${actor.userId}`);
    if (!permit || permit.tenantId !== actor.tenantId) {
      return [];
    }
    return permit.agentIds.map((id) => humanRecord(id, permit.tenantId));
  }
}

const gatewayDirectory = new GatewayDeviceDirectory();

let gatewayService: DevicePlatformService | undefined;

function defaultGatewayService(): DevicePlatformService {
  if (!gatewayService) {
    const store = new DevicePlatformStore(resolveDevicePlatformPaths());
    gatewayService = new DevicePlatformService({
      store,
      directory: gatewayDirectory,
      control: new ConnectorHttpControl({
        loadConnection: (platformId) => store.loadConnections().connections[platformId] ?? null,
        loadCredential: (platformId) => store.loadCredential(platformId),
      }),
      verifyServiceClient: (clientId, secret) => {
        for (const row of Object.values(store.loadCredentials().credentials)) {
          if (row.serviceUser === clientId && safeEqualSecret(secret, row.secret)) {
            return true;
          }
        }
        return false;
      },
      mode: "formal",
    });
  }
  return gatewayService;
}

function humanRecord(digitalHumanId: string, tenantId: string): DigitalHumanRecord {
  let displayName = digitalHumanId;
  try {
    const config = resolveAgentConfig(loadConfig(), digitalHumanId);
    displayName = config?.identity?.name?.trim() || config?.name?.trim() || digitalHumanId;
  } catch {
    displayName = digitalHumanId;
  }
  return {
    digitalHumanId,
    tenantId,
    gatewayAgentId: digitalHumanId,
    displayName,
    status: "active",
  };
}

export function resetGatewayDevicePlatformServiceForTests(): void {
  gatewayService = undefined;
}

export async function handleDevicePlatformHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: DevicePlatformHttpHandlerOptions = {},
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (pathname.startsWith("/api/integrations/")) {
    return false;
  }
  if (!pathname.startsWith(DEVICE_PLATFORM_API_PREFIX)) {
    return false;
  }
  const admin =
    pathname.startsWith(ADMIN_PREFIX) || pathname === `${DEVICE_PLATFORM_API_PREFIX}/admin`;
  const user = pathname.startsWith(USER_PREFIX) || pathname === `${DEVICE_PLATFORM_API_PREFIX}/me`;
  if (!admin && !user) {
    sendJson(res, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
    return true;
  }

  const session = await (opts.resolveSession ?? resolveGatewaySession)(req);
  if (!session) {
    sendJson(res, 401, {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Login session is required" },
    });
    return true;
  }

  const actor = actorFromGatewaySession(session);
  if (user && (!session.tenantId || !session.membershipId || actor.platformAdmin)) {
    sendJson(res, 403, {
      ok: false,
      error: { code: "MEMBERSHIP_REQUIRED", message: "Tenant membership is required" },
    });
    return true;
  }

  const method = req.method ?? "GET";
  let body: unknown;
  if (method !== "GET" && method !== "HEAD") {
    body = await readJsonBodyOrError(req, res, MAX_BODY_BYTES);
    if (body === undefined) {
      return true;
    }
  }

  const service = opts.service ?? defaultGatewayService();
  const permitKey = user
    ? gatewayDirectory.remember(
        session.userId,
        session.tenantId ?? "",
        session.permittedAgentIds ?? [],
      )
    : undefined;
  try {
    const response = await handleDevicePlatformRequest(
      service,
      {
        method,
        path: `${pathname}${url.search}`,
        body,
      },
      actor,
    );
    sendJson(res, response.status, response.body);
    return true;
  } finally {
    if (permitKey) {
      gatewayDirectory.forget(permitKey);
    }
  }
}

export function actorFromGatewaySession(session: DevicePlatformGatewaySession): TrustedActor {
  const platformSession =
    session.sessionKind === "platform-admin" || session.sessionKind === "platform-super-admin";
  const platformAdmin = platformSession && session.platformUser && session.status === "active";
  if (!platformAdmin && session.tenantId && session.membershipId) {
    return {
      userId: session.userId,
      displayName: session.displayName || session.userId,
      tenantId: session.tenantId,
      membershipId: session.membershipId,
      membershipRole: session.membershipRole === "enterprise-admin" ? "enterprise-admin" : "member",
      platformAdmin: false,
      status: session.status,
    };
  }
  return {
    userId: session.userId,
    displayName: session.displayName || session.userId,
    tenantId: "_platform",
    membershipId: `platform:${session.userId}`,
    membershipRole: "enterprise-admin",
    platformAdmin,
    status: session.status,
  };
}

async function resolveGatewaySession(
  req: IncomingMessage,
): Promise<DevicePlatformGatewaySession | null> {
  const config = loadConfig();
  const context = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy: config.gateway?.auth?.trustedProxy,
    localDirect: isLocalDirectRequest(req, config.gateway?.trustedProxies),
  });
  if (!context?.user) {
    return null;
  }
  const status = context.user.status === "active" ? "active" : "suspended";
  const session: DevicePlatformGatewaySession = {
    userId: context.user.id,
    displayName: context.user.displayName,
    status,
    sessionKind: context.sessionKind,
    platformUser: isPlatformUser(context.user),
  };
  if (!context.membership || !context.enterprise) {
    return session;
  }
  session.tenantId = context.enterprise.id;
  session.membershipId = context.membership.id;
  session.membershipRole = context.membership.membershipRole;
  try {
    const seatStore = await loadSeatAssetsStoreForTenantId(context.enterprise.id);
    const access = buildPlatformEmployeeAccess({
      seatStore,
      enterpriseId: context.enterprise.id,
      employeeId: context.user.id,
      employeeEmail: context.user.email,
    });
    session.permittedAgentIds = access?.agentIds ?? [];
  } catch {
    session.permittedAgentIds = [];
  }
  return session;
}
