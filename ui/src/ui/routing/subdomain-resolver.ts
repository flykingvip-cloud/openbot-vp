import type { FrontendPort } from "./cross-port-context.ts";

/**
 * OpenBot 域名 → 前端 Port 映射。
 *
 * 子域路由规则：
 *   - `www.openbot.love`    → employee（员工公共首页登录/注册）
 *   - `openbot.love`        → 同一员工公共首页（不锁定 port，登录/注册留在本域）
 *   - `gw.openbot.love`     → employee（旧域名，加载时跳转到 www）
 *   - `biz.openbot.love`    → enterprise（企业登录在 /enterprise/login）
 *   - `admin.openbot.love`  → platform（唯一要求验证器验证码的登录主机）
 *   - 其他域名（本地开发等）  → null（走 path-based 路由）
 */

/** 受支持的 OpenBot 根域（不含端口号）。 */
const OPENBOT_ROOT_DOMAINS = ["openbot.love"] as const;

/** 子域前缀 → FrontendPort 映射。 */
const SUBDOMAIN_PORT_MAP: Record<string, FrontendPort> = {
  www: "employee",
  gw: "employee",
  biz: "enterprise",
  admin: "platform",
};

/** 员工端规范子域（跨域跳转与 gateway URL 均以此为准）。 */
export const CANONICAL_EMPLOYEE_SUBDOMAIN = "www";

/** 旧员工端子域；访问时重定向到 {@link CANONICAL_EMPLOYEE_SUBDOMAIN}。 */
export const LEGACY_EMPLOYEE_SUBDOMAIN = "gw";

/** 被视为"公共首页"的子域前缀（不锁定 port，由 public-home.ts 处理）。 */
const PUBLIC_SUBDOMAINS = new Set([""]);

export type SubdomainResolution = {
  /** 解析出的 port；null 表示当前域不锁定特定 port（公共首页或非 OpenBot 域）。 */
  port: FrontendPort | null;
  /** 当前是否处于公共首页域（www 或裸域）。 */
  isPublicHome: boolean;
  /** 当前是否为已知的 OpenBot 子域（包括 www 和端口子域）。 */
  isOpenBotDomain: boolean;
};

/**
 * 从 host 字符串解析 OpenBot 子域并映射到对应 FrontendPort。
 *
 * @param host - 浏览器 location.host（含端口号）或纯 hostname
 * @returns 解析结果
 *
 * @example
 * resolvePortFromSubdomain("www.openbot.love")    // { port: "employee", isPublicHome: false, isOpenBotDomain: true }
 * resolvePortFromSubdomain("gw.openbot.love")     // { port: "employee", isPublicHome: false, isOpenBotDomain: true }
 * resolvePortFromSubdomain("openbot.love")        // { port: null, isPublicHome: true, isOpenBotDomain: true }
 * resolvePortFromSubdomain("localhost:18789")     // { port: null, isPublicHome: false, isOpenBotDomain: false }
 */
export function resolvePortFromSubdomain(host: string): SubdomainResolution {
  const hostname = stripPort(host).toLowerCase().trim();

  for (const root of OPENBOT_ROOT_DOMAINS) {
    if (hostname === root) {
      // 裸域：openbot.love
      return { port: null, isPublicHome: true, isOpenBotDomain: true };
    }
    if (hostname.endsWith(`.${root}`)) {
      const prefix = hostname.slice(0, -(root.length + 1));
      // 排除多级子域（如 a.b.openbot.love）
      if (prefix.includes(".")) {
        return { port: null, isPublicHome: false, isOpenBotDomain: false };
      }
      if (PUBLIC_SUBDOMAINS.has(prefix)) {
        return { port: null, isPublicHome: true, isOpenBotDomain: true };
      }
      const port = SUBDOMAIN_PORT_MAP[prefix] ?? null;
      return { port, isPublicHome: false, isOpenBotDomain: true };
    }
  }

  // 非 OpenBot 域（本地开发、自部署等）→ 不锁定 port
  return { port: null, isPublicHome: false, isOpenBotDomain: false };
}

/**
 * 便捷方法：从当前浏览器 window.location 解析 port。
 * SSR/测试环境下返回 null resolution。
 */
export function resolvePortFromCurrentLocation(): SubdomainResolution {
  if (typeof window === "undefined") {
    return { port: null, isPublicHome: false, isOpenBotDomain: false };
  }
  return resolvePortFromSubdomain(window.location.host);
}

/**
 * 判断当前域是否为 OpenBot 生产域（含所有子域和裸域）。
 */
export function isOpenBotProductionHost(host: string): boolean {
  return resolvePortFromSubdomain(host).isOpenBotDomain;
}

/**
 * 获取指定 port 对应的子域 URL origin。
 * 用于跨端口跳转时构造完整 URL。
 *
 * @param port - 目标前端 port
 * @param protocol - 协议，默认 https
 * @returns 完整 origin（如 "https://www.openbot.love"）
 */
export function originForPort(port: FrontendPort, protocol = "https"): string {
  const subdomain = subdomainForPort(port);
  const root = OPENBOT_ROOT_DOMAINS[0];
  if (!subdomain) {
    return `${protocol}://${root}`;
  }
  return `${protocol}://${subdomain}.${root}`;
}

/**
 * 从 host 提取 OpenBot 子域前缀；裸域返回 `""`，非 OpenBot 域返回 null。
 */
export function subdomainPrefixFromHost(host: string): string | null {
  const hostname = stripPort(host).toLowerCase().trim();
  for (const root of OPENBOT_ROOT_DOMAINS) {
    if (hostname === root) {
      return "";
    }
    if (hostname.endsWith(`.${root}`)) {
      const prefix = hostname.slice(0, -(root.length + 1));
      if (prefix.includes(".")) {
        return null;
      }
      return prefix;
    }
  }
  return null;
}

export function isLegacyEmployeeSubdomainHost(host: string): boolean {
  return subdomainPrefixFromHost(host) === LEGACY_EMPLOYEE_SUBDOMAIN;
}

/**
 * 获取指定 port 对应的子域前缀。
 * employee → "www", enterprise → "biz", platform → "admin", ops → "admin"
 */
export function subdomainForPort(port: FrontendPort): string | null {
  switch (port) {
    case "employee":
      return CANONICAL_EMPLOYEE_SUBDOMAIN;
    case "enterprise":
      return "biz";
    case "platform":
    case "ops":
      return "admin";
    default:
      return null;
  }
}

/** 去除 host 中的端口号部分。 */
function stripPort(host: string): string {
  const bracketEnd = host.indexOf("]");
  const colonIndex = host.indexOf(":", bracketEnd + 1);
  return colonIndex === -1 ? host : host.slice(0, colonIndex);
}
