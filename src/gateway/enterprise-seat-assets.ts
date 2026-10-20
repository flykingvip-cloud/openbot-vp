import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../config/types.gateway.js";
import type { ControlUiPlatformOrganizationSnapshot } from "./control-ui-contract.js";
import { resolveControlUiEnterpriseBasePath } from "./control-ui-contract.js";
import {
  applyOrganizationDepartmentMutation,
  type OrganizationDepartmentMutationAction,
} from "./enterprise-org-departments.js";
import { normalizeHandoverTransferSelection } from "./enterprise-seat-assets-governance.js";
import {
  cancelSeatAssignmentOffer,
  buildSeatAccessSnapshot,
  approveSeatHandover,
  assignSeatToEmployee,
  completeSeatHandover,
  configureSeatProfile,
  createSeatAssignmentOffer,
  ensureSeatForProvision,
  grantEnterpriseAccessPolicy,
  listTenantAccessPolicies,
  listTenantAssetAuditEvents,
  listTenantHandovers,
  listTenantSeatAssetBindings,
  listTenantSeatAssignmentOffers,
  listTenantSeats,
  loadEnterpriseSeatAssetsStore,
  revokeEnterpriseAccessPolicy,
  nominateSeatHandoverSuccessor,
  reviewSeatHandover,
  recordEnterpriseAssetAuditEvent,
  saveEnterpriseSeatAssetsStore,
  startSeatHandover,
  validateEnterpriseAssetGovernance,
  type EnterpriseAccessAction,
  type EnterpriseAccessResourceType,
  type EnterpriseAccessSubjectType,
} from "./enterprise-seat-assets-store.js";
import { deleteSeatAndMember } from "./enterprise-seat-person-deletion.js";
import { readJsonBody } from "./hooks.js";
import { sendJson, sendMethodNotAllowed } from "./http-common.js";
import {
  applyPlatformAuthEmailDeliveryResult,
  deliverPlatformAuthEmailNotification,
  type PlatformAuthEmailDeliveryResult,
} from "./platform-auth-email.js";
import {
  buildPlatformOrganizationSnapshot,
  enqueuePlatformAuthNotification,
  findMembershipByUserId,
  findUserByEmail,
  loadPlatformAuthStore,
  normalizeBoolean,
  readPlatformAuthSessionContextFromRequest,
  resolveEnterpriseAdminSessionContext,
  resolvePlatformAuthConfig,
  revokePendingEmployeeProvisionsForSeat,
  savePlatformAuthStore,
  withPlatformAuthStoreWriteLock,
  type PlatformAuthStore,
  type PlatformAuthUser,
} from "./platform-auth.js";
import { isLocalOrConfiguredPublicPlatformAccess } from "./platform-auth/public-request.js";
import {
  loadSeatAssetsStoreForContext,
  resolveSeatAssetsStorePathFromContext,
} from "./platform-auth/seat-store-loader.js";

/** Routes owned by `handleEnterpriseOperationalIdentityHttpRequest` (must not be consumed here). */
const OPERATIONAL_IDENTITY_HTTP_RESOURCES = new Set([
  "identities",
  "identity-policies",
  "identity-bindings",
  "credentials",
]);

function isOperationalIdentityHttpResource(resource: string | undefined): boolean {
  return Boolean(resource && OPERATIONAL_IDENTITY_HTTP_RESOURCES.has(resource));
}

const ENTERPRISE_ASSETS_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_SEAT_ASSIGNMENT_OFFER_TTL_DAYS = 7;

type EnterpriseAssetsRequestOptions = {
  basePath?: string;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  localDirect?: boolean;
};

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string {
  return requiredString(value).toLowerCase();
}

function requiredStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function parseAccessSubjectType(value: unknown): EnterpriseAccessSubjectType | null {
  const subjectType = requiredString(value);
  return subjectType === "employee" || subjectType === "seat" ? subjectType : null;
}

function parseAccessResourceType(value: unknown): EnterpriseAccessResourceType | null {
  const resourceType = requiredString(value);
  return ["seat", "agent", "space", "memory", "connector", "capability"].includes(resourceType)
    ? (resourceType as EnterpriseAccessResourceType)
    : null;
}

function parseAccessAction(value: unknown): EnterpriseAccessAction | null {
  const action = requiredString(value);
  return ["read", "write", "execute", "manage"].includes(action)
    ? (action as EnterpriseAccessAction)
    : null;
}

