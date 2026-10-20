/**
 * Cost & Budget Billing — handler 公共辅助。
 *
 * 提供参数取值、错误响应、租户/权限闸的小工具，供 billing 各 handler 组复用。
 */

import {
  isScopeAuthorizedForTenant,
  resolveBillingScope,
  scopeHasPermission,
  type BillingScope,
} from "../billing/scope.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { respondInvalid, stringValue } from "./request-params.js";
import type { GatewayClient, RespondFn } from "./types.js";

export {
  exactMember,
  isRecord,
  nonemptyStrings,
  numberValue,
  oneOf,
  optionalString,
  requiredString,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./request-params.js";

/**
 * 解析企业作用域并校验 enterpriseId 可用。
 * 返回 scope（含已规范化 enterpriseId）或在无法解析时回 null（调用方应已 respond）。
 *
 * `params` 可选：当主路径（平台用户头）解析不到租户时，从 `params.tenantId` /
 * `params.enterpriseId` 回退（本地单运营者模式，见 `resolveBillingScope`）。
 * 若请求方显式携带 tenantId/enterpriseId，必须与解析出的作用域一致（D1 负向门禁）。
 */
export async function requireEnterpriseScope(
  client: GatewayClient | null,
  respond: RespondFn,
  params?: Record<string, unknown>,
): Promise<(BillingScope & { enterpriseId: string }) | null> {
  const requestedTenantId = params
    ? (stringValue(params.tenantId) ?? stringValue(params.enterpriseId))
    : null;
  const scope = await resolveBillingScope(client, { requestedTenantId });
  if (!scope.enterpriseId) {
    respondInvalid(respond, "无法解析当前企业租户，请确认已登录企业账号。");
    return null;
  }
  if (requestedTenantId) {
    const requested = canonicalizeTenantId(requestedTenantId) ?? requestedTenantId;
    if (!isScopeAuthorizedForTenant(scope, requested)) {
      respondInvalid(respond, "tenantId must match authenticated enterprise scope.");
      return null;
    }
  }
  return scope as BillingScope & { enterpriseId: string };
}

/** 校验作用域对目标租户合法，否则 respond 拒绝并返回 false（R13.3）。 */
export function ensureTenantAuthorized(
  scope: BillingScope,
  targetEnterpriseId: string,
  respond: RespondFn,
): boolean {
  if (!isScopeAuthorizedForTenant(scope, targetEnterpriseId)) {
    respondInvalid(respond, "无权访问该企业的计费数据。");
    return false;
  }
  return true;
}

/** 校验作用域持有某权限，否则 respond 拒绝并返回 false（R14.3）。 */
export function ensurePermission(
  scope: BillingScope,
  permission: string,
  respond: RespondFn,
): boolean {
  if (!scopeHasPermission(scope, permission)) {
    respondInvalid(respond, `缺少所需权限：${permission}`);
    return false;
  }
  return true;
}
