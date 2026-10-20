/**
 * fabric-v1-http.ts — thin /v1/* HTTP forwarding for OpenBot Fabric (R7, D2).
 *
 * Reuses the same gateway HTTP auth as POST /tools/invoke and forwards to the
 * Fabric service facade (the same instance the WS `fabric.*` methods use). This
 * is a thin convenience surface over the WS control plane; it does NOT bypass
 * auth and adds no new policy path (the service owns decide/execute).
 *
 * Routes:
 *  - POST /v1/tool/execute     { request }            → { result, trace }
 *  - POST /v1/tool/stream      { request }            → { result, events, trace }
 *  - POST /v1/policy/check     { request } (dry-run)  → { decision, trace }
 *  - POST /v1/adapter/register { adapter }            → { adapter }
 *
 * Feature-gated: when Fabric is not enabled (no service), responds 503.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.8.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import type { ExecutionEvent } from "../fabric/contract.js";
import { FabricContractError, ToolRequest, parseContract } from "../fabric/contract.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { authorizeHttpGatewayConnect, type ResolvedGatewayAuth } from "./auth.js";
import {
  readJsonBodyOrError,
  sendGatewayAuthFailure,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
import { getFabricService } from "./server-methods/fabric.js";

const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;

const ROUTES = new Set([
  "/v1/tool/execute",
  "/v1/tool/stream",
  "/v1/policy/check",
  "/v1/adapter/register",
]);

/** Handle a Fabric /v1/* HTTP request. Returns true when it owned the request. */
export async function handleFabricV1HttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    maxBodyBytes?: number;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (!ROUTES.has(url.pathname)) {
    return false;
  }
  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const cfg = loadConfig();
  const token = getBearerToken(req);
  const authResult = await authorizeHttpGatewayConnect({
    auth: opts.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback ?? cfg.gateway?.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(res, authResult);
    return true;
  }

  const service = getFabricService();
  if (!service) {
    sendJson(res, 503, {
      ok: false,
      error: { type: "unavailable", message: "fabric is not enabled" },
    });
    return true;
  }

  const bodyUnknown = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  if (bodyUnknown === undefined) {
    return true;
  }
  const body = (bodyUnknown ?? {}) as Record<string, unknown>;

  try {
    if (url.pathname === "/v1/adapter/register") {
      const adapter = service.registerAdapter(body.adapter);
      sendJson(res, 200, { ok: true, adapter });
      return true;
    }
    const request = parseContract(ToolRequest, body.request, "ToolRequest");
    if (url.pathname === "/v1/policy/check") {
      sendJson(res, 200, { ok: true, decision: service.check(request), trace: request.trace });
      return true;
    }
    if (url.pathname === "/v1/tool/stream") {
      // HTTP has no WS recipient transport, so collect the ExecutionEvents and
      // return them as a single batch alongside the final result (R12). The WS
      // `fabric.tool.stream` method delivers the same events incrementally.
      const events: ExecutionEvent[] = [];
      const { result } = await service.stream(request, (event) => {
        events.push(event);
      });
      sendJson(res, 200, { ok: true, result, events, trace: request.trace });
      return true;
    }
    // /v1/tool/execute
    const { result } = await service.execute(request);
    sendJson(res, 200, { ok: true, result, trace: request.trace });
    return true;
  } catch (err) {
    if (err instanceof FabricContractError) {
      sendInvalidRequest(res, err.message);
      return true;
    }
    sendJson(res, 500, {
      ok: false,
      error: { type: "internal", message: err instanceof Error ? err.message : String(err) },
    });
    return true;
  }
}