function defaultSeatAssignmentOfferExpiresAt(now = Date.now()): string {
  return new Date(now + DEFAULT_SEAT_ASSIGNMENT_OFFER_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function resolvePublicPlatformBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw =
    env.OPENBOT_PUBLIC_APP_BASE_URL?.trim() ||
    env.OPENBOT_PUBLIC_WEB_BASE_URL?.trim() ||
    env.OPENBOT_PUBLIC_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_APP_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_WEB_BASE_URL?.trim() ||
    env.OPENCLAW_PUBLIC_BASE_URL?.trim() ||
    "";
  if (!raw) {
    return null;
  }
  return raw.replace(/\/+$/, "");
}

function resolveRequestOrigin(req: IncomingMessage): string {
  const publicBaseUrl = resolvePublicPlatformBaseUrl();
  if (publicBaseUrl) {
    return publicBaseUrl;
  }
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string" && forwardedProto.trim()
      ? forwardedProto.trim().split(",")[0]?.trim() || "http"
      : (req.socket as { encrypted?: boolean } | undefined)?.encrypted
        ? "https"
        : "http";
  const forwardedHost = Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : req.headers["x-forwarded-host"];
  const host =
    typeof forwardedHost === "string" && forwardedHost.trim()
      ? forwardedHost.trim().split(",")[0]?.trim()
      : Array.isArray(req.headers.host)
        ? req.headers.host[0]
        : req.headers.host;
  return `${proto || "http"}://${host?.trim() || "127.0.0.1:18789"}`;
}

function buildSeatOfferConfirmationUrl(params: {
  req: IncomingMessage;
  basePath?: string;
  offerId: string;
}): string {
  const normalizedBase = params.basePath?.trim().replace(/\/+$/, "") ?? "";
  const url = new URL(`${normalizedBase || ""}/enterprise/login`, resolveRequestOrigin(params.req));
  url.searchParams.set("workbench", "settings");
  url.searchParams.set("settingsView", "personal");
  url.searchParams.set("seatOffer", params.offerId);
  url.hash = "seat-offer";
  return url.toString();
}

function queueSeatAssignmentOfferEmail(params: {
  store: PlatformAuthStore;
  req: IncomingMessage;
  basePath?: string;
  tenantId: string;
  offer: ReturnType<typeof createSeatAssignmentOffer>;
  targetUser: PlatformAuthUser;
  offeredBy: PlatformAuthUser;
  createdAt: string;
  reminder: boolean;
}) {
  const enterprise = params.store.enterprises[params.tenantId];
  return enqueuePlatformAuthNotification({
    store: params.store,
    type: params.reminder ? "seat-assignment-offer-reminder-email" : "seat-assignment-offer-email",
    email: params.targetUser.email,
    enterpriseId: params.tenantId,
    payload: {
      assignmentId: params.offer.assignmentId ?? params.offer.offerId,
      offerId: params.offer.offerId,
      tenantId: params.tenantId,
      enterpriseName: enterprise?.name ?? params.tenantId,
      seatId: params.offer.seatId,
      seatTitle: params.offer.packageSnapshot.seatTitle,
      defaultAgentId: params.offer.packageSnapshot.defaultAgentId,
      agentIds: [...(params.offer.packageSnapshot.agentIds ?? [])],
      defaultSpaceIds: [...params.offer.packageSnapshot.defaultSpaceIds],
      employeeEmail: params.targetUser.email,
      employeeDisplayName: params.targetUser.displayName,
      offeredByEmail: params.offeredBy.email,
      offeredByDisplayName: params.offeredBy.displayName,
      offeredAt: params.offer.offeredAt,
      expiresAt: params.offer.expiresAt ?? null,
      confirmationUrl: buildSeatOfferConfirmationUrl({
        req: params.req,
        basePath: params.basePath,
        offerId: params.offer.offerId,
      }),
      reminder: params.reminder,
    },
    createdAt: params.createdAt,
  });
}

async function deliverQueuedSeatAssignmentOfferEmail(params: {
  notification: ReturnType<typeof queueSeatAssignmentOfferEmail>;
  deliveredAt: string;
}): Promise<PlatformAuthEmailDeliveryResult> {
  const emailDelivery = await deliverPlatformAuthEmailNotification(params.notification);
  applyPlatformAuthEmailDeliveryResult(params.notification, emailDelivery, params.deliveredAt);
  return emailDelivery;
}

function parseRequestBody(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function resolveEnterpriseRoute(params: { pathname: string; basePath?: string }) {
  const routeBase = resolveControlUiEnterpriseBasePath(params.basePath);
  if (params.pathname !== routeBase && !params.pathname.startsWith(`${routeBase}/`)) {
    return null;
  }
  const relative = params.pathname.slice(routeBase.length).replace(/^\/+/, "");
  const segments = relative
    ? relative.split("/").map((segment) => decodeURIComponent(segment))
    : [];
  const tenantId = segments[0]?.trim() ?? "";
  return {
    routeBase,
    tenantId,
    segments: segments.slice(1),
  };
}

function sendForbidden(res: ServerResponse, code: string, error: string) {
  sendJson(res, 403, { ok: false, code, error });
}

function sendBadRequest(res: ServerResponse, code: string, error: string) {
  sendJson(res, 400, { ok: false, code, error });
}

function sendNotFound(res: ServerResponse, code: string, error: string) {
  sendJson(res, 404, { ok: false, code, error });
}

function buildUpdatedSnapshot(
  store: PlatformAuthStore,
  seatStore: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>,
  tenantId: string,
): { organization?: ControlUiPlatformOrganizationSnapshot } {
  return {
    organization: buildPlatformOrganizationSnapshot({
      store,
      seatStore,
      enterpriseId: tenantId,
    }),
  };
}

function findTenantUser(params: {
  store: PlatformAuthStore;
  tenantId: string;
  employeeEmail?: string;
  employeeId?: string;
}): PlatformAuthUser | null {
  const user = params.employeeId?.trim()
    ? (params.store.users[params.employeeId.trim()] ?? null)
    : params.employeeEmail?.trim()
      ? findUserByEmail(params.store, params.employeeEmail.trim().toLowerCase())
      : null;
  if (!user) {
    return null;
  }
  const membership = findMembershipByUserId(params.store, user.id);
  if (!membership || membership.enterpriseId !== params.tenantId) {
    return null;
  }
  return user;
}

function findSeatBinding(
  seatStore: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>,
  seatId: string,
) {
  return (
    Object.values(seatStore.bindings)
      .filter((binding) => binding.seatId === seatId)
      .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null
  );
}

function buildSeatDetail(params: {
  store: PlatformAuthStore;
  seatStore: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  tenantId: string;
  seatId: string;
}) {
  const seat = params.seatStore.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    return null;
  }
  const currentEmployee = seat.currentEmployeeId
    ? params.store.users[seat.currentEmployeeId]
    : null;
  const currentMembership = currentEmployee
    ? findMembershipByUserId(params.store, currentEmployee.id)
    : null;
  const latestBinding = findSeatBinding(params.seatStore, seat.seatId);
  const latestHandover =
    listTenantHandovers(params.seatStore, params.tenantId).find(
      (handover) => handover.seatId === seat.seatId,
    ) ?? null;
  const access = buildSeatAccessSnapshot({
    store: params.seatStore,
    tenantId: params.tenantId,
    seatId: seat.seatId,
  });
  const assetBindings = Object.values(params.seatStore.assetBindings)
    .filter((binding) => binding.tenantId === params.tenantId && binding.seatId === seat.seatId)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  const credentialBindings = Object.values(params.seatStore.credentialBindings)
    .filter(
      (binding) =>
        binding.tenantId === params.tenantId &&
        ((binding.ownerType === "seat" && binding.ownerId === seat.seatId) ||
          (latestBinding &&
            binding.ownerType === "employee" &&
            binding.ownerId === latestBinding.employeeId)),
    )
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    seat: {
      seatId: seat.seatId,
      title: seat.title,
      ...(seat.teamLabel ? { teamLabel: seat.teamLabel } : {}),
      ...(seat.responsibility ? { responsibility: seat.responsibility } : {}),
      ...(seat.roleCode ? { roleCode: seat.roleCode } : {}),
      status: seat.status,
      defaultAgentIds: [...seat.defaultAgentAssetIds],
      defaultSpaceIds: [...seat.defaultSpaceIds],
    },
    ...(currentEmployee
      ? {
          currentEmployee: {
            userId: currentEmployee.id,
            email: currentEmployee.email,
            displayName: currentEmployee.displayName,
            status: currentEmployee.status,
            membershipRole: currentMembership?.membershipRole,
          },
        }
      : {}),
    ...(latestBinding
      ? {
          binding: {
            bindingId: latestBinding.bindingId,
            employeeId: latestBinding.employeeId,
            status: latestBinding.bindingStatus,
            effectiveAt: latestBinding.effectiveAt,
            ...(latestBinding.endedAt ? { endedAt: latestBinding.endedAt } : {}),
            ...(latestBinding.endedReason ? { endedReason: latestBinding.endedReason } : {}),
          },
        }
      : {}),
    ...(latestHandover
      ? {
          handover: {
            handoverCaseId: latestHandover.handoverCaseId,
            status: latestHandover.status,
            reviewSummary: latestHandover.reviewSummary,
            exceptionFlags: [...latestHandover.exceptionFlags],
            approvedBy: latestHandover.approvedBy,
            createdAt: latestHandover.createdAt,
            updatedAt: latestHandover.updatedAt,
            completedAt: latestHandover.completedAt,
          },
        }
      : {}),
    access,
    assetBindings,
    credentialBindings,
  };
}

