import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../config/types.gateway.js";
import { resolveControlUiUserOperationalIdentityBasePath } from "./control-ui-contract.js";
import { sendJson, sendText } from "./http-common.js";
import {
  buildUserOperationalIdentityOAuthCallbackUrl,
  buildUserOperationalIdentityOAuthReturnUrl,
  completeUserOperationalIdentityOAuthCallback,
} from "./user-operational-identity-oauth.js";

export type UserOperationalIdentityHttpRequestOptions = {
  basePath?: string;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  localDirect?: boolean;
};

function resolveUserOperationalIdentityRoute(params: { pathname: string; basePath?: string }) {
  const routeBase = resolveControlUiUserOperationalIdentityBasePath(params.basePath);
  if (params.pathname !== routeBase && !params.pathname.startsWith(`${routeBase}/`)) {
    return null;
  }
  const relative = params.pathname.slice(routeBase.length).replace(/^\/+/, "");
  const segments = relative
    ? relative.split("/").map((segment) => decodeURIComponent(segment))
    : [];
  return { routeBase, segments };
}

function resolveRequestOrigin(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol =
    (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() ||
    "http";
  const host = req.headers.host?.trim() || "127.0.0.1";
  return `${protocol}://${host}`;
}

export async function handleUserOperationalIdentityHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: UserOperationalIdentityHttpRequestOptions,
): Promise<boolean> {
  if (req.method !== "GET") {
    return false;
  }
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const route = resolveUserOperationalIdentityRoute({
    pathname: url.pathname,
    basePath: opts.basePath,
  });
  if (!route) {
    return false;
  }

  if (route.segments[0] === "oauth" && route.segments[1] === "callback") {
    const state = url.searchParams.get("state")?.trim() ?? "";
    const code = url.searchParams.get("code")?.trim() ?? "";
    const error = url.searchParams.get("error")?.trim() ?? "";
    const origin = resolveRequestOrigin(req);
    const redirectUri = buildUserOperationalIdentityOAuthCallbackUrl({
      origin,
      basePath: opts.basePath,
    });
    if (error) {
      res.statusCode = 302;
      res.setHeader(
        "Location",
        buildUserOperationalIdentityOAuthReturnUrl({
          origin,
          basePath: opts.basePath,
          sessionId: "unknown",
          status: "error",
          message: error,
        }),
      );
      res.end();
      return true;
    }
    if (!state || !code) {
      sendJson(res, 400, {
        ok: false,
        code: "USER_IDENTITY_OAUTH_CALLBACK_INVALID",
        error: "state and code are required.",
      });
      return true;
    }
    const nowIso = new Date().toISOString();
    const result = await completeUserOperationalIdentityOAuthCallback({
      state,
      code,
      redirectUri,
      nowIso,
    });
    if (!result.ok) {
      res.statusCode = 302;
      res.setHeader(
        "Location",
        buildUserOperationalIdentityOAuthReturnUrl({
          origin,
          basePath: opts.basePath,
          sessionId: "unknown",
          status: "error",
          message: result.error,
        }),
      );
      res.end();
      return true;
    }
    res.statusCode = 302;
    res.setHeader(
      "Location",
      buildUserOperationalIdentityOAuthReturnUrl({
        origin,
        basePath: opts.basePath,
        sessionId: result.session.sessionId,
        status: "success",
        returnPath: result.returnPath,
      }),
    );
    res.end();
    return true;
  }

  if (route.segments.length === 0) {
    sendText(res, 200, "OpenBot user operational identity endpoint.");
    return true;
  }

  sendJson(res, 404, { ok: false, code: "NOT_FOUND", error: "Route not found." });
  return true;
}
