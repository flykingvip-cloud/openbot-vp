/**
 * 计费租户作用域解析（R13 / R14）。
 *
 * 主路径（trusted-proxy / 平台鉴权）：由已连接客户端走
 * `resolveAuthoritativeEnterpriseScopeForClient`（钉住的 session membership
 * 对，否则唯一 membership）。不再用 `findMembershipByUserId` 的对象顺序首条，
 * 以免第一条 `member` 把同企业的 `enterprise-admin` 或已钉住的管理员会话降级。
 * 同时解析企业端权限（含 `usage:budget`）。该路径为权威来源，优先生效。
 *
 * 回退路径（本地单运营者 / `auth.mode=none`，无平台用户头，或账号没有任何企业
 * membership）：采用请求方携带的 `tenantId`。身份已识别但 membership 不唯一
 * （`deny`）或声称了无法识别的身份时失败关闭，不降级成本地运营者。
 * 此模式下网关绑定 loopback/受信代理，store 层仍以首参 `enterpriseId` 做纵深防御。
 *
 * 作为 handler 层的租户/权限闸；store 层另有「首参强制 enterpriseId」的纵深防御。
 */

import { loadConfig } from "../../config/config.js";
import { readTenantControls } from "../enterprise-security/tenant-controls-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import {
  type AuthoritativeEnterpriseScope,
  resolveAuthoritativeEnterpriseScopeForClient,
} from "../platform-auth/active-membership-scope.js";
import { listMembershipsByUserId } from "../platform-auth/memberships.js";
import type {
  PlatformAuthMembership,
  PlatformAuthStore,
  PlatformAuthUser,
} from "../platform-auth/store-types.js";
import type { GatewayClient } from "../server-methods/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";

/** 企业端预算 / 成本控制写权限标识（与 UI 权限项 `usage:budget` 对应）。 */
export const USAGE_BUDGET_PERMISSION = "usage:budget" as const;

export type BillingScope = {
  /** 已规范化的 enterpriseId；无法解析时为 null。 */
  enterpriseId: string | null;
  user: PlatformAuthUser | null;
  membership: PlatformAuthMembership | null;
  /** 是否企业管理员（enterprise-admin）。 */
  isEnterpriseAdmin: boolean;
  /** 解析出的企业端权限集合。 */
  permissions: Set<string>;
};

const EMPTY_SCOPE: BillingScope = {
  enterpriseId: null,
  user: null,
  membership: null,
  isEnterpriseAdmin: false,
  permissions: new Set(),
};

/** 选项：携带请求方声明的租户（来自页面 URL）。仅在主路径解析失败时作为回退。 */
export type ResolveBillingScopeOptions = {
  /** 请求方声明的企业租户 id（如来自 `/enterprise/{tenantId}/...` 路由）。 */
  requestedTenantId?: string | null;
};

/**
 * 本地单运营者回退作用域。
 *
 * 触发条件：网关无平台用户头（`auth.mode=none`、loopback），主路径解析不到
 * enterpriseId，但请求方携带了一个已知企业的 `tenantId`。此场景下运营者本人即为
 * 受信管理员，授予企业管理员等价权限以便预算/控制写入在本地可用。
 */
function localOperatorScope(enterpriseId: string): BillingScope {
  return {
    enterpriseId,
    user: null,
    membership: null,
    isEnterpriseAdmin: true,
    permissions: new Set([USAGE_BUDGET_PERMISSION]),
  };
}

/** 校验某 canonical 租户 id 是否为平台已知企业（回退路径的纵深防御）。 */
function enterpriseExists(
  store: { enterprises?: Record<string, unknown> },
  tenantId: string,
): boolean {
  const enterprises = store.enterprises ?? {};
  return Object.keys(enterprises).some((key) => (canonicalizeTenantId(key) ?? key) === tenantId);
}

/**
 * Same-enterprise admin must not be hidden by a member row.
 *
 * The authoritative resolver may represent an un-pinned same-enterprise
 * duplicate with the least-privileged membership so a tenant is never chosen
 * by object order. That representative is not an admin demotion: if any
 * membership of this user in the resolved enterprise is `enterprise-admin`,
 * billing writes stay admin. A pinned session membership is already the
 * authoritative row and wins on its own role.
 */
function sameEnterpriseHasAdmin(
  store: PlatformAuthStore,
  userId: string,
  enterpriseId: string,
): boolean {
  return listMembershipsByUserId(store, userId).some((entry) => {
    const entryEnterprise = canonicalizeTenantId(entry.enterpriseId) ?? entry.enterpriseId;
    return entryEnterprise === enterpriseId && entry.membershipRole === "enterprise-admin";
  });
}

