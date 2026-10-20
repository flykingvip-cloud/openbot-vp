/**
 * Control UI platform-auth HTTP entrypoint.
 *
 * Owns `handleControlUiPlatformAuthRequest` (extracted from the
 * `platform-auth.ts` facade per gateway-plugins-monolith-decomposition).
 * Route handlers live in `http-handler.ts` and `routes-*.ts`; store write
 * serialization reuses `withPlatformAuthStoreWriteLock` from `store.ts`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import { resolveControlUiPlatformAuthBasePath } from "../control-ui-contract.js";
import { handleEnterpriseAuditExportDownload } from "../enterprise-security/audit-download.js";
import { readJsonBody } from "../hooks.js";
import { sendJson, sendMethodNotAllowed } from "../http-common.js";
import { resolvePlatformAuthConfig } from "./config.js";
import {
  handleEmployeeAccessOfferAcceptRoute,
  handleEmployeeAccessOfferDeclineRoute,
  handleEmployeeActivationSendRoute,
  handleEmployeeProvisionRoute,
  handleEmployeeRegisterRoute,
  handleEnterpriseAdminActivateRoute,
  handleEnterpriseCreateRoute,
  handleLoginRoute,
  handleLogoutRoute,
  handleMemberRemoveRoute,
  handleMfaPolicyRoute,
  handlePasswordChangeRoute,
  handlePasswordForgotRoute,
  handlePasswordResetRoute,
  handlePlatformAdminCreateRoute,
  handlePlatformAdminRemoveRoute,
  handlePlatformBootstrapRoute,
  handlePlatformEnterpriseAdminActivationSendRoute,
  handlePlatformEnterpriseAdminUpdateRoute,
  handlePlatformEnterpriseCreateRoute,
  handleRetiredRoutes,
  handleSessionRoute,
  handleSessionSwitchRoute,
  handleTrialApplicationApproveRoute,
  handleTrialApplicationRejectRoute,
  handleTrialApplicationsRoute,
  handleTrialApplyRoute,
  handleTrialInstanceUpdateRoute,
  handleTrialPolicyUpdateRoute,
  parseRequestBody,
} from "./http-handler.js";
import { isLocalOrConfiguredPublicPlatformAccess } from "./public-request.js";
import {
  handleEmployeePushRegisterRoute,
  handleEmployeePushUnregisterRoute,
} from "./routes-employee-push.js";
import {
  handleEnterpriseCoAdminInviteAcceptRoute,
  handleEnterpriseCoAdminInviteRoute,
} from "./routes-enterprise-co-admin.js";
import { withPlatformAuthStoreWriteLock } from "./store.js";

const PLATFORM_AUTH_BODY_LIMIT_BYTES = 64 * 1024;

export async function handleControlUiPlatformAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  params: {
    basePath?: string;
    trustedProxy: GatewayTrustedProxyConfig | undefined;
    localDirect?: boolean;
  },
): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const config = resolvePlatformAuthConfig(params.trustedProxy);
  const basePath = params.basePath?.trim() || "";
  const url = new URL(urlRaw, "http://localhost");
  const routeBase = resolveControlUiPlatformAuthBasePath(basePath);
  if (url.pathname !== routeBase && !url.pathname.startsWith(`${routeBase}/`)) {
    return false;
  }
  if (!config) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_DISABLED",
      error: "Platform auth is disabled.",
    });
    return true;
  }
  const bootstrapPath = `${routeBase}/platform/bootstrap`;
  const allowedEntry = isLocalOrConfiguredPublicPlatformAccess({
    req,
    localDirect: params.localDirect,
  });
  if (!allowedEntry || (url.pathname === bootstrapPath && params.localDirect !== true)) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_LOCAL_ONLY",
      error: "Platform auth is only available from the local Control UI entry.",
    });
    return true;
  }

  if (url.pathname === `${routeBase}/session`) {
    return handleSessionRoute(req, res, config, params.trustedProxy, params.localDirect);
  }

  if (url.pathname === `${routeBase}/logout`) {
    return handleLogoutRoute(req, res, config);
  }

  if (url.pathname === `${routeBase}/platform/trial/applications`) {
    return handleTrialApplicationsRoute(req, res, config, params.trustedProxy, params.localDirect);
  }

  const writeOnlyRoutes = new Set<string>([
    `${routeBase}/platform/bootstrap`,
    `${routeBase}/platform/admin/create`,
    `${routeBase}/platform/admin/remove`,
    `${routeBase}/enterprise/create`,
    `${routeBase}/platform/trial/apply`,
    `${routeBase}/platform/trial/applications/approve`,
    `${routeBase}/platform/trial/applications/reject`,
    `${routeBase}/enterprise/admin/activate`,
    `${routeBase}/enterprise/admin/invite`,
    `${routeBase}/enterprise/admin/invite/accept`,
    `${routeBase}/login`,
    `${routeBase}/password/forgot`,
    `${routeBase}/password/reset`,
    `${routeBase}/password/change`,
    `${routeBase}/platform/enterprise/create`,
    `${routeBase}/platform/enterprise/trial/policy/update`,
    `${routeBase}/platform/enterprise/trial/instance/update`,
    `${routeBase}/platform/enterprise/admin/update`,
    `${routeBase}/platform/enterprise/admin/activation/send`,
    `${routeBase}/platform/security/mfa-policy`,
    `${routeBase}/employee/provision`,
    `${routeBase}/employee/activation/send`,
    `${routeBase}/employee/register`,
    `${routeBase}/employee/push/register`,
    `${routeBase}/employee/push/unregister`,
    `${routeBase}/session/switch`,
    `${routeBase}/employee-access/offer/accept`,
    `${routeBase}/employee-access/offer/decline`,
    `${routeBase}/member/remove`,
    `${routeBase}/register`,
    `${routeBase}/invite`,
    `${routeBase}/invite/revoke`,
  ]);
  const exportPrefix = `${routeBase}/enterprise-audit-export/`;
  if (url.pathname.startsWith(exportPrefix)) {
    return handleEnterpriseAuditExportDownload({
      req,
      res,
      exportId: decodeURIComponent(url.pathname.slice(exportPrefix.length)),
      trustedProxy: params.trustedProxy,
      localDirect: params.localDirect,
    });
  }

  if (!writeOnlyRoutes.has(url.pathname)) {
    sendJson(res, 404, {
      ok: false,
      code: "PLATFORM_AUTH_NOT_FOUND",
      error: "Not Found",
    });
    return true;
  }
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return true;
  }

  const parsedBody = await readJsonBody(req, PLATFORM_AUTH_BODY_LIMIT_BYTES);
  if (!parsedBody.ok) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_BODY",
      error: "Invalid request body.",
    });
    return true;
  }
  const body = parseRequestBody(parsedBody.value);
  if (!body) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_BODY",
      error: "Invalid request body.",
    });
    return true;
  }

  const retiredResult = handleRetiredRoutes(url.pathname, res, routeBase);
  if (retiredResult) {
    return true;
  }

  if (url.pathname === `${routeBase}/employee/provision`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEmployeeProvisionRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
        basePath,
      );
    });
  }

  if (url.pathname === `${routeBase}/employee/activation/send`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEmployeeActivationSendRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
        basePath,
      );
    });
  }

  if (url.pathname === `${routeBase}/employee/register`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEmployeeRegisterRoute(req, res, config, body);
    });
  }

  if (url.pathname === `${routeBase}/employee/push/register`) {
    return handleEmployeePushRegisterRoute(
      req,
      res,
      config,
      body,
      params.trustedProxy,
      params.localDirect,
    );
  }

  if (url.pathname === `${routeBase}/employee/push/unregister`) {
    return handleEmployeePushUnregisterRoute(
      req,
      res,
      config,
      body,
      params.trustedProxy,
      params.localDirect,
    );
  }

  if (url.pathname === `${routeBase}/session/switch`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleSessionSwitchRoute(
        req,
        res,
        config,
        params.trustedProxy,
        params.localDirect,
        body,
      );
    });
  }

  if (url.pathname === `${routeBase}/employee-access/offer/accept`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEmployeeAccessOfferAcceptRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/employee-access/offer/decline`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEmployeeAccessOfferDeclineRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/member/remove`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleMemberRemoveRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/bootstrap`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePlatformBootstrapRoute(req, res, config, body);
    });
  }

  if (url.pathname === `${routeBase}/platform/admin/create`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePlatformAdminCreateRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/admin/remove`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePlatformAdminRemoveRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/enterprise/create`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEnterpriseCreateRoute(req, res, config, body);
    });
  }

  if (url.pathname === `${routeBase}/platform/enterprise/create`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePlatformEnterpriseCreateRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/trial/apply`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleTrialApplyRoute(req, res, config, body);
    });
  }

  if (url.pathname === `${routeBase}/enterprise/admin/activate`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEnterpriseAdminActivateRoute(req, res, config, body);
    });
  }

  if (url.pathname === `${routeBase}/enterprise/admin/invite`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEnterpriseCoAdminInviteRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
        basePath,
      );
    });
  }

  if (url.pathname === `${routeBase}/enterprise/admin/invite/accept`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleEnterpriseCoAdminInviteAcceptRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/login`) {
    // Accepting an enterprise co-admin invite during login writes a membership;
    // serialize that path with other store writers.
    if (typeof body.adminInviteCode === "string" && body.adminInviteCode.trim()) {
      return withPlatformAuthStoreWriteLock(config, async () => {
        return handleLoginRoute(req, res, config, body);
      });
    }
    return handleLoginRoute(req, res, config, body);
  }

  if (url.pathname === `${routeBase}/platform/security/mfa-policy`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleMfaPolicyRoute(req, res, config, params.trustedProxy, params.localDirect, body);
    });
  }

  if (url.pathname === `${routeBase}/password/forgot`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePasswordForgotRoute(req, res, config, body);
    });
  }

  if (url.pathname === `${routeBase}/password/reset`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePasswordResetRoute(req, res, config, body);
    });
  }

  if (url.pathname === `${routeBase}/password/change`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePasswordChangeRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/trial/applications/approve`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleTrialApplicationApproveRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/trial/applications/reject`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleTrialApplicationRejectRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/enterprise/trial/policy/update`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleTrialPolicyUpdateRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/enterprise/trial/instance/update`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handleTrialInstanceUpdateRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/enterprise/admin/update`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePlatformEnterpriseAdminUpdateRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  if (url.pathname === `${routeBase}/platform/enterprise/admin/activation/send`) {
    return withPlatformAuthStoreWriteLock(config, async () => {
      return handlePlatformEnterpriseAdminActivationSendRoute(
        req,
        res,
        config,
        body,
        params.trustedProxy,
        params.localDirect,
      );
    });
  }

  sendJson(res, 404, {
    ok: false,
    code: "PLATFORM_AUTH_NOT_FOUND",
    error: "Not Found",
  });
  return true;
}
