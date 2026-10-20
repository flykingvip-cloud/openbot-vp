/**
 * Platform-auth HTTP surface for employee push register/unregister.
 *
 * Uses the employee cookie session (same jar as login) so iOS EmployeeAuthClient
 * can register without requiring a gateway operator WebSocket. Storage/send
 * share src/infra/employee-push.ts with the gateway RPC pack.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import {
  registerEmployeePushToken,
  unregisterEmployeePushToken,
  type EmployeePushPlatform,
} from "../../infra/employee-push.js";
import { sendJson } from "../http-common.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { requiredString } from "./request-helpers.js";
import { readPlatformAuthSessionContextFromRequest } from "./session-context.js";

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function handleEmployeePushRegisterRoute(
  req: IncomingMessage,
  res: ServerResponse,
  _config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
): Promise<boolean> {
  const context = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy,
    localDirect,
  });
  if (!context?.user?.id) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_SESSION_REQUIRED",
      error: "Sign in before registering employee push.",
    });
    return true;
  }

  const accountId = requiredString(body.accountId);
  const deviceId = requiredString(body.deviceId);
  const platform = requiredString(body.platform);
  const token = requiredString(body.token);
  if (!accountId || !deviceId || !platform || !token) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_BODY",
      error: "accountId, deviceId, platform, and token are required.",
    });
    return true;
  }

  try {
    const registration = await registerEmployeePushToken({
      accountId,
      deviceId,
      platform: platform as EmployeePushPlatform,
      platformUserId: context.user.id,
      token,
      topic: optionalString(body.topic),
      environment: optionalString(body.environment),
    });
    sendJson(res, 200, {
      ok: true,
      accountId: registration.accountId,
      deviceId: registration.deviceId,
      platform: registration.platform,
      topic: registration.topic,
      environment: registration.environment,
      updatedAtMs: registration.updatedAtMs,
    });
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      code: "EMPLOYEE_PUSH_REGISTER_FAILED",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

export async function handleEmployeePushUnregisterRoute(
  req: IncomingMessage,
  res: ServerResponse,
  _config: ResolvedPlatformAuthConfig,
  body: Record<string, unknown>,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
): Promise<boolean> {
  const context = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy,
    localDirect,
  });
  if (!context?.user?.id) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_SESSION_REQUIRED",
      error: "Sign in before unregistering employee push.",
    });
    return true;
  }

  const accountId = requiredString(body.accountId);
  if (!accountId) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_BODY",
      error: "accountId is required.",
    });
    return true;
  }

  const deviceId = optionalString(body.deviceId);
  const platform = optionalString(body.platform);
  const allDevices = body.allDevices === true || !deviceId;

  try {
    const result = await unregisterEmployeePushToken({
      accountId,
      deviceId,
      platform,
      allDevices,
    });
    sendJson(res, 200, { ok: true, removed: result.removed });
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      code: "EMPLOYEE_PUSH_UNREGISTER_FAILED",
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}
