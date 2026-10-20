import { loadConfig } from "../../config/config.js";
import { resolveBillingScope } from "../billing/scope.js";
import {
  assertNoOperationalIdentityExecutionElevation,
  listForbiddenOperationalIdentityInvokeFields,
} from "../enterprise-operational-identity-access.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import type {
  EnterprisePositionSeat,
  EnterpriseSeatBinding,
} from "../enterprise-seat-assets-store.js";
import {
  findUserByEmail,
  findUserById,
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
} from "../platform-auth.js";
import { resolveAuthoritativeEnterpriseScope } from "../platform-auth/active-membership-scope.js";
import { stringValue } from "../records.js";
import type { GatewayClient, RespondFn } from "../server-methods/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import type { EnterpriseDataInvokeContext, ScopeEvaluationContext } from "./types.js";

export {
  assertNoOperationalIdentityExecutionElevation,
  assertEnterpriseDataInvokeContextExcludesOperationalIdentity,
  listForbiddenOperationalIdentityInvokeFields,
} from "../enterprise-operational-identity-access.js";

export const TRUST_ATTESTATION = "server-session-v1" as const;
export const MATERIALIZER_TRUST_ATTESTATION = "projection-materializer-v1" as const;

export const MATERIALIZER_SEAT_ID = "seat-projection-materializer";
export const MATERIALIZER_EMPLOYEE_ID = "system:projection-materializer";

export type TrustedEnterpriseDataExecutionContext = EnterpriseDataInvokeContext & {
  trustAttestation: typeof TRUST_ATTESTATION;
};

export type TrustedMaterializerExecutionContext = EnterpriseDataInvokeContext & {
  trustAttestation: typeof MATERIALIZER_TRUST_ATTESTATION;
  agentId: "projection-materializer";
};

const FORBIDDEN_CLIENT_EXECUTION_FIELDS = [
  "tenantId",
  "seatId",
  "employeeId",
  "userId",
  "teamLabel",
  "roleCode",
  "departmentId",
] as const;

/** RPC must not override materializer execution identity or scope (tenantId is governance-resolved separately). */
const FORBIDDEN_MATERIALIZER_RUN_FIELDS = [
  "seatId",
  "employeeId",
  "userId",
  "teamLabel",
  "roleCode",
  "departmentId",
  "materializerSeatId",
] as const;

