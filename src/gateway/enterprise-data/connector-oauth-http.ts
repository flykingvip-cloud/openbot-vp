import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, sendText } from "../http-common.js";
import {
  buildDataConnectorOAuthCallbackUrl,
  buildDataConnectorOAuthReturnUrl,
  completeDataConnectorOAuthCallback,
} from "./connector-oauth.js";
import { resolveControlUiEnterpriseDataBasePath } from "./control-ui-paths.js";

export type EnterpriseDataConnectorOAuthHttpOptions = {
  basePath?: string;
};

function resolveEnterpriseDataRoute(params: { pathname: string; basePath?: string }) {
  const routeBase = resolveControlUiEnterpriseDataBasePath(params.basePath);
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

export async function handleEnterpriseDataConnectorOAuthHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: EnterpriseDataConnectorOAuthHttpOptions,
): Promise<boolean> {
  if (req.method !== "GET") {
    return false;
  }
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const route = resolveEnterpriseDataRoute({
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
    const redirectUri = buildDataConnectorOAuthCallbackUrl({
      origin,
      basePath: opts.basePath,
    });
    if (error) {
      res.statusCode = 302;
      res.setHeader(
        "Location",
        buildDataConnectorOAuthReturnUrl({
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
        code: "CONNECTOR_OAUTH_CALLBACK_INVALID",
        error: "state and code are required.",
      });
      return true;
    }
    const nowIso = new Date().toISOString();
    const result = await completeDataConnectorOAuthCallback({
      state,
      code,
      redirectUri,
      nowIso,
    });
    if (!result.ok) {
      res.statusCode = 302;
      res.setHeader(
        "Location",
        buildDataConnectorOAuthReturnUrl({
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
      buildDataConnectorOAuthReturnUrl({
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
    sendText(res, 200, "OpenBot enterprise data connector endpoint.");
    return true;
  }

  sendJson(res, 404, { ok: false, code: "NOT_FOUND", error: "Route not found." });
  return true;
}
