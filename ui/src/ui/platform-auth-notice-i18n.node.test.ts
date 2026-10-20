import { describe, expect, it } from "vitest";
import type { TranslationMap } from "../i18n/lib/types.ts";
import { en } from "../i18n/locales/en.ts";
import { zh_CN } from "../i18n/locales/zh-CN.ts";

/**
 * `submitPlatformAuth` falls back to `overview.platformAuth.notice.${submittedMode}`
 * for every non-platform login success. These keys must exist in zh-CN and en;
 * a missing leaf renders as the raw dotted key on employee settings Security.
 *
 * Lives under `ui/src/ui/` because the root vitest config includes that tree
 * and does not collect `ui/src/i18n/**`.
 */

/** Modes resolved by `t(\`overview.platformAuth.notice.${submittedMode}\`)`. */
const LOGIN_SUCCESS_NOTICE_KEYS = [
  "login",
  "employeeLogin",
  "employee-register",
  "enterprise-activate",
  "password-reset",
  "forgot-password",
  "enterprise-create",
  "platform-enterprise-create",
] as const;

function readNotice(map: TranslationMap, key: string): string {
  const overview = map.overview;
  const platformAuth = overview && typeof overview === "object" ? overview.platformAuth : undefined;
  const notice = platformAuth && typeof platformAuth === "object" ? platformAuth.notice : undefined;
  const value = notice && typeof notice === "object" ? notice[key] : undefined;
  if (typeof value !== "string") {
    return "";
  }
  return value;
}

describe("overview.platformAuth.notice login-success copy", () => {
  it.each(LOGIN_SUCCESS_NOTICE_KEYS)("zh-CN resolves notice.%s", (key) => {
    const value = readNotice(zh_CN, key);
    expect(value.length).toBeGreaterThan(0);
    expect(value).not.toContain("overview.platformAuth.notice");
  });

  it.each(LOGIN_SUCCESS_NOTICE_KEYS)("en resolves notice.%s", (key) => {
    const value = readNotice(en, key);
    expect(value.length).toBeGreaterThan(0);
    expect(value).not.toContain("overview.platformAuth.notice");
  });

  it("uses the existing login success sentence", () => {
    expect(readNotice(zh_CN, "login")).toBe("已登录企业工作台。");
    expect(readNotice(en, "login")).toBe("Signed in to the enterprise workspace.");
  });

  it("keeps the employee home success sentence off the enterprise workspace", () => {
    expect(readNotice(zh_CN, "employeeLogin")).toBe("已登录工作台。");
    expect(readNotice(zh_CN, "employeeLogin")).not.toContain("企业工作台");
    expect(readNotice(en, "employeeLogin")).toBe("Signed in to your workspace.");
    expect(readNotice(en, "employeeLogin").toLowerCase()).not.toContain("enterprise");
  });
});
