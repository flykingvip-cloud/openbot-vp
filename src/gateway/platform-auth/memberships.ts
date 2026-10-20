import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import type {
  ControlUiPlatformAuthState,
  ControlUiPlatformMember,
} from "../control-ui-contract.js";
import { listTenantOrganizationChildOrders } from "../enterprise-org-child-order.js";
import { listTenantOrganizationDepartmentPaths } from "../enterprise-org-departments.js";
import {
  buildSeatConnectorProfileSnapshots,
  buildEmployeeAccessSnapshot,
  buildSeatMemoryScopeSnapshots,
  listTenantHandovers,
  listTenantSeatAssignmentOffers,
  listTenantSeats,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { listOwnershipRecords } from "../ownership-store.js";
import { normalizeDisplayName } from "./request-helpers.js";
import type {
  PlatformAuthActivationCode,
  PlatformAuthActivationType,
  PlatformAuthMembership,
  PlatformAuthStore,
  PlatformAuthUser,
} from "./store-types.js";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "126.com",
  "163.com",
  "aol.com",
  "foxmail.com",
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "outlook.com",
  "qq.com",
  "sina.com",
  "sohu.com",
  "yahoo.com",
]);

const LARGE_ACCOUNT_KEYWORDS = [
  "bank",
  "government",
  "group",
  "holding",
  "insurance",
  "ministry",
  "telecom",
  "university",
  "证券",
  "保险",
  "医院",
  "大学",
  "政府",
  "控股",
  "航空",
  "集团",
  "银行",
] as const;

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isEnterpriseEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) {
    return false;
  }
  return !PERSONAL_EMAIL_DOMAINS.has(domain);
}

