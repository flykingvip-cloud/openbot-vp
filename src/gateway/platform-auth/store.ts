import { randomBytes } from "node:crypto";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { canonicalizeTenantId, findCanonicalTenantIdBySlug } from "../tenant-canonicalization.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { DEFAULT_PLATFORM_AUTH_SCOPES } from "./config.js";
import { buildEnterpriseContact, isContactActionable } from "./enterprise-contact.js";
import { refreshEnterpriseStatuses } from "./enterprise-lifecycle.js";
import type {
  LegacyPlatformAuthStore,
  PlatformAuthActivationCode,
  PlatformAuthActivationStatus,
  PlatformAuthEnterprise,
  PlatformAuthEnterpriseContact,
  PlatformAuthStore,
  PlatformAuthTrialApplication,
} from "./store-types.js";
import {
  createDefaultPolicy,
  DEFAULT_TRIAL_SEATS,
  inferTrialApplicationStatus,
  normalizePolicy,
} from "./trial-policy.js";

const PLATFORM_AUTH_STORE_VERSION = 5;

const storeWriteLocks = new Map<string, Promise<void>>();

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function slugifyTenant(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

function createEmptyStore(nowIso = new Date().toISOString()): PlatformAuthStore {
  return {
    version: PLATFORM_AUTH_STORE_VERSION,
    secret: randomBytes(32).toString("base64url"),
    policy: createDefaultPolicy(nowIso),
    enterprises: {},
    users: {},
    sessions: {},
    memberships: {},
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
}

function migrateLegacyStore(legacy: LegacyPlatformAuthStore): PlatformAuthStore {
  const store = createEmptyStore();
  store.secret = legacy.secret.trim() || store.secret;
  const tenants = Object.values(legacy.tenants).toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  for (const tenant of tenants) {
    const memberCount = Object.values(legacy.memberships ?? {}).filter(
      (membership) => membership.tenantId === tenant.id,
    ).length;
    store.enterprises[tenant.id] = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug || slugifyTenant(tenant.name),
      status: "paid",
      plan: "legacy",
      createdSource: "self-service",
      billingStatus: "legacy",
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      seatQuota: Math.max(memberCount, DEFAULT_TRIAL_SEATS),
      seatUsed: memberCount,
      allowReadOnlyAfterExpiry: true,
    };
  }
  const sortedUsers = Object.values(legacy.users).toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const legacyMemberships = legacy.memberships ?? {};
  const firstUserId = sortedUsers[0]?.id;
  for (const user of sortedUsers) {
    const normalizedEmail = normalizeEmail(user.email);
    store.users[user.id] = {
      id: user.id,
      email: normalizedEmail,
      normalizedEmail,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      passwordUpdatedAt: user.updatedAt || user.createdAt,
      lastLoginAt: undefined,
      loginFailedCount: 0,
      status: "active",
      source: "legacy",
      platformAdmin: user.id === firstUserId,
      ...(user.id === firstUserId ? { platformRole: "super-admin" as const } : {}),
      role: user.role ?? "operator",
      scopes:
        Array.isArray(user.scopes) && user.scopes.length > 0
          ? [...new Set(user.scopes)]
          : [...DEFAULT_PLATFORM_AUTH_SCOPES],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
  for (const membership of Object.values(legacyMemberships)) {
    store.memberships[membership.id] = {
      id: membership.id,
      userId: membership.userId,
      enterpriseId: membership.tenantId,
      membershipRole: membership.membershipRole,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    };
  }
  for (const session of Object.values(legacy.sessions)) {
    store.sessions[session.id] = {
      id: session.id,
      userId: session.userId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      sessionIssuedAt: session.createdAt,
      expiresAt: session.expiresAt,
    };
  }
  store.trialApplications = {};
  store.leadNotifications = {};
  return store;
}

function normalizeActivationStatus(
  activation: PlatformAuthActivationCode,
  now = Date.now(),
): PlatformAuthActivationStatus {
  if (activation.status === "claimed" || activation.status === "revoked") {
    return activation.status;
  }
  const expiresAtMs = Number(new Date(activation.expiresAt));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
    return "expired";
  }
  return activation.status;
}

function pruneExpiredSessions(store: PlatformAuthStore, now = Date.now()): boolean {
  let changed = false;
  for (const [sessionId, session] of Object.entries(store.sessions)) {
    const expiresAtMs = Number(new Date(session.expiresAt));
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      delete store.sessions[sessionId];
      changed = true;
    }
  }
  return changed;
}

function pruneExpiredActivationCodes(store: PlatformAuthStore, now = Date.now()): boolean {
  let changed = false;
  for (const activation of Object.values(store.activationCodes)) {
    const nextStatus = normalizeActivationStatus(activation, now);
    if (nextStatus !== activation.status) {
      activation.status = nextStatus;
      activation.updatedAt = new Date(now).toISOString();
      changed = true;
    }
  }
  return changed;
}

/**
 * Derive a tenant contact for an enterprise that was created before contact
 * profiles existed. Order of preference (richest first): a converted trial
 * application -> the admin-activation provision -> the enterprise-admin
 * membership's user (covers legacy-migrated tenants). Returns undefined when
 * nothing is derivable yet.
 */
function deriveContactForEnterprise(
  store: PlatformAuthStore,
  enterprise: PlatformAuthEnterprise,
  nowIso: string,
): PlatformAuthEnterpriseContact | undefined {
  const application = Object.values(store.trialApplications).find(
    (entry) => entry.enterpriseId === enterprise.id,
  );
  if (application) {
    return buildEnterpriseContact({
      contactName: application.contactName,
      contactEmail: application.workEmail,
      companySize: application.companySize,
      industry: application.industry,
      source: "trial-application",
      nowIso,
    });
  }
  const provision = Object.values(store.adminProvisions)
    .filter((entry) => entry.enterpriseId === enterprise.id)
    .toSorted((left, right) => {
      const leftActivated = left.status === "activated";
      const rightActivated = right.status === "activated";
      if (leftActivated !== rightActivated) {
        return leftActivated ? -1 : 1;
      }
      return right.createdAt.localeCompare(left.createdAt);
    })[0];
  if (provision) {
    return buildEnterpriseContact({
      adminName: provision.adminName,
      adminEmail: provision.adminEmail,
      source: "admin-provision",
      nowIso,
    });
  }
  const membership =
    Object.values(store.memberships)
      .filter((m) => m.enterpriseId === enterprise.id && m.membershipRole === "enterprise-admin")
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ??
    Object.values(store.memberships)
      .filter((m) => m.enterpriseId === enterprise.id)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
  const adminUser = membership ? store.users[membership.userId] : undefined;
  if (adminUser) {
    return buildEnterpriseContact({
      adminName: adminUser.displayName,
      adminEmail: adminUser.email,
      source: "admin-provision",
      nowIso,
    });
  }
  return undefined;
}

/**
 * Backfill missing tenant contacts on existing enterprises so the platform
 * directory can always reach a tenant. Only writes when a contact is both
 * missing (not actionable) and derivable, so it never triggers spurious store
 * writes once every enterprise has a usable contact.
 */
function backfillEnterpriseContacts(store: PlatformAuthStore, now = Date.now()): boolean {
  let changed = false;
  const nowIso = new Date(now).toISOString();
  for (const enterprise of Object.values(store.enterprises)) {
    if (isContactActionable(enterprise.contact)) {
      continue;
    }
    const derived = deriveContactForEnterprise(store, enterprise, nowIso);
    if (derived && isContactActionable(derived)) {
      enterprise.contact = derived;
      changed = true;
    }
  }
  return changed;
}

function normalizeStore(raw: unknown): PlatformAuthStore {
  if (
    raw &&
    typeof raw === "object" &&
    "version" in raw &&
    ([2, 3, 4, PLATFORM_AUTH_STORE_VERSION] as const).includes(
      (raw as { version?: unknown }).version as 2 | 3 | 4 | typeof PLATFORM_AUTH_STORE_VERSION,
    ) &&
    typeof (raw as { secret?: unknown }).secret === "string"
  ) {
    const store = raw as Partial<PlatformAuthStore>;
    const enterprises = Object.fromEntries(
      Object.entries(store.enterprises ?? {}).map(([enterpriseId, enterprise]) => {
        const nextEnterpriseId =
          canonicalizeTenantId(enterpriseId) ??
          canonicalizeTenantId(enterprise?.id) ??
          findCanonicalTenantIdBySlug({ slug: enterprise?.slug }) ??
          enterpriseId;
        return [
          nextEnterpriseId,
          {
            ...enterprise,
            id: nextEnterpriseId,
          } as PlatformAuthEnterprise,
        ];
      }),
    );
    const memberships = Object.fromEntries(
      Object.entries(store.memberships ?? {}).map(([membershipId, membership]) => [
        membershipId,
        {
          ...membership,
          enterpriseId:
            canonicalizeTenantId(membership.enterpriseId) ??
            findCanonicalTenantIdBySlug({
              slug:
                typeof enterprises[membership.enterpriseId]?.slug === "string"
                  ? enterprises[membership.enterpriseId].slug
                  : undefined,
            }) ??
            membership.enterpriseId,
        },
      ]),
    );
    const adminProvisions = Object.fromEntries(
      Object.entries(store.adminProvisions ?? {}).map(([provisionId, provision]) => [
        provisionId,
        {
          ...provision,
          enterpriseId: canonicalizeTenantId(provision.enterpriseId) ?? provision.enterpriseId,
        },
      ]),
    );
    const employeeProvisions = Object.fromEntries(
      Object.entries(store.employeeProvisions ?? {}).map(([provisionId, provision]) => [
        provisionId,
        {
          ...provision,
          enterpriseId: canonicalizeTenantId(provision.enterpriseId) ?? provision.enterpriseId,
        },
      ]),
    );
    const activationCodes = Object.fromEntries(
      Object.entries(store.activationCodes ?? {}).map(([activationId, activation]) => [
        activationId,
        {
          ...activation,
          enterpriseId: activation.enterpriseId
            ? (canonicalizeTenantId(activation.enterpriseId) ?? activation.enterpriseId)
            : undefined,
        },
      ]),
    );
    const trialApplications = Object.fromEntries(
      Object.entries(store.trialApplications ?? {}).map(([applicationId, application]) => {
        const merged = {
          ...application,
          enterpriseId: application.enterpriseId
            ? (canonicalizeTenantId(application.enterpriseId) ?? application.enterpriseId)
            : undefined,
        } as PlatformAuthTrialApplication;
        merged.status = inferTrialApplicationStatus(merged);
        return [applicationId, merged];
      }),
    );
    const leadNotifications = Object.fromEntries(
      Object.entries(store.leadNotifications ?? {}).map(([notificationId, notification]) => [
        notificationId,
        {
          ...notification,
          enterpriseId: notification.enterpriseId
            ? (canonicalizeTenantId(notification.enterpriseId) ?? notification.enterpriseId)
            : undefined,
        },
      ]),
    );
    return {
      version: PLATFORM_AUTH_STORE_VERSION,
      secret: String(store.secret ?? "").trim(),
      policy: normalizePolicy(store.policy),
      ...(store.securityPolicy && typeof store.securityPolicy === "object"
        ? { securityPolicy: store.securityPolicy }
        : {}),
      enterprises,
      users: store.users ?? {},
      sessions: store.sessions ?? {},
      memberships,
      adminProvisions,
      employeeProvisions,
      activationCodes,
      trialApplications,
      leadNotifications,
    };
  }
  if (
    raw &&
    typeof raw === "object" &&
    typeof (raw as { secret?: unknown }).secret === "string" &&
    "tenants" in raw &&
    "users" in raw &&
    "sessions" in raw
  ) {
    return migrateLegacyStore(raw as LegacyPlatformAuthStore);
  }
  return createEmptyStore();
}

export async function loadStore(config: ResolvedPlatformAuthConfig): Promise<PlatformAuthStore> {
  const loaded = await readJsonFile<unknown>(config.storePath);
  const store = normalizeStore(loaded);
  const changed =
    pruneExpiredSessions(store) ||
    pruneExpiredActivationCodes(store) ||
    refreshEnterpriseStatuses(store);
  // Runs independently of the short-circuit above so contact backfill is never skipped.
  const contactsBackfilled = backfillEnterpriseContacts(store);
  if (changed || contactsBackfilled) {
    await writeJsonAtomic(config.storePath, store, { mode: 0o600, ensureDirMode: 0o700 });
  }
  return store;
}

export async function saveStore(
  config: ResolvedPlatformAuthConfig,
  store: PlatformAuthStore,
): Promise<void> {
  await writeJsonAtomic(config.storePath, store, { mode: 0o600, ensureDirMode: 0o700 });
}

async function withStoreWriteLock<T>(
  config: ResolvedPlatformAuthConfig,
  action: () => Promise<T>,
): Promise<T> {
  const key = config.storePath;
  const previous = storeWriteLocks.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  storeWriteLocks.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (storeWriteLocks.get(key) === queued) {
      storeWriteLocks.delete(key);
    }
  }
}

export async function loadPlatformAuthStore(
  config: ResolvedPlatformAuthConfig,
): Promise<PlatformAuthStore> {
  return loadStore(config);
}

export async function savePlatformAuthStore(
  config: ResolvedPlatformAuthConfig,
  store: PlatformAuthStore,
): Promise<void> {
  await saveStore(config, store);
}

export async function withPlatformAuthStoreWriteLock<T>(
  config: ResolvedPlatformAuthConfig,
  action: () => Promise<T>,
): Promise<T> {
  return withStoreWriteLock(config, action);
}
