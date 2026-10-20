/**
 * User-facing copy for PLATFORM_AUTH_SURFACE_MISMATCH.
 *
 * The gateway still rejects the login. These strings only name the public
 * portal that can accept the login the user already attempted.
 * Employee → https://www.openbot.love/
 * Enterprise → https://biz.openbot.love/enterprise/login
 * Platform → https://admin.openbot.love/platform/login
 */

export type LoginSurfaceName = "employee" | "enterprise" | "platform";

export const CANONICAL_LOGIN_URL: Record<LoginSurfaceName, string> = {
  employee: "https://www.openbot.love/",
  enterprise: "https://biz.openbot.love/enterprise/login",
  platform: "https://admin.openbot.love/platform/login",
};

export type SurfaceMismatchCopy = {
  withCurrent: string;
  withoutCurrent: string;
  unknown: string;
  current: Record<LoginSurfaceName, string>;
  attempt: Record<LoginSurfaceName, string>;
  next: Record<LoginSurfaceName, string>;
};

export const SURFACE_MISMATCH_COPY: Record<"zh-CN" | "en", SurfaceMismatchCopy> = {
  "zh-CN": {
    withCurrent: "你正在{currentPortal}，不能在这里完成{attempt}。请改用{nextPortal}：{url}",
    withoutCurrent: "当前页面不能完成{attempt}。请改用{nextPortal}：{url}",
    unknown:
      "当前页面和这次登录不是同一个入口。员工请使用 {employeeUrl}，企业管理员请使用 {enterpriseUrl}，平台管理员请使用 {platformUrl}。",
    current: {
      employee: "员工登录入口",
      enterprise: "企业登录入口",
      platform: "平台登录入口",
    },
    attempt: {
      employee: "员工登录",
      enterprise: "企业管理员登录",
      platform: "平台管理员登录",
    },
    next: {
      employee: "员工登录页",
      enterprise: "企业登录页",
      platform: "平台登录页",
    },
  },
  en: {
    withCurrent:
      "You are on the {currentPortal}, so this {attempt} cannot continue here. Use the {nextPortal}: {url}",
    withoutCurrent: "This page cannot complete this {attempt}. Use the {nextPortal}: {url}",
    unknown:
      "This page does not match this sign-in request. Employees use {employeeUrl}, enterprise admins use {enterpriseUrl}, and platform admins use {platformUrl}.",
    current: {
      employee: "employee sign-in entry",
      enterprise: "enterprise sign-in entry",
      platform: "platform sign-in entry",
    },
    attempt: {
      employee: "employee sign-in",
      enterprise: "enterprise admin sign-in",
      platform: "platform admin sign-in",
    },
    next: {
      employee: "employee sign-in page",
      enterprise: "enterprise sign-in page",
      platform: "platform sign-in page",
    },
  },
};

/** The sentence shown when an employee login is submitted on biz.openbot.love. */
export const SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_ZH =
  "你正在企业登录入口，不能在这里完成员工登录。请改用员工登录页：https://www.openbot.love/";

export const SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_EN =
  "You are on the enterprise sign-in entry, so this employee sign-in cannot continue here. Use the employee sign-in page: https://www.openbot.love/";
