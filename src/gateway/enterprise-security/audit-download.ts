/**
 * Authenticated download for one tenant's audit export.
 * The session enterprise must equal the export record. A foreign tenant gets 403.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import { sendJson } from "../http-common.js";
import { readPlatformAuthSessionContextFromRequest } from "../platform-auth/session-context.js";
import { readEnterpriseAuditExport } from "./audit-log.js";

export async function handleEnterpriseAuditExportDownload(params: {
  req: IncomingMessage;
  res: ServerResponse;
  exportId: string;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  localDirect?: boolean;
}): Promise<boolean> {
  if (params.req.method !== "GET") {
    params.res.setHeader("Allow", "GET");
    sendJson(params.res, 405, { ok: false, error: "Method Not Allowed" });
    return true;
  }
  if (!/^exp_[0-9a-f-]{36}$/.test(params.exportId)) {
    sendJson(params.res, 404, { ok: false, error: "Export not found" });
    return true;
  }
  const context = await readPlatformAuthSessionContextFromRequest({
    req: params.req,
    trustedProxy: params.trustedProxy,
    localDirect: params.localDirect,
  });
  const sessionTenant =
    context?.membership?.enterpriseId?.trim() || context?.enterprise?.id?.trim() || "";
  if (!context || !sessionTenant) {
    sendJson(params.res, 403, { ok: false, error: "Enterprise session is required" });
    return true;
  }
  let stored;
  try {
    stored = await readEnterpriseAuditExport(params.exportId);
  } catch {
    sendJson(params.res, 503, { ok: false, error: "Export is unavailable" });
    return true;
  }
  if (!stored || stored.tenantId !== sessionTenant) {
    sendJson(params.res, 403, { ok: false, error: "Export is not in this enterprise" });
    return true;
  }
  params.res.statusCode = 200;
  params.res.setHeader(
    "Content-Type",
    stored.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
  );
  params.res.setHeader(
    "Content-Disposition",
    `attachment; filename="${params.exportId}.${stored.format}"`,
  );
  params.res.end(stored.content);
  return true;
}
