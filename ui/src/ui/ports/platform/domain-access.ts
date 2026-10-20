/**
 * Platform subdomain visibility for 产品化 vs 大客户管理.
 *
 * Unrestricted platform admins (no domain scopes) keep both first-level entries.
 * An explicit `platform.productization.*` scope without `platform.key_account.*`
 * hides and rejects 大客户管理. The reverse hides and rejects 产品化.
 * Holding both keeps two sibling entries. Menu filtering and route refusal share
 * this function (IA §5, strategic lock 2026-10-10).
 */

import { html } from "lit";

export const PLATFORM_KEY_ACCOUNT_READ = "platform.key_account.read";
export const PLATFORM_KEY_ACCOUNT_WRITE = "platform.key_account.write";
export const PLATFORM_PRODUCTIZATION_READ = "platform.productization.read";
export const PLATFORM_PRODUCTIZATION_WRITE = "platform.productization.write";

const KEY_ACCOUNT_SCOPES = new Set([PLATFORM_KEY_ACCOUNT_READ, PLATFORM_KEY_ACCOUNT_WRITE]);
const PRODUCTIZATION_SCOPES = new Set([
  PLATFORM_PRODUCTIZATION_READ,
  PLATFORM_PRODUCTIZATION_WRITE,
]);

export type PlatformDomainAccess = {
  keyAccounts: boolean;
  productization: boolean;
  keyAccountWrite: boolean;
};

export function resolvePlatformDomainAccess(
  scopes?: readonly string[] | null,
): PlatformDomainAccess {
  const present = new Set(
    (scopes ?? []).map((scope) => scope.trim()).filter((scope) => scope.length > 0),
  );
  const keyAccount = [...present].some((scope) => KEY_ACCOUNT_SCOPES.has(scope));
  const productization = [...present].some((scope) => PRODUCTIZATION_SCOPES.has(scope));
  if (!keyAccount && !productization) {
    return { keyAccounts: true, productization: true, keyAccountWrite: true };
  }
  return {
    keyAccounts: keyAccount,
    productization,
    keyAccountWrite: present.has(PLATFORM_KEY_ACCOUNT_WRITE),
  };
}

export function renderPlatformDomainDenied(domain: "key-accounts" | "productization") {
  const title = domain === "key-accounts" ? "大客户管理" : "产品化";
  const detail =
    domain === "key-accounts"
      ? "路由已拒绝。只有产品化权限时不能进入大客户管理。"
      : "路由已拒绝。只有大客户管理权限时不能进入产品化。";
  return html`
    <section class="ka-denied" data-domain-denied=${domain} data-route-rejected="true">
      <h2>${title}</h2>
      <p>${detail}</p>
      <p>两个一级入口保持并列，不会合并成同一个菜单。</p>
    </section>
  `;
}
