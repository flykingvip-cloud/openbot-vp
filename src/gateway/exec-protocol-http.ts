/**
 * Isolation-only authenticated gateway facade for exec-protocol A'.
 *
 * Product path (after gateway auth, including platformAuth cookies):
 *  - POST /v1/exec-protocol/tasks
 *  - POST /v1/exec-protocol/tasks/status
 *  - POST /v1/exec-protocol/tasks/artifact
 *  - GET  /v1/exec-protocol/tasks/:taskId/artifacts/:artifactId
 *
 * Tenant identity is taken from the authenticated session, not from the
 * client-supplied tenantId. This module does not enable a production
 * execution profile.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayExecProtocolConfig } from "../config/types.gateway.js";
import {
  assertChecksumMatch,
  decodeBase64Bytes,
  normalizeSha256,
} from "../exec-protocol/checksum.js";
import { createExecHttpClient } from "../exec-protocol/client.js";
import { ExecConfigError, isExecProtocolError } from "../exec-protocol/errors.js";
import {
  EXEC_API_VERSION,
  EXEC_API_VERSION_FIELD,
  HTTP_STATUS_BY_ERROR,
  type ExecArtifactResponse,
  type ExecTaskResponse,
} from "../exec-protocol/types.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import {
  authorizeHttpGatewayConnect,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "./auth.js";
import {
  resolveGatewayExecProtocolIsolation,
  type GatewayExecProtocolResolution,
} from "./exec-protocol-config.js";
import {
  readJsonBodyOrError,
  sendGatewayAuthFailure,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

export const EXEC_PROTOCOL_GATEWAY_PREFIX = "/v1/exec-protocol";
export const EXEC_PROTOCOL_SHA256_HEADER = "x-openbot-exec-sha256";
export const EXEC_PROTOCOL_ARTIFACT_ID_HEADER = "x-openbot-exec-artifact-id";
export const EXEC_PROTOCOL_TASK_ID_HEADER = "x-openbot-exec-task-id";
export const EXEC_PROTOCOL_BYTE_COUNT_HEADER = "x-openbot-exec-byte-count";

const GET_ARTIFACT_PATH = /^\/v1\/exec-protocol\/tasks\/([^/]+)\/artifacts\/([^/]+)\/?$/;

const POST_ROUTES = new Set([
  "/v1/exec-protocol/tasks",
  "/v1/exec-protocol/tasks/status",
  "/v1/exec-protocol/tasks/artifact",
]);

export type ExecProtocolHttpHandlerOptions = {
  auth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
  rateLimiter?: AuthRateLimiter;
  execProtocol?: GatewayExecProtocolConfig;
  env?: NodeJS.ProcessEnv;
};

export function isExecProtocolGatewayPath(pathname: string): boolean {
  return (
    pathname === EXEC_PROTOCOL_GATEWAY_PREFIX ||
    pathname.startsWith(`${EXEC_PROTOCOL_GATEWAY_PREFIX}/`)
  );
}

function sessionTenantId(authResult: GatewayAuthResult): string | undefined {
  const tenantId = authResult.trustedProxy?.tenantId?.trim();
  return tenantId ? tenantId : undefined;
}

function sendExecError(res: ServerResponse, status: number, message: string, type: string) {
  sendJson(res, status, { error: { message, type } });
}

function mapExecError(error: unknown): { status: number; message: string; type: string } {
  if (error instanceof ExecConfigError) {
    const productionRefused = error.message.includes("isolation-only");
    return {
      status: productionRefused ? 403 : 503,
      message: error.message,
      type: productionRefused ? "exec_protocol_production_refused" : "exec_protocol_config_refused",
    };
  }
  if (isExecProtocolError(error)) {
    return {
      status: HTTP_STATUS_BY_ERROR[error.code] ?? 500,
      message: error.message,
      type: error.code,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, message, type: "EXEC_INTERNAL" };
}

function resolveFacade(
  opts: ExecProtocolHttpHandlerOptions,
): GatewayExecProtocolResolution | { error: ReturnType<typeof mapExecError> } {
  try {
    return resolveGatewayExecProtocolIsolation({
      execProtocol: opts.execProtocol,
      env: opts.env,
    });
  } catch (error) {
    return { error: mapExecError(error) };
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function requireSessionTenant(
  res: ServerResponse,
  authResult: GatewayAuthResult,
  requestedTenantId: unknown,
): string | undefined {
  const tenantId = sessionTenantId(authResult);
  if (!tenantId) {
    sendExecError(
      res,
      403,
      "exec protocol gateway facade requires an authenticated tenant identity",
      "exec_protocol_tenant_required",
    );
    return undefined;
  }
  if (
    typeof requestedTenantId === "string" &&
    requestedTenantId.trim() &&
    requestedTenantId.trim() !== tenantId
  ) {
    sendExecError(
      res,
      403,
      "session must not access another tenant's exec-protocol task or artifact",
      "exec_protocol_tenant_mismatch",
    );
    return undefined;
  }
  return tenantId;
}

function verifiedArtifactPayload(
  payload: ExecArtifactResponse,
  includeBytes: boolean,
): ExecArtifactResponse {
  if (typeof payload.bytesBase64 !== "string") {
    throw new Error("artifact bytes were not returned for gateway verification");
  }
  const bytes = decodeBase64Bytes(payload.bytesBase64);
  assertChecksumMatch({
    expectedSha256: payload.sha256,
    expectedByteCount: payload.byteCount,
    actual: bytes,
  });
  const sha256 = normalizeSha256(payload.sha256);
  return {
    ...payload,
    [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
    sha256,
    ...(includeBytes ? { bytesBase64: payload.bytesBase64 } : { bytesBase64: undefined }),
  };
}

function sendArtifactDownload(res: ServerResponse, payload: ExecArtifactResponse): void {
  const verified = verifiedArtifactPayload(payload, true);
  const bytes = decodeBase64Bytes(verified.bytesBase64 ?? "");
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(bytes.byteLength));
  res.setHeader("Content-Disposition", `attachment; filename="${verified.artifactId}.bin"`);
  res.setHeader(EXEC_PROTOCOL_SHA256_HEADER, verified.sha256);
  res.setHeader(EXEC_PROTOCOL_ARTIFACT_ID_HEADER, verified.artifactId);
  res.setHeader(EXEC_PROTOCOL_TASK_ID_HEADER, verified.taskId);
  res.setHeader(EXEC_PROTOCOL_BYTE_COUNT_HEADER, String(verified.byteCount));
  res.end(Buffer.from(bytes));
}

/** Handle a /v1/exec-protocol/* request. Returns true when it owned the path. */
export async function handleExecProtocolHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ExecProtocolHttpHandlerOptions,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const getArtifactMatch = GET_ARTIFACT_PATH.exec(url.pathname) ?? GET_ARTIFACT_PATH.exec(pathname);
  if (!isExecProtocolGatewayPath(pathname) && !getArtifactMatch) {
    return false;
  }

  const resolved = resolveFacade(opts);
  if ("error" in resolved) {
    sendExecError(res, resolved.error.status, resolved.error.message, resolved.error.type);
    return true;
  }
  if (!resolved.enabled) {
    sendExecError(res, 404, "exec protocol gateway facade is not enabled", "not_found");
    return true;
  }

  const method = req.method ?? "GET";
  if (getArtifactMatch) {
    if (method !== "GET") {
      sendMethodNotAllowed(res, "GET");
      return true;
    }
  } else if (!POST_ROUTES.has(pathname)) {
    sendExecError(res, 404, "unknown exec protocol gateway route", "not_found");
    return true;
  } else if (method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const token = getBearerToken(req);
  const authResult = await authorizeHttpGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(res, authResult);
    return true;
  }

  let body: Record<string, unknown> = {};
  if (method === "POST") {
    const parsed = await readJsonBodyOrError(req, res, resolved.maxRequestBodyBytes);
    if (parsed === undefined) {
      return true;
    }
    if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
      sendInvalidRequest(res, "request body must be a JSON object");
      return true;
    }
    body = objectBody(parsed);
  }

  const tenantId = requireSessionTenant(res, authResult, body.tenantId);
  if (!tenantId) {
    return true;
  }

  const client = createExecHttpClient({
    baseUrl: resolved.controlPlaneUrl,
    config: resolved.config,
    leaseToken: resolved.leaseToken,
    maxRequestBodyBytes: resolved.maxRequestBodyBytes,
  });

  try {
    if (getArtifactMatch) {
      const taskId = decodeURIComponent(getArtifactMatch[1] ?? "");
      const artifactId = decodeURIComponent(getArtifactMatch[2] ?? "");
      const result = await client.artifact({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId,
        taskId,
        artifactId,
        includeBytes: true,
      });
      sendArtifactDownload(res, result.payload);
      return true;
    }

    if (pathname === "/v1/exec-protocol/tasks") {
      const result = await client.submit({
        ...body,
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId,
        userId: typeof body.userId === "string" ? body.userId : authResult.user,
      } as never);
      sendJson(res, result.httpStatus, result.payload);
      return true;
    }

    if (pathname === "/v1/exec-protocol/tasks/status") {
      const result = await client.status({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId,
        taskId: typeof body.taskId === "string" ? body.taskId : undefined,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
      });
      sendJson(res, result.httpStatus, result.payload satisfies ExecTaskResponse);
      return true;
    }

    if (pathname === "/v1/exec-protocol/tasks/artifact") {
      const taskId = typeof body.taskId === "string" ? body.taskId : "";
      const artifactId = typeof body.artifactId === "string" ? body.artifactId : "";
      if (!taskId || !artifactId) {
        sendInvalidRequest(res, "taskId and artifactId are required");
        return true;
      }
      const includeBytes = body.includeBytes !== false;
      const result = await client.artifact({
        [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
        tenantId,
        taskId,
        artifactId,
        includeBytes: true,
      });
      const verified = verifiedArtifactPayload(result.payload, includeBytes);
      if (!includeBytes) {
        delete verified.bytesBase64;
      }
      sendJson(res, result.httpStatus, verified satisfies ExecArtifactResponse);
      return true;
    }

    sendExecError(res, 404, "unknown exec protocol gateway route", "not_found");
    return true;
  } catch (error) {
    const mapped = mapExecError(error);
    sendExecError(res, mapped.status, mapped.message, mapped.type);
    return true;
  }
}