async function requireEnterpriseAdminContext(
  req: IncomingMessage,
  res: ServerResponse,
  params: {
    trustedProxy: GatewayTrustedProxyConfig | undefined;
    localDirect?: boolean;
    tenantId: string;
  },
) {
  if (!isLocalOrConfiguredPublicPlatformAccess({ req, localDirect: params.localDirect })) {
    sendForbidden(
      res,
      "ENTERPRISE_ASSETS_LOCAL_ONLY",
      "Enterprise seat asset commands require a local or configured public Control UI entry.",
    );
    return null;
  }
  const sessionContext = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy: params.trustedProxy,
    localDirect: params.localDirect,
  });
  if (!sessionContext) {
    sendJson(res, 401, {
      ok: false,
      code: "ENTERPRISE_ASSETS_UNAUTHORIZED",
      error: "Sign in with an enterprise administrator account first.",
    });
    return null;
  }
  const platformAuthConfig = resolvePlatformAuthConfig(params.trustedProxy);
  if (!platformAuthConfig) {
    sendJson(res, 401, {
      ok: false,
      code: "ENTERPRISE_ASSETS_UNAUTHORIZED",
      error: "Sign in with an enterprise administrator account first.",
    });
    return null;
  }
  const store = await loadPlatformAuthStore(platformAuthConfig);
  const context = resolveEnterpriseAdminSessionContext({
    store,
    context: sessionContext,
    enterpriseId: params.tenantId,
  });
  if (!context?.membership) {
    if (
      sessionContext.sessionKind === "platform-admin" ||
      sessionContext.sessionKind === "platform-super-admin"
    ) {
      sendForbidden(
        res,
        "ENTERPRISE_ASSETS_ADMIN_REQUIRED",
        "Only enterprise administrators can manage seat assets.",
      );
      return null;
    }
    if (!sessionContext.membership || sessionContext.membership.enterpriseId !== params.tenantId) {
      sendForbidden(
        res,
        "ENTERPRISE_ASSETS_TENANT_FORBIDDEN",
        "This tenant is not available in the current session.",
      );
      return null;
    }
    sendForbidden(
      res,
      "ENTERPRISE_ASSETS_ADMIN_REQUIRED",
      "Only enterprise administrators can manage seat assets.",
    );
    return null;
  }
  return context;
}

export async function handleEnterpriseSeatAssetsHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: EnterpriseAssetsRequestOptions,
): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const route = resolveEnterpriseRoute({ pathname: url.pathname, basePath: opts.basePath });
  if (!route) {
    return false;
  }
  if (!route.tenantId) {
    sendNotFound(res, "ENTERPRISE_ASSETS_TENANT_REQUIRED", "Tenant id is required.");
    return true;
  }

  const [resource, resourceId, action] = route.segments;
  if (isOperationalIdentityHttpResource(resource)) {
    return false;
  }

  const config = resolvePlatformAuthConfig(opts.trustedProxy);
  if (!config) {
    sendNotFound(
      res,
      "ENTERPRISE_ASSETS_NOT_ENABLED",
      "Enterprise seat assets are unavailable until platform auth is enabled.",
    );
    return true;
  }

  const context = await requireEnterpriseAdminContext(req, res, {
    trustedProxy: opts.trustedProxy,
    localDirect: opts.localDirect,
    tenantId: route.tenantId,
  });
  if (!context) {
    return true;
  }

  if (req.method === "GET" && resource === "seats" && !resourceId) {
    const store = await loadPlatformAuthStore(config);
    const seatStore = await loadSeatAssetsStoreForContext(context);
    sendJson(res, 200, {
      ok: true,
      seats: listTenantSeats(seatStore, route.tenantId),
      updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
    });
    return true;
  }
  if (req.method === "GET" && resource === "seats" && resourceId) {
    const store = await loadPlatformAuthStore(config);
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const detail = buildSeatDetail({
      store,
      seatStore,
      tenantId: route.tenantId,
      seatId: resourceId,
    });
    if (!detail) {
      sendNotFound(res, "ENTERPRISE_ASSETS_SEAT_NOT_FOUND", "Seat not found.");
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      detail,
      updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
    });
    return true;
  }
  if (req.method === "GET" && resource === "handover" && resourceId) {
    const store = await loadPlatformAuthStore(config);
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const handover = seatStore.handovers[resourceId];
    if (!handover || handover.tenantId !== route.tenantId) {
      sendNotFound(res, "ENTERPRISE_ASSETS_HANDOVER_NOT_FOUND", "Handover case not found.");
      return true;
    }
    const seat = seatStore.seats[handover.seatId];
    const outgoingUser = store.users[handover.outgoingEmployeeId];
    const incomingUser = handover.incomingEmployeeId
      ? store.users[handover.incomingEmployeeId]
      : null;
    sendJson(res, 200, {
      ok: true,
      handover: {
        ...handover,
        seatTitle: seat?.title ?? handover.seatId,
        seatStatus: seat?.status,
        ...(outgoingUser
          ? {
              outgoingEmployee: {
                userId: outgoingUser.id,
                email: outgoingUser.email,
                displayName: outgoingUser.displayName,
              },
            }
          : {}),
        ...(incomingUser
          ? {
              incomingEmployee: {
                userId: incomingUser.id,
                email: incomingUser.email,
                displayName: incomingUser.displayName,
              },
            }
          : {}),
      },
      updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
    });
    return true;
  }
  if (req.method === "GET" && resource === "access" && resourceId === "snapshot") {
    const store = await loadPlatformAuthStore(config);
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const policies = listTenantAccessPolicies(seatStore, route.tenantId);
    sendJson(res, 200, {
      ok: true,
      access: policies,
      members: Object.values(store.memberships)
        .filter((membership) => membership.enterpriseId === route.tenantId)
        .flatMap((membership) => {
          const user = store.users[membership.userId];
          if (!user) {
            return [];
          }
          return [
            {
              userId: user.id,
              email: user.email,
              displayName: user.displayName,
              membershipRole: membership.membershipRole,
            },
          ];
        }),
      updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
    });
    return true;
  }
  if (req.method === "GET" && resource === "assets" && resourceId === "bindings") {
    const store = await loadPlatformAuthStore(config);
    const seatStore = await loadSeatAssetsStoreForContext(context);
    sendJson(res, 200, {
      ok: true,
      assetBindings: listTenantSeatAssetBindings(seatStore, route.tenantId),
      credentialBindings: Object.values(seatStore.credentialBindings)
        .filter((binding) => binding.tenantId === route.tenantId)
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
      updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
    });
    return true;
  }
  if (req.method === "GET" && resource === "audit" && resourceId === "events") {
    const store = await loadPlatformAuthStore(config);
    const seatStore = await loadSeatAssetsStoreForContext(context);
    sendJson(res, 200, {
      ok: true,
      auditEvents: listTenantAssetAuditEvents(seatStore, route.tenantId),
      updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
    });
    return true;
  }
  if (req.method === "GET" && resource === "governance" && resourceId === "health") {
    const store = await loadPlatformAuthStore(config);
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const checks = validateEnterpriseAssetGovernance(seatStore, route.tenantId);
    sendJson(res, 200, {
      ok: checks.every((check) => check.severity !== "error"),
      checks,
      summary: {
        errorCount: checks.filter((check) => check.severity === "error").length,
        warningCount: checks.filter((check) => check.severity === "warning").length,
      },
      updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
    });
    return true;
  }

  const parsedBody = await readJsonBody(req, ENTERPRISE_ASSETS_BODY_LIMIT_BYTES);
  if (!parsedBody.ok) {
    sendBadRequest(res, "ENTERPRISE_ASSETS_INVALID_BODY", "Invalid request body.");
    return true;
  }
  const body = parseRequestBody(parsedBody.value);
  if (!body) {
    sendBadRequest(res, "ENTERPRISE_ASSETS_INVALID_BODY", "Invalid request body.");
    return true;
  }

  if (
    !(
      (resource === "seats" &&
        (!resourceId ||
          action === "assign" ||
          action === "unassign" ||
          action === "offers" ||
          action === "assets") &&
        req.method === "POST") ||
      (resource === "offers" &&
        (action === "cancel" || action === "remind") &&
        req.method === "POST") ||
      (resource === "handover" && req.method === "POST") ||
      (resource === "access" && req.method === "POST") ||
      (resource === "organization" && resourceId === "departments" && req.method === "POST")
    )
  ) {
    if (req.method !== "POST") {
      sendMethodNotAllowed(res);
      return true;
    }
    sendNotFound(res, "ENTERPRISE_ASSETS_ROUTE_NOT_FOUND", "Not found.");
    return true;
  }

  return withPlatformAuthStoreWriteLock(config, async () => {
    const store = await loadPlatformAuthStore(config);
    const seatStore = await loadSeatAssetsStoreForContext(context);
    const nowIso = new Date().toISOString();
    const auditId = randomUUID();

    if (resource === "organization" && resourceId === "departments") {
      const action = requiredString(body.action);
      if (
        !action ||
        ![
          "create",
          "rename",
          "move",
          "delete",
          "move-seat",
          "delete-seat",
          "delete-seat-and-member",
          "merge",
          "sync-structure",
          "reorder-children",
        ].includes(action)
      ) {
        sendBadRequest(
          res,
          "ENTERPRISE_ORG_DEPARTMENT_ACTION_INVALID",
          "Invalid department action.",
        );
        return true;
      }
      try {
        if (action === "delete-seat-and-member") {
          const seatId = requiredString(body.seatId);
          if (!seatId) {
            throw new Error("岗位 ID 不能为空。");
          }
          const removed = deleteSeatAndMember({
            authStore: store,
            seatStore,
            tenantId: route.tenantId,
            seatId,
            actorUserId: context.user.id,
            nowIso,
            auditId,
          });
          await savePlatformAuthStore(config, store);
          await saveEnterpriseSeatAssetsStore(
            resolveSeatAssetsStorePathFromContext(context),
            seatStore,
          );
          sendJson(res, 200, {
            ok: true,
            fullPath: removed.teamLabel,
            affectedSeatIds: [seatId],
            auditId,
            conflicts: [],
            updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
          });
          return true;
        }
        const departmentAction = action as OrganizationDepartmentMutationAction;
        const seatIdForDelete =
          departmentAction === "delete-seat" ? requiredString(body.seatId) || null : null;
        const result = applyOrganizationDepartmentMutation({
          store: seatStore,
          tenantId: route.tenantId,
          mutation: {
            action: departmentAction,
            path: requiredString(body.path ?? body.fullPath ?? body.sourcePath) || null,
            label: requiredString(body.label ?? body.name) || null,
            parentPath:
              typeof body.parentPath === "string"
                ? body.parentPath.trim()
                : typeof body.parentTeamPath === "string"
                  ? body.parentTeamPath.trim()
                  : null,
            seatId: requiredString(body.seatId) || null,
            targetPath: requiredString(body.targetPath ?? body.teamLabel) || null,
            paths: requiredStringList(body.paths),
            orderedKeys: requiredStringList(body.orderedKeys),
          },
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        // Revoke only after the seat is removed so a failed delete keeps invites intact.
        if (seatIdForDelete) {
          const revoked = revokePendingEmployeeProvisionsForSeat({
            store,
            enterpriseId: route.tenantId,
            seatId: seatIdForDelete,
            nowIso,
            reason: "seat_deleted",
          });
          if (revoked > 0) {
            await savePlatformAuthStore(config, store);
          }
        }
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          fullPath: result.fullPath,
          affectedSeatIds: result.affectedSeatIds,
          ...(result.createdPaths ? { createdPaths: result.createdPaths } : {}),
          auditId,
          conflicts: [],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ORG_DEPARTMENT_MUTATION_FAILED",
          error instanceof Error ? error.message : "Organization department mutation failed.",
        );
      }
      return true;
    }

    if (resource === "seats" && !resourceId) {
      const seatTitle = requiredString(body.title ?? body.seatTitle);
      if (!seatTitle) {
        sendBadRequest(res, "ENTERPRISE_ASSETS_SEAT_TITLE_REQUIRED", "Seat title is required.");
        return true;
      }
      try {
        const seat = ensureSeatForProvision({
          store: seatStore,
          tenantId: route.tenantId,
          seatTitle,
          teamLabel: requiredString(body.teamLabel ?? body.team),
          responsibility: requiredString(body.responsibility),
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 201, {
          ok: true,
          seat,
          auditId,
          conflicts: [],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_SEAT_CREATE_FAILED",
          error instanceof Error ? error.message : "Seat creation failed.",
        );
      }
      return true;
    }

    if (resource === "seats" && resourceId && action === "assets") {
      try {
        const seat = configureSeatProfile({
          store: seatStore,
          tenantId: route.tenantId,
          seatId: resourceId,
          seatTitle: requiredString(body.title ?? body.seatTitle) || undefined,
          teamLabel:
            body.teamLabel !== undefined || body.team !== undefined
              ? requiredString(body.teamLabel ?? body.team)
              : undefined,
          responsibility:
            body.responsibility !== undefined ? requiredString(body.responsibility) : undefined,
          defaultAgentId:
            body.defaultAgentId !== undefined
              ? requiredString(body.defaultAgentId) || null
              : undefined,
          agentIds:
            body.agentIds !== undefined || body.defaultAgentIds !== undefined
              ? requiredStringList(body.agentIds ?? body.defaultAgentIds)
              : undefined,
          defaultSpaceIds:
            body.defaultSpaceIds !== undefined
              ? requiredStringList(body.defaultSpaceIds)
              : undefined,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          seat,
          auditId,
          conflicts: [],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_SEAT_ASSETS_FAILED",
          error instanceof Error ? error.message : "Seat AI asset configuration failed.",
        );
      }
      return true;
    }

    if (resource === "seats" && resourceId && action === "offers") {
      const targetUser = findTenantUser({
        store,
        tenantId: route.tenantId,
        employeeEmail: normalizeEmail(body.employeeEmail ?? body.email),
        employeeId: requiredString(body.employeeId),
      });
      if (!targetUser) {
        sendNotFound(
          res,
          "ENTERPRISE_ASSETS_MEMBER_NOT_FOUND",
          "Target employee was not found in this tenant.",
        );
        return true;
      }
      if (targetUser.status !== "active") {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_MEMBER_INACTIVE",
          "Target employee must be active before seat assignment confirmation.",
        );
        return true;
      }
      try {
        const handover =
          listTenantHandovers(seatStore, route.tenantId).find(
            (entry) => entry.seatId === resourceId && entry.status !== "completed",
          ) ?? null;
        const offer = createSeatAssignmentOffer({
          store: seatStore,
          tenantId: route.tenantId,
          seatId: resourceId,
          targetEmployeeId: targetUser.id,
          offeredByEmployeeId: context.user.id,
          assignmentType: "internal",
          inheritMode:
            body.inheritMode === "selective" || body.inheritMode === "full"
              ? body.inheritMode
              : undefined,
          agentIds:
            body.agentIds !== undefined || body.defaultAgentIds !== undefined
              ? requiredStringList(body.agentIds ?? body.defaultAgentIds)
              : undefined,
          defaultSpaceIds:
            body.defaultSpaceIds !== undefined
              ? requiredStringList(body.defaultSpaceIds)
              : undefined,
          inheritMemoryScope:
            body.inheritMemoryScope !== undefined
              ? normalizeBoolean(body.inheritMemoryScope)
              : undefined,
          ...(handover ? { handoverCaseId: handover.handoverCaseId } : {}),
          nowIso,
          expiresAt: defaultSeatAssignmentOfferExpiresAt(),
          auditId,
        });
        const notification = queueSeatAssignmentOfferEmail({
          store,
          req,
          basePath: opts.basePath,
          tenantId: route.tenantId,
          offer,
          targetUser,
          offeredBy: context.user,
          createdAt: nowIso,
          reminder: false,
        });
        const emailDelivery = await deliverQueuedSeatAssignmentOfferEmail({
          notification,
          deliveredAt: new Date().toISOString(),
        });
        if (offer.packageSnapshot.connectorCredentialReauthorizationRequired) {
          recordEnterpriseAssetAuditEvent({
            store: seatStore,
            tenantId: route.tenantId,
            eventType: "credential.reauthorization.required",
            nowIso,
            auditId,
            actorEmployeeId: context.user.id,
            seatId: offer.seatId,
            handoverCaseId: offer.handoverCaseId,
            offerId: offer.offerId,
            metadata: {
              assignmentId: offer.assignmentId ?? offer.offerId,
              connectorProfileIds: [...(offer.packageSnapshot.connectorProfileIds ?? [])],
            },
          });
        }
        await savePlatformAuthStore(config, store);
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 201, {
          ok: true,
          offer,
          auditId,
          conflicts: [],
          emailDelivery,
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_OFFER_CREATE_FAILED",
          error instanceof Error ? error.message : "Seat assignment confirmation failed.",
        );
      }
      return true;
    }

    if (resource === "seats" && resourceId && action === "assign") {
      const targetUser = findTenantUser({
        store,
        tenantId: route.tenantId,
        employeeEmail: normalizeEmail(body.employeeEmail ?? body.email),
        employeeId: requiredString(body.employeeId),
      });
      if (!targetUser) {
        sendNotFound(
          res,
          "ENTERPRISE_ASSETS_MEMBER_NOT_FOUND",
          "Target employee was not found in this tenant.",
        );
        return true;
      }
      if (targetUser.status !== "active") {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_MEMBER_INACTIVE",
          "Target employee must be active before seat assignment.",
        );
        return true;
      }
      try {
        assignSeatToEmployee({
          store: seatStore,
          tenantId: route.tenantId,
          seatId: resourceId,
          employeeId: targetUser.id,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        completeSeatHandover({
          store: seatStore,
          tenantId: route.tenantId,
          seatId: resourceId,
          incomingEmployeeId: targetUser.id,
          approvedBy: context.user.id,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_ASSIGN_FAILED",
          error instanceof Error ? error.message : "Seat assignment failed.",
        );
        return true;
      }
      await saveEnterpriseSeatAssetsStore(
        resolveSeatAssetsStorePathFromContext(context),
        seatStore,
      );
      sendJson(res, 200, {
        ok: true,
        auditId,
        conflicts: [],
        updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
      });
      return true;
    }

    if (resource === "offers" && resourceId && action === "cancel") {
      try {
        const offer = cancelSeatAssignmentOffer({
          store: seatStore,
          tenantId: route.tenantId,
          offerId: resourceId,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          offer,
          auditId,
          conflicts: [],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_OFFER_CANCEL_FAILED",
          error instanceof Error ? error.message : "Seat assignment offer cancellation failed.",
        );
      }
      return true;
    }

    if (resource === "offers" && resourceId && action === "remind") {
      try {
        const offer =
          listTenantSeatAssignmentOffers(seatStore, route.tenantId).find(
            (entry) => entry.offerId === resourceId,
          ) ?? null;
        if (!offer) {
          sendNotFound(
            res,
            "ENTERPRISE_ASSETS_OFFER_NOT_FOUND",
            "Seat assignment offer not found.",
          );
          return true;
        }
        if (offer.status !== "pending") {
          sendBadRequest(
            res,
            "ENTERPRISE_ASSETS_OFFER_NOT_PENDING",
            "Only pending seat assignment offers can be reminded.",
          );
          return true;
        }
        const targetUser = store.users[offer.targetEmployeeId];
        if (!targetUser) {
          sendNotFound(
            res,
            "ENTERPRISE_ASSETS_OFFER_MEMBER_NOT_FOUND",
            "Target employee was not found in this tenant.",
          );
          return true;
        }
        const notification = queueSeatAssignmentOfferEmail({
          store,
          req,
          basePath: opts.basePath,
          tenantId: route.tenantId,
          offer,
          targetUser,
          offeredBy: context.user,
          createdAt: nowIso,
          reminder: true,
        });
        const emailDelivery = await deliverQueuedSeatAssignmentOfferEmail({
          notification,
          deliveredAt: new Date().toISOString(),
        });
        recordEnterpriseAssetAuditEvent({
          store: seatStore,
          tenantId: route.tenantId,
          eventType: "assignment.reminded",
          nowIso,
          auditId,
          actorEmployeeId: context.user.id,
          seatId: offer.seatId,
          handoverCaseId: offer.handoverCaseId,
          offerId: offer.offerId,
          metadata: {
            assignmentId: offer.assignmentId ?? offer.offerId,
            assignmentType: offer.assignmentType ?? "internal",
            targetEmployeeId: offer.targetEmployeeId,
          },
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        await savePlatformAuthStore(config, store);
        sendJson(res, 200, {
          ok: true,
          offer,
          auditId,
          conflicts: [],
          emailDelivery,
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_OFFER_REMIND_FAILED",
          error instanceof Error ? error.message : "Seat assignment offer reminder failed.",
        );
      }
      return true;
    }

    if (resource === "seats" && resourceId && action === "unassign") {
      try {
        const handover = startSeatHandover({
          store: seatStore,
          tenantId: route.tenantId,
          seatId: resourceId,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          handover,
          auditId,
          conflicts: [...handover.exceptionFlags],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_UNASSIGN_FAILED",
          error instanceof Error ? error.message : "Seat unassign failed.",
        );
      }
      return true;
    }

    if (resource === "handover" && resourceId === "start") {
      const seatId = requiredString(body.seatId);
      if (!seatId) {
        sendBadRequest(res, "ENTERPRISE_ASSETS_SEAT_REQUIRED", "Seat id is required.");
        return true;
      }
      try {
        const handover = startSeatHandover({
          store: seatStore,
          tenantId: route.tenantId,
          seatId,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          handover,
          auditId,
          conflicts: [...handover.exceptionFlags],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_HANDOVER_START_FAILED",
          error instanceof Error ? error.message : "Handover start failed.",
        );
      }
      return true;
    }

    if (resource === "handover" && resourceId && action === "nominate") {
      const handover = seatStore.handovers[resourceId];
      if (!handover || handover.tenantId !== route.tenantId) {
        sendNotFound(res, "ENTERPRISE_ASSETS_HANDOVER_NOT_FOUND", "Handover case not found.");
        return true;
      }
      const targetUser = findTenantUser({
        store,
        tenantId: route.tenantId,
        employeeEmail: normalizeEmail(body.employeeEmail ?? body.email),
        employeeId: requiredString(body.employeeId),
      });
      if (!targetUser) {
        sendNotFound(
          res,
          "ENTERPRISE_ASSETS_MEMBER_NOT_FOUND",
          "Target employee was not found in this tenant.",
        );
        return true;
      }
      if (targetUser.status !== "active") {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_MEMBER_INACTIVE",
          "Target employee must be active before handover nomination.",
        );
        return true;
      }
      try {
        const updatedHandover = nominateSeatHandoverSuccessor({
          store: seatStore,
          tenantId: route.tenantId,
          handoverCaseId: resourceId,
          incomingEmployeeId: targetUser.id,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          handover: updatedHandover,
          auditId,
          conflicts: [...updatedHandover.exceptionFlags],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_HANDOVER_NOMINATE_FAILED",
          error instanceof Error ? error.message : "Handover nomination failed.",
        );
      }
      return true;
    }

    if (resource === "handover" && resourceId && action === "review") {
      const reviewSummary = requiredString(body.reviewSummary);
      if (!reviewSummary) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_REVIEW_SUMMARY_REQUIRED",
          "Review summary is required.",
        );
        return true;
      }
      try {
        const handover = reviewSeatHandover({
          store: seatStore,
          tenantId: route.tenantId,
          handoverCaseId: resourceId,
          reviewSummary,
          exceptionFlags: requiredStringList(body.exceptionFlags),
          transferSelection: normalizeHandoverTransferSelection(body.transferSelection),
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          handover,
          auditId,
          conflicts: [...handover.exceptionFlags],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_HANDOVER_REVIEW_FAILED",
          error instanceof Error ? error.message : "Handover review failed.",
        );
      }
      return true;
    }

    if (resource === "handover" && resourceId && action === "approve") {
      try {
        const handover = approveSeatHandover({
          store: seatStore,
          tenantId: route.tenantId,
          handoverCaseId: resourceId,
          approvedBy: context.user.id,
          nowIso,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          handover,
          auditId,
          conflicts: [...handover.exceptionFlags],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_HANDOVER_APPROVE_FAILED",
          error instanceof Error ? error.message : "Handover approval failed.",
        );
      }
      return true;
    }

    if (resource === "handover" && resourceId && action === "rebind") {
      const handover = seatStore.handovers[resourceId];
      if (!handover || handover.tenantId !== route.tenantId) {
        sendNotFound(res, "ENTERPRISE_ASSETS_HANDOVER_NOT_FOUND", "Handover case not found.");
        return true;
      }
      const targetUser = findTenantUser({
        store,
        tenantId: route.tenantId,
        employeeEmail: normalizeEmail(body.employeeEmail ?? body.email),
        employeeId: requiredString(body.employeeId),
      });
      if (!targetUser) {
        sendNotFound(
          res,
          "ENTERPRISE_ASSETS_MEMBER_NOT_FOUND",
          "Target employee was not found in this tenant.",
        );
        return true;
      }
      if (targetUser.status !== "active") {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_MEMBER_INACTIVE",
          "Target employee must be active before seat rebind.",
        );
        return true;
      }
      try {
        assignSeatToEmployee({
          store: seatStore,
          tenantId: route.tenantId,
          seatId: handover.seatId,
          employeeId: targetUser.id,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        completeSeatHandover({
          store: seatStore,
          tenantId: route.tenantId,
          seatId: handover.seatId,
          incomingEmployeeId: targetUser.id,
          approvedBy: context.user.id,
          nowIso,
          actorEmployeeId: context.user.id,
          auditId,
        });
        await saveEnterpriseSeatAssetsStore(
          resolveSeatAssetsStorePathFromContext(context),
          seatStore,
        );
        sendJson(res, 200, {
          ok: true,
          auditId,
          conflicts: [...handover.exceptionFlags],
          updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
        });
      } catch (error) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_HANDOVER_REBIND_FAILED",
          error instanceof Error ? error.message : "Handover rebind failed.",
        );
      }
      return true;
    }

    if (resource === "access" && resourceId === "grant") {
      const subjectType = parseAccessSubjectType(body.subjectType);
      const subjectId = requiredString(body.subjectId);
      const resourceType = parseAccessResourceType(body.resourceType);
      const targetResourceId = requiredString(body.resourceId);
      const actionName = parseAccessAction(body.action);
      if (!subjectType || !subjectId || !resourceType || !targetResourceId || !actionName) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_ACCESS_FIELDS_REQUIRED",
          "subjectType, subjectId, resourceType, resourceId, and action are required.",
        );
        return true;
      }
      const policy = grantEnterpriseAccessPolicy({
        store: seatStore,
        tenantId: route.tenantId,
        subjectType,
        subjectId,
        resourceType,
        resourceId: targetResourceId,
        action: actionName,
        nowIso,
        actorEmployeeId: context.user.id,
        auditId,
      });
      await saveEnterpriseSeatAssetsStore(
        resolveSeatAssetsStorePathFromContext(context),
        seatStore,
      );
      sendJson(res, 200, {
        ok: true,
        policy,
        auditId,
        conflicts: [],
        updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
      });
      return true;
    }

    if (resource === "access" && resourceId === "revoke") {
      const subjectType = parseAccessSubjectType(body.subjectType);
      const subjectId = requiredString(body.subjectId);
      if (!subjectType || !subjectId) {
        sendBadRequest(
          res,
          "ENTERPRISE_ASSETS_ACCESS_FIELDS_REQUIRED",
          "subjectType and subjectId are required.",
        );
        return true;
      }
      const revoked = revokeEnterpriseAccessPolicy({
        store: seatStore,
        tenantId: route.tenantId,
        subjectType,
        subjectId,
        resourceType: parseAccessResourceType(body.resourceType) ?? undefined,
        resourceId: requiredString(body.resourceId) || undefined,
        action: parseAccessAction(body.action) ?? undefined,
        nowIso,
        actorEmployeeId: context.user.id,
        auditId,
      });
      await saveEnterpriseSeatAssetsStore(
        resolveSeatAssetsStorePathFromContext(context),
        seatStore,
      );
      sendJson(res, 200, {
        ok: true,
        revokedCount: revoked.length,
        auditId,
        conflicts: [],
        updatedSnapshot: buildUpdatedSnapshot(store, seatStore, route.tenantId),
      });
      return true;
    }

    sendNotFound(res, "ENTERPRISE_ASSETS_ROUTE_NOT_FOUND", "Not found.");
    return true;
  });
}