function scopeFromAuthoritative(
  store: PlatformAuthStore,
  scope: Extract<AuthoritativeEnterpriseScope, { kind: "authoritative" }>,
  options?: { sessionPinned?: boolean },
): BillingScope {
  const ownRoleIsAdmin = scope.membership.membershipRole === "enterprise-admin";
  // Unpinned same-enterprise duplicates are represented by the least-privileged
  // row, so a sibling enterprise-admin membership still grants budget writes.
  // A pinned membership is that session's own role and must not inherit one.
  const isEnterpriseAdmin =
    ownRoleIsAdmin ||
    (options?.sessionPinned !== true &&
      sameEnterpriseHasAdmin(store, scope.user.id, scope.enterpriseId));
  const permissions = new Set<string>();
  if (isEnterpriseAdmin) {
    permissions.add(USAGE_BUDGET_PERMISSION);
  }
  return {
    enterpriseId: scope.enterpriseId,
    user: scope.user,
    membership: scope.membership,
    isEnterpriseAdmin,
    permissions,
  };
}

/**
 * 解析当前调用者的计费作用域。
 *
 * 主路径（权威）：钉住的 `sessionMembershipId + sessionEnterpriseId`，否则唯一
 * membership。请求方 `requestedTenantId` 不参与选企业（只在没有权威企业时回退）。
 * 身份已识别但无法绑定唯一企业（`deny`）时失败关闭，不降级成本地运营者。
 *
 * 回退路径：无平台身份，或已识别用户但没有任何企业 membership 时，若请求方携带了
 * 已知企业的 `requestedTenantId`，则按本地单运营者授予该租户作用域。
 *
 * 权限模型：enterprise-admin（含同企业另一条 admin membership）拥有 `usage:budget`；
 * 普通 member 不具备。
 */
export async function resolveBillingScope(
  client: GatewayClient | null,
  opts?: ResolveBillingScopeOptions,
): Promise<BillingScope> {
  const requestedTenantId = canonicalizeTenantId(opts?.requestedTenantId ?? null);
  try {
    const cfg = loadConfig();
    const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      // 平台鉴权未启用：无权威来源，直接采用请求方声明的租户（若有）。
      return requestedTenantId ? localOperatorScope(requestedTenantId) : EMPTY_SCOPE;
    }
    const platformStore = await loadPlatformAuthStore(authConfig);
    // Do not pass requestedTenantId: a URL tenant must not select or reject
    // the pinned enterprise. Callers compare it after this returns.
    const authoritative = resolveAuthoritativeEnterpriseScopeForClient({
      store: platformStore,
      client,
      canonicalize: canonicalizeTenantId,
    });
    const sessionPinned = Boolean(
      client?.sessionMembershipId?.trim() && client?.sessionEnterpriseId?.trim(),
    );
    if (authoritative.kind === "authoritative") {
      const billing = scopeFromAuthoritative(platformStore, authoritative, { sessionPinned });
      if (!billing.isEnterpriseAdmin && billing.user && billing.enterpriseId) {
        try {
          const controls = await readTenantControls(billing.enterpriseId);
          const grant = controls.memberGrants[billing.user.id];
          if (grant?.permissionIds.includes(USAGE_BUDGET_PERMISSION)) {
            billing.permissions.add(USAGE_BUDGET_PERMISSION);
          }
        } catch {
          // Unreadable grants fail closed: the member does not gain usage:budget.
        }
      }
      return billing;
    }
    // Recognized identity that cannot be bound to exactly one enterprise, or an
    // unrecognized claimed identity, must not become a local-operator admin.
    if (
      authoritative.kind === "deny" ||
      (authoritative.kind === "no-platform-identity" && authoritative.claimedIdentity)
    ) {
      return EMPTY_SCOPE;
    }
    // 回退路径：无平台用户头，或账号没有任何企业 membership。
    if (requestedTenantId && enterpriseExists(platformStore, requestedTenantId)) {
      return localOperatorScope(requestedTenantId);
    }
    return EMPTY_SCOPE;
  } catch {
    return EMPTY_SCOPE;
  }
}

/** 校验作用域是否对目标 enterpriseId 合法（租户隔离，R13.3）。 */
export function isScopeAuthorizedForTenant(
  scope: BillingScope,
  targetEnterpriseId: string,
): boolean {
  if (!scope.enterpriseId) {
    return false;
  }
  const target = canonicalizeTenantId(targetEnterpriseId) ?? targetEnterpriseId;
  return scope.enterpriseId === target;
}

/** 校验作用域是否持有某权限（R14.3）。 */
export function scopeHasPermission(scope: BillingScope, permission: string): boolean {
  return scope.permissions.has(permission);
}
