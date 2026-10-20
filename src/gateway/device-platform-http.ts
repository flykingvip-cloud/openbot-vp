/**
 * Gateway mount for platform-admin device-platform connector routes.
 *
 * OpenBot host: `/api/device-platform/v1/admin/*` (this file).
 * Device-platform host: the same path prefix on the admin-configured base URL
 * (see `HttpDevicePlatformControl`). These are different processes.
 *
 * User device routes and the loopback `/api/integrations/v1` stub are not mounted.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import { handleDevicePlatformRequest } from "../integrations/device-platform/api.js";
import { FakeDevicePlatformControl } from "../integrations/device-platform/control-client.js";
import type { IdentityDirectory, TrustedActor } from "../integrations/device-platform/identity.js";
import { resolveDevicePlatformPaths } from "../integrations/device-platform/paths.js";
import { DevicePlatformService } from "../integrations/device-platform/service.js";
import { DevicePlatformStore } from "../integrations/device-platform/store.js";
import { DEVICE_PLATFORM_API_PREFIX } from "../integrations/device-platform/types.js";
import { isLocalDirectRequest } from "./auth.js";
import { readJsonBodyOrError, sendJson } from "./http-common.js";
import { isPlatformUser } from "./platform-auth/auth-helpers.js";
import { readPlatformAuthSessionContextFromRequest } from "./platform-auth/session-context.js";

const ADMIN_PREFIX = `${DEVICE_PLATFORM_API_PREFIX}/admin/`;
const MAX_BODY_BYTES = 64 * 1024;

export type DevicePlatformGatewaySession = {
  userId: string;
  displayName: string;
  status: "active" | "suspended";
  sessionKind: string;
  /** True when the user record is a platform admin, independent of the current session kind. */
  platformUser: boolean;
};

export type DevicePlatformHttpHandlerOptions = {
  resolveSession?: (req: IncomingMessage) => Promise<DevicePlatformGatewaySession | null>;
  service?: DevicePlatformService;
};

const gatewayDirectory: IdentityDirectory = {
  resolveActor(): null {
    return null;
  },
  getDigitalHuman(): null {
    return null;
  },
  hasDigitalHumanUse(): boolean {
    return false;
  },
};

let gatewayService: DevicePlatformService | undefined;

function defaultGatewayService(): DevicePlatformService {
  if (!gatewayService) {
    gatewayService = new DevicePlatformService({
      store: new DevicePlatformStore(resolveDevicePlatformPaths()),
      directory: gatewayDirectory,
      control: new FakeDevicePlatformControl(),
      mode: "formal",
    });
  }
  return gatewayService;
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
  if (!pathname.startsWith(ADMIN_PREFIX) && pathname !== `${DEVICE_PLATFORM_API_PREFIX}/admin`) {
    sendJson(res, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
    return true;
  }

  const session = await (opts.resolveSession ?? resolvePlatformAdminSession)(req);
  if (!session) {
    sendJson(res, 401, {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Login session is required" },
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
  const actor = actorFromGatewaySession(session);
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
}

export function actorFromGatewaySession(session: DevicePlatformGatewaySession): TrustedActor {
  const platformSession =
    session.sessionKind === "platform-admin" || session.sessionKind === "platform-super-admin";
  return {
    userId: session.userId,
    displayName: session.displayName || session.userId,
    tenantId: "_platform",
    membershipId: `platform:${session.userId}`,
    membershipRole: "enterprise-admin",
    platformAdmin: platformSession && session.platformUser && session.status === "active",
    status: session.status,
  };
}

async function resolvePlatformAdminSession(
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
  return {
    userId: context.user.id,
    displayName: context.user.displayName,
    status,
    sessionKind: context.sessionKind,
    platformUser: isPlatformUser(context.user),
  };
}
