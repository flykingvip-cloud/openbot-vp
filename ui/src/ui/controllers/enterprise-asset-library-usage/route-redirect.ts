/**
 * Route Redirect — 旧「企业代理」/「能力应用管理」路径的重定向解析器。
 *
 * 两个旧模块均已整合进「企业能力中心」(`/enterprise/{tenantId}/capabilities`)。
 * 本解析器把旧路径重写到能力中心对应路由段，供历史书签/外链平滑落地。
 *
 * 不变量（Property 7 — 路由重定向幂等）：
 * - `resolveUrl(resolveUrl(x)) === resolveUrl(x)` 对任意输入成立
 * - 解析器不产生重定向链（最多一跳）
 */

import { LEGACY_AGENTS_REDIRECTS } from "../../navigation.ts";

/**
 * 将旧「企业代理」/「能力应用管理」路径重定向到「企业能力中心」对应路径。
 *
 * 遍历 {@link LEGACY_AGENTS_REDIRECTS}，首个命中即返回目标路径；
 * 无命中则原样返回（幂等：已解析的能力中心路径不会再次命中）。
 */
export function resolveLegacyAgentsUrl(url: string): string {
  for (const redirect of LEGACY_AGENTS_REDIRECTS) {
    const match = url.match(redirect.pattern);
    if (match) {
      return redirect.target(match);
    }
  }
  return url;
}

/**
 * 旧「能力安装管理」路径重定向（委托给 {@link resolveLegacyAgentsUrl}）。
 */
export function resolveLegacyInstallManagementUrl(url: string): string {
  return resolveLegacyAgentsUrl(url);
}

/**
 * 组合解析器：处理旧路径重定向到能力中心。
 *
 * 幂等性保证：旧 `/agents/*`、`/usage-management/*` 经一次调用后变为 `/capabilities/*`，
 * 第二次调用不再命中任何重定向规则。
 */
export function resolveUrl(url: string): string {
  return resolveLegacyAgentsUrl(url);
}