export function isLikelyLargeEnterpriseName(name: string): boolean {
  const lower = name.toLowerCase();
  return LARGE_ACCOUNT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function findUserByEmail(
  store: PlatformAuthStore,
  email: string,
): PlatformAuthUser | undefined {
  return Object.values(store.users).find((entry) => entry.normalizedEmail === email);
}

export function findUserById(
  store: PlatformAuthStore,
  userId: string,
): PlatformAuthUser | undefined {
  const id = userId.trim();
  return id ? store.users[id] : undefined;
}

export function listMembershipsByUserId(
  store: PlatformAuthStore,
  userId: string,
): PlatformAuthMembership[] {
  return Object.values(store.memberships).filter((entry) => entry.userId === userId);
}

/**
 * Legacy convenience helper. Request authorization must use an exact session
 * binding or `findUniqueMembershipByUserId`; object iteration order is not an
 * active-membership selection policy.
 */
export function findMembershipByUserId(
  store: PlatformAuthStore,
  userId: string,
): PlatformAuthMembership | undefined {
  return listMembershipsByUserId(store, userId)[0];
}

export function findMembershipByIdForUser(
  store: PlatformAuthStore,
  membershipId: string,
  userId: string,
): PlatformAuthMembership | undefined {
  const membership = store.memberships[membershipId];
  return membership?.userId === userId ? membership : undefined;
}

/** Legacy sessions may be upgraded only when the user's membership is unambiguous. */
export function findUniqueMembershipByUserId(
  store: PlatformAuthStore,
  userId: string,
): PlatformAuthMembership | undefined {
  const memberships = listMembershipsByUserId(store, userId);
  return memberships.length === 1 ? memberships[0] : undefined;
}

function normalizeMembershipSelection(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** Login / switch intent used to filter auto-selected enterprise memberships. */
export type MembershipSelectionIntent = "enterprise-admin" | "employee" | "default";

function isEligibleEnterpriseForMembership(
  store: PlatformAuthStore,
  enterpriseId: string,
): boolean {
  const enterprise = store.enterprises[enterpriseId];
  return Boolean(
    enterprise && enterprise.status !== "suspended" && enterprise.status !== "expired",
  );
}

function compareMembershipNewestFirst(
  left: PlatformAuthMembership,
  right: PlatformAuthMembership,
): number {
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  if (updated !== 0) {
    return updated;
  }
  const created = right.createdAt.localeCompare(left.createdAt);
  if (created !== 0) {
    return created;
  }
  return left.id.localeCompare(right.id);
}

/**
 * Memberships the user may auto-bind into: enterprise must be active, and the
 * login channel pins the role (admin entry → enterprise-admin only; employee
 * entry → member only). Same email with both identities follows the channel.
 */
export function listEligibleMembershipsForUser(params: {
  store: PlatformAuthStore;
  userId: string;
  intent?: MembershipSelectionIntent;
  requiredRole?: PlatformAuthMembership["membershipRole"];
}): PlatformAuthMembership[] {
  const intent = params.intent ?? "default";
  return listMembershipsByUserId(params.store, params.userId).filter((membership) => {
    if (!isEligibleEnterpriseForMembership(params.store, membership.enterpriseId)) {
      return false;
    }
    if (params.requiredRole && membership.membershipRole !== params.requiredRole) {
      return false;
    }
    if (intent === "enterprise-admin" && membership.membershipRole !== "enterprise-admin") {
      return false;
    }
    if (intent === "employee" && membership.membershipRole !== "member") {
      return false;
    }
    return true;
  });
}

function findRecentSessionMembershipId(params: {
  store: PlatformAuthStore;
  userId: string;
  candidateIds: Set<string>;
}): string | undefined {
  const sessions = Object.values(params.store.sessions)
    .filter(
      (session) =>
        session.userId === params.userId &&
        typeof session.membershipId === "string" &&
        params.candidateIds.has(session.membershipId),
    )
    .toSorted((left, right) => {
      const updated = right.updatedAt.localeCompare(left.updatedAt);
      if (updated !== 0) {
        return updated;
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  return sessions[0]?.membershipId;
}

/**
 * Deterministic auto-bind for login: explicit id wins; otherwise filter by
 * intent/role/tenant, prefer the user's most recent matching session, else the
 * newest membership by updatedAt.
 */
export function resolvePreferredMembershipForUser(params: {
  store: PlatformAuthStore;
  userId: string;
  membershipId?: string;
  enterpriseId?: string;
  intent?: MembershipSelectionIntent;
  requiredRole?: PlatformAuthMembership["membershipRole"];
}): PlatformAuthMembership | undefined {
  const membershipId = normalizeMembershipSelection(params.membershipId);
  const enterpriseId = normalizeMembershipSelection(params.enterpriseId);
  if (membershipId) {
    const membership = findMembershipByIdForUser(params.store, membershipId, params.userId);
    return membership && (!enterpriseId || membership.enterpriseId === enterpriseId)
      ? membership
      : undefined;
  }

  let candidates = listEligibleMembershipsForUser({
    store: params.store,
    userId: params.userId,
    intent: params.intent,
    requiredRole: params.requiredRole,
  });
  if (enterpriseId) {
    candidates = candidates.filter((membership) => membership.enterpriseId === enterpriseId);
  }
  if (candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const candidateIds = new Set(candidates.map((membership) => membership.id));
  const recentMembershipId = findRecentSessionMembershipId({
    store: params.store,
    userId: params.userId,
    candidateIds,
  });
  if (recentMembershipId) {
    return candidates.find((membership) => membership.id === recentMembershipId);
  }
  return [...candidates].toSorted(compareMembershipNewestFirst)[0];
}

/**
 * Resolves an explicit login or switch choice without allowing a route tenant to
 * become an authorization source. When no explicit membership is provided,
 * auto-binds a preferred eligible membership (last session, then newest).
 */
export function resolveMembershipSelectionForUser(params: {
  store: PlatformAuthStore;
  userId: string;
  membershipId?: string;
  enterpriseId?: string;
  intent?: MembershipSelectionIntent;
  requiredRole?: PlatformAuthMembership["membershipRole"];
}): PlatformAuthMembership | undefined {
  return resolvePreferredMembershipForUser(params);
}

/**
 * Resolves a persisted session binding. A partial pair is invalid and cannot
 * fall through to a different membership; binding-free legacy records get only
 * the same unique-membership compatibility path as new selections.
 */
export function resolveSessionMembershipBinding(params: {
  store: PlatformAuthStore;
  userId: string;
  membershipId?: string;
  enterpriseId?: string;
}): PlatformAuthMembership | undefined {
  const membershipId = normalizeMembershipSelection(params.membershipId);
  const enterpriseId = normalizeMembershipSelection(params.enterpriseId);
  if (Boolean(membershipId) !== Boolean(enterpriseId)) {
    return undefined;
  }
  if (!membershipId || !enterpriseId) {
    return findUniqueMembershipByUserId(params.store, params.userId);
  }
  const membership = findMembershipByIdForUser(params.store, membershipId, params.userId);
  return membership?.enterpriseId === enterpriseId ? membership : undefined;
}

function findLatestActiveCode(params: {
  store: PlatformAuthStore;
  provisionId?: string;
  userId?: string;
  email: string;
  codeType: PlatformAuthActivationType;
}): PlatformAuthActivationCode | undefined {
  return Object.values(params.store.activationCodes)
    .filter(
      (activation) =>
        activation.codeType === params.codeType &&
        activation.normalizedEmail === normalizeEmail(params.email) &&
        activation.status === "active" &&
        (!params.provisionId || activation.provisionId === params.provisionId) &&
        (!params.userId || activation.userId === params.userId),
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export type MemberSeatAssignment = {
  seatTitle: string;
  seatStatus: NonNullable<ControlUiPlatformMember["seatStatus"]>;
  teamLabel?: string;
};

function normalizeMemberSeatEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function buildMemberSeatAssignmentIndex(params: {
  store: PlatformAuthStore;
  seatStore: EnterpriseSeatAssetsStore;
  enterpriseId: string;
}): Map<string, MemberSeatAssignment> {
  const index = new Map<string, MemberSeatAssignment>();
  const assign = (email: string, assignment: MemberSeatAssignment) => {
    const key = normalizeMemberSeatEmail(email);
    if (!key) {
      return;
    }
    index.set(key, assignment);
  };

  for (const offer of listTenantSeatAssignmentOffers(params.seatStore, params.enterpriseId)) {
    if (offer.status !== "pending") {
      continue;
    }
    const user = params.store.users[offer.targetEmployeeId];
    const seat = params.seatStore.seats[offer.seatId];
    if (!user?.email || !seat) {
      continue;
    }
    assign(user.email, {
      seatTitle: seat.title,
      seatStatus: seat.status,
      ...(seat.teamLabel ? { teamLabel: seat.teamLabel } : {}),
    });
  }

  for (const provision of Object.values(params.store.employeeProvisions)) {
    if (
      provision.enterpriseId !== params.enterpriseId ||
      provision.status !== "pending_activation"
    ) {
      continue;
    }
    const seat = params.seatStore.seats[provision.seatId];
    if (!seat) {
      continue;
    }
    assign(provision.employeeEmail, {
      seatTitle: seat.title,
      seatStatus: seat.status,
      ...(seat.teamLabel ? { teamLabel: seat.teamLabel } : {}),
    });
  }

  for (const seat of listTenantSeats(params.seatStore, params.enterpriseId)) {
    if (!seat.currentEmployeeId) {
      continue;
    }
    const user = params.store.users[seat.currentEmployeeId];
    if (!user?.email) {
      continue;
    }
    assign(user.email, {
      seatTitle: seat.title,
      seatStatus: seat.status,
      ...(seat.teamLabel ? { teamLabel: seat.teamLabel } : {}),
    });
  }

  return index;
}

export function buildPlatformOrganizationSnapshot(params: {
  store: PlatformAuthStore;
  seatStore: EnterpriseSeatAssetsStore;
  enterpriseId: string;
}): NonNullable<ControlUiPlatformAuthState["organization"]> | undefined {
  const seats = listTenantSeats(params.seatStore, params.enterpriseId).map((seat) => {
    const activeBinding =
      Object.values(params.seatStore.bindings)
        .filter((binding) => binding.seatId === seat.seatId)
        .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null;
    const currentEmployee = seat.currentEmployeeId
      ? params.store.users[seat.currentEmployeeId]
      : null;
    const pendingProvision =
      Object.values(params.store.employeeProvisions)
        .filter(
          (provision) =>
            provision.enterpriseId === params.enterpriseId &&
            provision.seatId === seat.seatId &&
            provision.status === "pending_activation",
        )
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
    const pendingActivation = pendingProvision
      ? findLatestActiveCode({
          store: params.store,
          provisionId: pendingProvision.id,
          email: pendingProvision.employeeEmail,
          codeType: "employeeActivation",
        })
      : null;
    return {
      seatId: seat.seatId,
      title: seat.title,
      ...(seat.teamLabel ? { teamLabel: seat.teamLabel } : {}),
      ...(seat.responsibility ? { responsibility: seat.responsibility } : {}),
      ...(seat.roleCode ? { roleCode: seat.roleCode } : {}),
      status: seat.status,
      ...(currentEmployee ? { currentEmployeeUser: currentEmployee.email } : {}),
      ...(currentEmployee
        ? {
            currentEmployeeDisplayName: normalizeDisplayName(
              currentEmployee.displayName,
              currentEmployee.email,
            ),
          }
        : {}),
      ...(pendingProvision ? { pendingEmployeeUser: pendingProvision.employeeEmail } : {}),
      ...(pendingProvision
        ? {
            pendingEmployeeDisplayName: normalizeDisplayName(
              pendingProvision.employeeName,
              pendingProvision.employeeEmail,
            ),
          }
        : {}),
      ...(pendingProvision?.assignmentId
        ? { pendingAssignmentId: pendingProvision.assignmentId }
        : {}),
      ...(pendingActivation ? { pendingActivationExpiresAt: pendingActivation.expiresAt } : {}),
      ...(seat.defaultAgentAssetIds[0] ? { defaultAgentId: seat.defaultAgentAssetIds[0] } : {}),
      ...(() => {
        // Mesh / org surfaces need binding-only robots too — defaultAgentAssetIds alone
        // under-reports tenant roster (same union as monthly-seat-usage + ownership backfill).
        const agentIds = new Set<string>();
        for (const agentId of seat.defaultAgentAssetIds ?? []) {
          const trimmed = agentId.trim();
          if (trimmed) {
            agentIds.add(trimmed);
          }
        }
        for (const binding of Object.values(params.seatStore.assetBindings ?? {})) {
          if (
            binding.tenantId === params.enterpriseId &&
            binding.seatId === seat.seatId &&
            binding.status === "active" &&
            binding.assetType === "agent"
          ) {
            const assetId = binding.assetId?.trim();
            if (assetId) {
              agentIds.add(assetId);
            }
          }
        }
        return agentIds.size > 0 ? { agentIds: [...agentIds] } : {};
      })(),
      ...(seat.defaultSpaceIds.length > 0 ? { defaultSpaceIds: [...seat.defaultSpaceIds] } : {}),
      ...(() => {
        const memoryScopes = buildSeatMemoryScopeSnapshots({
          store: params.seatStore,
          tenantId: params.enterpriseId,
          seatId: seat.seatId,
          includePrivate: true,
        });
        return memoryScopes.length > 0
          ? {
              memoryScopeIds: memoryScopes.map((scope) => scope.scopeId),
              memoryScopes,
            }
          : {};
      })(),
      ...(() => {
        const connectorProfiles = buildSeatConnectorProfileSnapshots({
          store: params.seatStore,
          tenantId: params.enterpriseId,
          seatId: seat.seatId,
        });
        return connectorProfiles.length > 0
          ? {
              connectorIds: connectorProfiles.map((profile) => profile.profileId),
              connectorProfiles,
            }
          : {};
      })(),
      ...(activeBinding ? { activeBindingStatus: activeBinding.bindingStatus } : {}),
    };
  });
  const handovers = listTenantHandovers(params.seatStore, params.enterpriseId).map((handover) => {
    const seat = params.seatStore.seats[handover.seatId];
    const outgoingUser = params.store.users[handover.outgoingEmployeeId];
    const incomingUser = handover.incomingEmployeeId
      ? params.store.users[handover.incomingEmployeeId]
      : null;
    return {
      handoverCaseId: handover.handoverCaseId,
      seatId: handover.seatId,
      seatTitle: seat?.title ?? handover.seatId,
      status: handover.status,
      ...(outgoingUser ? { outgoingEmployeeUser: outgoingUser.email } : {}),
      ...(incomingUser ? { incomingEmployeeUser: incomingUser.email } : {}),
      createdAt: handover.createdAt,
      ...(handover.completedAt ? { completedAt: handover.completedAt } : {}),
    };
  });
  const offers = listTenantSeatAssignmentOffers(params.seatStore, params.enterpriseId).flatMap(
    (offer) => {
      const targetUser = params.store.users[offer.targetEmployeeId];
      if (!targetUser) {
        return [];
      }
      return [
        {
          ...(offer.assignmentId ? { assignmentId: offer.assignmentId } : {}),
          ...(offer.assignmentType ? { assignmentType: offer.assignmentType } : {}),
          offerId: offer.offerId,
          seatId: offer.seatId,
          seatTitle: offer.packageSnapshot.seatTitle,
          targetEmployeeUser: targetUser.email,
          status: offer.status,
          ...(offer.packageSnapshot.defaultAgentId
            ? { defaultAgentId: offer.packageSnapshot.defaultAgentId }
            : {}),
          ...(offer.packageSnapshot.agentIds?.length
            ? { agentIds: [...offer.packageSnapshot.agentIds] }
            : {}),
          ...(offer.packageSnapshot.defaultSpaceIds.length > 0
            ? { defaultSpaceIds: [...offer.packageSnapshot.defaultSpaceIds] }
            : {}),
          ...(offer.packageSnapshot.memoryScopeIds?.length
            ? { memoryScopeIds: [...offer.packageSnapshot.memoryScopeIds] }
            : {}),
          ...(offer.packageSnapshot.memoryScopes?.length
            ? { memoryScopes: [...offer.packageSnapshot.memoryScopes] }
            : {}),
          ...(offer.packageSnapshot.connectorIds?.length
            ? { connectorIds: [...offer.packageSnapshot.connectorIds] }
            : {}),
          ...(offer.packageSnapshot.connectorProfileIds?.length
            ? { connectorProfileIds: [...offer.packageSnapshot.connectorProfileIds] }
            : {}),
          ...(offer.packageSnapshot.connectorProfiles?.length
            ? { connectorProfiles: [...offer.packageSnapshot.connectorProfiles] }
            : {}),
          ...(offer.packageSnapshot.connectorCredentialReauthorizationRequired !== undefined
            ? {
                connectorCredentialReauthorizationRequired:
                  offer.packageSnapshot.connectorCredentialReauthorizationRequired,
              }
            : {}),
          ...(offer.packageSnapshot.reauthorizationRequired !== undefined
            ? { reauthorizationRequired: offer.packageSnapshot.reauthorizationRequired }
            : {}),
          offeredAt: offer.offeredAt,
          ...(offer.expiresAt ? { expiresAt: offer.expiresAt } : {}),
          ...(offer.handoverCaseId ? { handoverCaseId: offer.handoverCaseId } : {}),
        },
      ];
    },
  );
  if (seats.length === 0 && handovers.length === 0 && offers.length === 0) {
    return undefined;
  }
  return {
    seatCount: seats.length,
    occupiedSeatCount: seats.filter((seat) => seat.status === "occupied").length,
    assignedSeatCount: seats.filter((seat) => seat.status === "assigned").length,
    vacantSeatCount: seats.filter((seat) => seat.status === "vacant").length,
    handoverSeatCount: seats.filter((seat) => seat.status === "handover_pending").length,
    frozenSeatCount: seats.filter((seat) => seat.status === "frozen").length,
    pendingOfferCount: offers.filter((offer) => offer.status === "pending").length,
    departmentPaths: listTenantOrganizationDepartmentPaths(params.seatStore, params.enterpriseId),
    childOrders: listTenantOrganizationChildOrders(params.seatStore, params.enterpriseId),
    seats,
    handovers,
    offers,
  };
}

function normalizeOwnershipIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function resolveOwnedAgentIdsForEmployee(params: {
  tenantId: string;
  employeeId: string;
  employeeEmail?: string;
}): string[] {
  const identities = new Set(
    [params.employeeId, params.employeeEmail]
      .map((entry) => normalizeOwnershipIdentity(entry))
      .filter(Boolean),
  );
  const agentIds = new Set<string>();
  for (const record of listOwnershipRecords()) {
    if (record.tenantId !== params.tenantId || record.bindingStatus === "revoked") {
      continue;
    }
    if (!identities.has(normalizeOwnershipIdentity(record.currentManagerUserId))) {
      continue;
    }
    if (record.subjectKind !== "agent") {
      continue;
    }
    const subjectId = record.subjectId.trim();
    if (subjectId) {
      agentIds.add(subjectId);
    }
  }
  return [...agentIds];
}

export function buildPlatformEmployeeAccess(params: {
  seatStore: EnterpriseSeatAssetsStore;
  enterpriseId: string;
  employeeId: string;
  employeeEmail?: string;
}): NonNullable<ControlUiPlatformAuthState["employeeAccess"]> | undefined {
  const snapshot = buildEmployeeAccessSnapshot({
    store: params.seatStore,
    tenantId: params.enterpriseId,
    employeeId: params.employeeId,
  });
  // Grantable "owned" for personal identity = ownership records ∪ seat-granted
  // agents (defaults + active agent bindings). Seat-shared bots under the
  // occupied seat must appear in the authorization picker as the master's robots.
  //
  // Ownership must be resolved even when the seat snapshot is empty: enterprise
  // admins often occupy a CEO org seat while platform-auth has no active binding,
  // and AI 助手 previously collapsed to steward-only because employeeAccess was
  // omitted (or agentIds stayed at ["main"]) despite ownership records.
  const ownershipOwnedAgentIds = resolveOwnedAgentIdsForEmployee({
    tenantId: params.enterpriseId,
    employeeId: params.employeeId,
    employeeEmail: params.employeeEmail,
  });
  if (!snapshot.currentSeat && !snapshot.notice && ownershipOwnedAgentIds.length === 0) {
    return undefined;
  }
  const seatGrantedOwnedAgentIds = snapshot.agentIds.filter(
    (agentId) => !isBuiltinStewardAgent(agentId),
  );
  const ownedAgentIds = [...new Set([...ownershipOwnedAgentIds, ...seatGrantedOwnedAgentIds])];
  // Keep agentIds and ownedAgentIds aligned so older clients that only read
  // agentIds still restore personal bots into the AI 助手 rail.
  const agentIds = [...new Set([...snapshot.agentIds, ...ownedAgentIds])];
  return {
    currentSeat: snapshot.currentSeat,
    defaultAgentId: snapshot.defaultAgentId,
    agentIds,
    ownedAgentIds,
    employeeUserId: params.employeeId,
    defaultSpaceIds: snapshot.defaultSpaceIds,
    memoryScopeIds: snapshot.memoryScopeIds,
    connectorIds: snapshot.connectorIds,
    ...(snapshot.pendingOffer ? { pendingOffer: snapshot.pendingOffer } : {}),
    notice: snapshot.notice,
  };
}