export function listForbiddenClientExecutionFields(params: Record<string, unknown>): string[] {
  return FORBIDDEN_CLIENT_EXECUTION_FIELDS.filter((field) => {
    const value = params[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function assertNoClientExecutionIdentity(params: Record<string, unknown>): void {
  const supplied = listForbiddenClientExecutionFields(params);
  if (supplied.length > 0) {
    throw new EnterpriseDataStoreError(
      "UNTRUSTED_CLIENT_CONTEXT",
      `Client must not supply execution identity fields: ${supplied.join(", ")}.`,
    );
  }
  assertNoOperationalIdentityExecutionElevation(params);
}

export function listForbiddenMaterializerRunFields(params: Record<string, unknown>): string[] {
  return FORBIDDEN_MATERIALIZER_RUN_FIELDS.filter((field) => {
    const value = params[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function assertNoMaterializerRunOverrides(params: Record<string, unknown>): void {
  const supplied = listForbiddenMaterializerRunFields(params);
  if (supplied.length > 0) {
    throw new EnterpriseDataStoreError(
      "UNTRUSTED_MATERIALIZER_OVERRIDE",
      `Materializer run must not accept execution override fields: ${supplied.join(", ")}.`,
    );
  }
}

export function assertTrustedExecutionContext(
  context: EnterpriseDataInvokeContext,
): asserts context is TrustedEnterpriseDataExecutionContext | TrustedMaterializerExecutionContext {
  if (
    context.trustAttestation !== TRUST_ATTESTATION &&
    context.trustAttestation !== MATERIALIZER_TRUST_ATTESTATION
  ) {
    throw new EnterpriseDataStoreError(
      "UNTRUSTED_EXECUTION_CONTEXT",
      "Execution context must be resolved from trusted server session or projection materializer.",
    );
  }
}

export function createMaterializerExecutionContext(params: {
  tenantId: string;
  teamLabel: string;
}): TrustedMaterializerExecutionContext {
  return {
    tenantId: params.tenantId,
    seatId: MATERIALIZER_SEAT_ID,
    employeeId: MATERIALIZER_EMPLOYEE_ID,
    userId: MATERIALIZER_EMPLOYEE_ID,
    teamLabel: params.teamLabel,
    agentId: "projection-materializer",
    trustAttestation: MATERIALIZER_TRUST_ATTESTATION,
  };
}

export function resolveMaterializerExecutionContextFromBinding(params: {
  tenantId: string;
  materializationTeamLabel?: string;
}): TrustedMaterializerExecutionContext {
  const teamLabel = params.materializationTeamLabel?.trim();
  if (!teamLabel) {
    throw new EnterpriseDataStoreError(
      "MATERIALIZATION_TEAM_LABEL_REQUIRED",
      "Binding must define materializationTeamLabel for controlled materializer scope.",
    );
  }
  return createMaterializerExecutionContext({
    tenantId: params.tenantId,
    teamLabel,
  });
}

function resolveExperimentalDepartmentId(seat: EnterprisePositionSeat): string | undefined {
  if (!seat.teamLabel && !seat.roleCode) {
    return undefined;
  }
  return [seat.roleCode ?? "", seat.teamLabel ?? ""].filter(Boolean).join(":");
}

function findActiveBindingForEmployee(params: {
  bindings: EnterpriseSeatBinding[];
  tenantId: string;
  employeeId: string;
}): EnterpriseSeatBinding | null {
  return (
    params.bindings
      .filter(
        (entry) =>
          entry.tenantId === params.tenantId &&
          entry.employeeId === params.employeeId &&
          entry.bindingStatus === "active",
      )
      .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null
  );
}

function findActiveBindingForSeat(params: {
  bindings: EnterpriseSeatBinding[];
  tenantId: string;
  seatId: string;
}): EnterpriseSeatBinding | null {
  return (
    params.bindings
      .filter(
        (entry) =>
          entry.tenantId === params.tenantId &&
          entry.seatId === params.seatId &&
          entry.bindingStatus === "active",
      )
      .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null
  );
}

function buildExecutionContextFromSeat(params: {
  tenantId: string;
  seat: EnterprisePositionSeat;
  employeeId: string;
  userId: string;
  agentId?: string;
}): TrustedEnterpriseDataExecutionContext {
  if (params.seat.currentEmployeeId && params.seat.currentEmployeeId !== params.employeeId) {
    throw new EnterpriseDataStoreError(
      "NO_CURRENT_SEAT",
      "Seat assignment does not match active session employee.",
    );
  }
  return {
    tenantId: params.tenantId,
    seatId: params.seat.seatId,
    employeeId: params.employeeId,
    userId: params.userId,
    teamLabel: params.seat.teamLabel,
    roleCode: params.seat.roleCode,
    departmentId: resolveExperimentalDepartmentId(params.seat),
    agentId: params.agentId,
    trustAttestation: TRUST_ATTESTATION,
  };
}

/**
 * Bind the request to exactly one authoritative membership.
 *
 * Delegates to `resolveAuthoritativeEnterpriseScope`, which revalidates the session-pinned
 * `membershipId + enterpriseId` pair on every request and fails closed on a suspended account,
 * a suspended/expired enterprise, a half-bound context, or an ambiguous multi-tenant user.
 * Passing `membershipId` through is what makes that pinned-pair check reachable here; without
 * it the legacy first-match `findMembershipByUserId` could pick a membership by object order.
 *
 * Distinct causes are reported as distinct messages so the caller can classify them instead of
 * collapsing every failure into one opaque code.
 */
function resolveAuthoritativeSeatContextMembership(params: {
  store: Awaited<ReturnType<typeof loadPlatformAuthStore>>;
  email: string | null;
  platformUserId: string | null;
  sessionMembershipId?: string;
  sessionEnterpriseId?: string;
}): { user: { id: string }; tenantId: string } {
  const scope = resolveAuthoritativeEnterpriseScope({
    store: params.store,
    email: params.email,
    ...(params.sessionMembershipId ? { sessionMembershipId: params.sessionMembershipId } : {}),
    ...(params.sessionEnterpriseId ? { sessionEnterpriseId: params.sessionEnterpriseId } : {}),
    canonicalize: (value) => canonicalizeTenantId(value ?? null),
  });
  if (scope.kind === "authoritative") {
    return { user: scope.user, tenantId: scope.enterpriseId };
  }
  if (scope.kind === "deny") {
    const code =
      scope.reason === "membership-enterprise-mismatch" ||
      scope.reason === "requested-tenant-mismatch"
        ? "TENANT_MISMATCH"
        : "MEMBERSHIP_INVALID";
    const message =
      code === "TENANT_MISMATCH"
        ? "Enterprise membership tenant mismatch."
        : scope.reason === "user-inactive" || scope.reason === "enterprise-unavailable"
          ? "Enterprise membership is inactive."
          : "Enterprise membership not found.";
    throw new EnterpriseDataStoreError(code, message);
  }
  // Employee webchat may carry platformUserId without an email header. Re-enter the
  // authoritative resolver with the store email so membership is still pinned, never
  // first-match.
  if (scope.kind === "no-platform-identity" && params.platformUserId) {
    const fallbackUser = findUserById(params.store, params.platformUserId);
    const email = fallbackUser?.email?.trim().toLowerCase() || null;
    if (!email || email === params.email) {
      throw new EnterpriseDataStoreError("MEMBERSHIP_INVALID", "Enterprise membership not found.");
    }
    return resolveAuthoritativeSeatContextMembership({ ...params, email });
  }
  if (scope.kind === "no-enterprise-membership") {
    throw new EnterpriseDataStoreError(
      "TENANT_CONTEXT_MISSING",
      "Enterprise tenant context is missing.",
    );
  }
  throw new EnterpriseDataStoreError("MEMBERSHIP_INVALID", "Enterprise membership not found.");
}

export async function resolveTrustedEnterpriseDataExecutionContext(
  client: GatewayClient | null,
): Promise<TrustedEnterpriseDataExecutionContext> {
  const email = client?.user?.trim().toLowerCase() || null;
  const platformUserId = client?.platformUserId?.trim() || null;
  if (!email && !platformUserId) {
    throw new EnterpriseDataStoreError(
      "IDENTITY_CONTEXT_MISSING",
      "Authenticated session is required.",
    );
  }
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    throw new EnterpriseDataStoreError(
      "IDENTITY_CONTEXT_MISSING",
      "Trusted proxy auth must be enabled for enterprise data execution.",
    );
  }
  const platformStore = await loadPlatformAuthStore(authConfig);
  const { user, tenantId } = resolveAuthoritativeSeatContextMembership({
    store: platformStore,
    email,
    platformUserId,
    sessionMembershipId: client?.sessionMembershipId,
    sessionEnterpriseId: client?.sessionEnterpriseId,
  });
  const seatStore = await loadEnterpriseSeatAssetsStore(
    await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE),
  );
  const binding = findActiveBindingForEmployee({
    bindings: Object.values(seatStore.bindings),
    tenantId,
    employeeId: user.id,
  });
  if (!binding) {
    throw new EnterpriseDataStoreError("NO_CURRENT_SEAT", "Active seat binding not found.");
  }
  const seat = seatStore.seats[binding.seatId];
  if (!seat || seat.tenantId !== tenantId) {
    throw new EnterpriseDataStoreError("NO_CURRENT_SEAT", "Seat record not found.");
  }
  return buildExecutionContextFromSeat({
    tenantId,
    seat,
    employeeId: user.id,
    userId: user.id,
  });
}

export async function resolveTrustedScopePreviewContext(params: {
  client: GatewayClient | null;
  seatId: string;
}): Promise<ScopeEvaluationContext> {
  const scope = await resolveBillingScope(params.client);
  if (!scope.enterpriseId || !scope.isEnterpriseAdmin) {
    throw new EnterpriseDataStoreError(
      "SCOPE_PREVIEW_FORBIDDEN",
      "Scope preview requires enterprise-admin session.",
    );
  }
  const seatStore = await loadEnterpriseSeatAssetsStore(
    await resolveControlPlaneStorePathForClient(params.client, TENANT_SEAT_ASSETS_FILE),
  );
  const seat = seatStore.seats[params.seatId];
  if (!seat || seat.tenantId !== scope.enterpriseId) {
    throw new EnterpriseDataStoreError(
      "SCOPE_POLICY_NOT_FOUND",
      "Seat not found for scope preview.",
    );
  }
  const binding = findActiveBindingForSeat({
    bindings: Object.values(seatStore.bindings),
    tenantId: scope.enterpriseId,
    seatId: params.seatId,
  });
  if (!binding) {
    throw new EnterpriseDataStoreError(
      "NO_CURRENT_SEAT",
      "Seat has no active binding for preview.",
    );
  }
  return {
    tenantId: scope.enterpriseId,
    seatId: seat.seatId,
    employeeId: binding.employeeId,
    userId: binding.employeeId,
    teamLabel: seat.teamLabel,
    roleCode: seat.roleCode,
    departmentId: resolveExperimentalDepartmentId(seat),
  };
}

/**
 * Actor id for capability-access create and pack-skill install checks.
 * Session billing user only. Falls back to the local-operator id used by
 * governance create when the session has no platform user — never a client field.
 */
export async function resolveSessionCapabilityAccessActorId(
  client: GatewayClient | null,
): Promise<string> {
  const scope = await resolveBillingScope(client);
  if (typeof scope.user?.id === "string" && scope.user.id.trim()) {
    return scope.user.id.trim();
  }
  return "enterprise-admin";
}

export async function resolveTrustedAdminTenantId(
  client: GatewayClient | null,
  params?: Record<string, unknown>,
): Promise<string> {
  // Session-first: client tenantId is never an authority source.
  const sessionScope = await resolveBillingScope(client);
  if (sessionScope.enterpriseId) {
    return sessionScope.enterpriseId;
  }
  // Local-operator fallback only when trusted session cannot resolve an enterprise.
  const requestedTenantId =
    typeof params?.tenantId === "string"
      ? params.tenantId
      : typeof params?.enterpriseId === "string"
        ? params.enterpriseId
        : null;
  const fallbackScope = await resolveBillingScope(client, { requestedTenantId });
  if (!fallbackScope.enterpriseId) {
    throw new EnterpriseDataStoreError(
      "TENANT_CONTEXT_MISSING",
      "Enterprise tenant could not be resolved.",
    );
  }
  return fallbackScope.enterpriseId;
}

function paramString(value: unknown): string | null {
  return stringValue(value);
}

function respondScopeInvalid(respond: RespondFn, message: string): void {
  respond(false, undefined, { code: "INVALID_REQUEST", message });
}

export const GOVERNANCE_ADMIN_REQUIRED_MESSAGE =
  "Enterprise admin role is required for data governance operations.";

/**
 * Resolve tenantId from trusted session; reject client tenantId that does not match.
 */
export async function requireResolvedEnterpriseTenantId(params: {
  client: GatewayClient | null;
  params: Record<string, unknown>;
  respond: RespondFn;
}): Promise<string | null> {
  try {
    const tenantId = await resolveTrustedAdminTenantId(params.client, params.params);
    const requested = paramString(params.params.tenantId);
    if (requested && (canonicalizeTenantId(requested) ?? requested) !== tenantId) {
      respondScopeInvalid(params.respond, "tenantId must match authenticated enterprise scope.");
      return null;
    }
    return tenantId;
  } catch (error) {
    const message =
      error instanceof EnterpriseDataStoreError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Enterprise data tenant scope resolution failed.";
    respondScopeInvalid(params.respond, message);
    return null;
  }
}

/**
 * Governance-plane gate: trusted tenant scope + enterprise-admin role.
 */
export async function requireResolvedEnterpriseAdminTenantId(params: {
  client: GatewayClient | null;
  params: Record<string, unknown>;
  respond: RespondFn;
}): Promise<string | null> {
  const tenantId = await requireResolvedEnterpriseTenantId(params);
  if (!tenantId) {
    return null;
  }
  // Pass the requested tenant so the local single-operator fallback can grant
  // enterprise-admin-equivalent scope in loopback/no-auth mode — consistent with
  // resolveTrustedAdminTenantId and billing. Without this, the governance gate
  // rejects the local operator even though tenant resolution already accepted them.
  const requestedTenantId =
    typeof params.params.tenantId === "string"
      ? params.params.tenantId
      : typeof params.params.enterpriseId === "string"
        ? params.params.enterpriseId
        : null;
  const scope = await resolveBillingScope(params.client, { requestedTenantId });
  if (!scope.isEnterpriseAdmin) {
    respondScopeInvalid(params.respond, GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
    return null;
  }
  return tenantId;
}

export async function resolveTrustedSessionEmployeeId(
  client: GatewayClient | null,
): Promise<string> {
  const email = client?.user?.trim().toLowerCase() || null;
  if (!email) {
    throw new EnterpriseDataStoreError(
      "IDENTITY_CONTEXT_MISSING",
      "Authenticated session is required.",
    );
  }
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    throw new EnterpriseDataStoreError(
      "IDENTITY_CONTEXT_MISSING",
      "Trusted proxy auth must be enabled.",
    );
  }
  const platformStore = await loadPlatformAuthStore(authConfig);
  const user = findUserByEmail(platformStore, email);
  if (!user) {
    throw new EnterpriseDataStoreError("MEMBERSHIP_INVALID", "Authenticated user not found.");
  }
  return user.id;
}

/** Unit tests call the gateway directly; attestation marks server-equivalent context. */
export function createTrustedExecutionContextForTest(
  context: EnterpriseDataInvokeContext,
): TrustedEnterpriseDataExecutionContext {
  return {
    ...context,
    trustAttestation: TRUST_ATTESTATION,
  };
}
