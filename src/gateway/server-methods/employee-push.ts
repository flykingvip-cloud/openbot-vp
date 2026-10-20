/**
 * employee.push.* — Wave 2 employee-scoped remote push RPCs.
 *
 * Isolation: does NOT touch push.apns.register / node.wake / registrationsByNodeId.
 */

import {
  enqueueEmployeePushForPlatformUser,
  registerEmployeePushToken,
  unregisterEmployeePushToken,
  type EmployeePushPlatform,
} from "../../infra/employee-push.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function requireString(
  params: Record<string, unknown>,
  key: string,
  respond: RespondFn,
): string | null {
  const raw = params[key];
  const value = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  const trimmed = value.trim();
  if (!trimmed) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `missing ${key}`));
    return null;
  }
  return trimmed;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const raw = params[key];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolvePlatformUserId(client: { platformUserId?: string; user?: string } | null): string {
  return client?.platformUserId?.trim() || "";
}

export const employeePushHandlers: GatewayRequestHandlers = {
  "employee.push.register": async ({ params, client, respond }) => {
    const platformUserId = resolvePlatformUserId(client);
    if (!platformUserId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "platform session required (platformUserId missing — sign in as employee)",
        ),
      );
      return;
    }
    const accountId = requireString(params, "accountId", respond);
    if (!accountId) {
      return;
    }
    const deviceId = requireString(params, "deviceId", respond);
    if (!deviceId) {
      return;
    }
    const platform = requireString(params, "platform", respond);
    if (!platform) {
      return;
    }
    const token = requireString(params, "token", respond);
    if (!token) {
      return;
    }
    const topic = optionalString(params, "topic");
    const environment = optionalString(params, "environment");

    try {
      const registration = await registerEmployeePushToken({
        accountId,
        deviceId,
        platform: platform as EmployeePushPlatform,
        platformUserId,
        token,
        topic,
        environment,
      });
      respond(
        true,
        {
          ok: true,
          accountId: registration.accountId,
          deviceId: registration.deviceId,
          platform: registration.platform,
          topic: registration.topic,
          environment: registration.environment,
          updatedAtMs: registration.updatedAtMs,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "employee.push.unregister": async ({ params, client, respond }) => {
    const platformUserId = resolvePlatformUserId(client);
    if (!platformUserId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "platform session required (platformUserId missing — sign in as employee)",
        ),
      );
      return;
    }
    const accountId = requireString(params, "accountId", respond);
    if (!accountId) {
      return;
    }
    const deviceId = optionalString(params, "deviceId");
    const platform = optionalString(params, "platform");
    const allDevices = Boolean(
      params.allDevices === true || (!deviceId && params.allDevices !== false),
    );

    try {
      const result = await unregisterEmployeePushToken({
        accountId,
        deviceId,
        platform,
        allDevices: allDevices && !deviceId,
      });
      respond(true, { ok: true, removed: result.removed }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "employee.push.test": async ({ params, client, respond }) => {
    const platformUserId = resolvePlatformUserId(client);
    if (!platformUserId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "platform session required (platformUserId missing — sign in as employee)",
        ),
      );
      return;
    }
    const accountId = optionalString(params, "accountId");
    const deepLink = optionalString(params, "deepLink") ?? "openclaw://employee/overview";
    const title = optionalString(params, "title") ?? "OpenBot";
    const body = optionalString(params, "body") ?? "Employee push test";

    try {
      const results = await enqueueEmployeePushForPlatformUser({
        platformUserId,
        payload: {
          deepLink,
          title,
          body,
          accountId,
          kind: "employee.push.test",
        },
      });
      if (results.length === 0) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "no employee push registrations for this account (call employee.push.register first)",
          ),
        );
        return;
      }
      const anyCredsMissing = results.every((r) => r.skipped === "no_credentials");
      if (anyCredsMissing) {
        respond(
          false,
          { results },
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            results[0]?.reason ??
              "Employee APNs credentials required (OPENBOT_EMPLOYEE_APNS_*). Registration stored; delivery skipped.",
          ),
        );
        return;
      }
      respond(true, { ok: true, results }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};
