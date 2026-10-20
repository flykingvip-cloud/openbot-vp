import { describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.ts";
import { en } from "../i18n/locales/en.ts";
import { zh_CN } from "../i18n/locales/zh-CN.ts";
import {
  SURFACE_MISMATCH_COPY,
  SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_EN,
  SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_ZH,
} from "../i18n/surface-mismatch-copy.ts";
import { localizePlatformAuthLoginError } from "./controllers/platform-auth.ts";
import {
  formatSurfaceMismatchLoginMessage,
  isSafeOpenBotLoginHref,
} from "./controllers/surface-mismatch-message.ts";

function readSurfaceMismatch(map: { authHome?: unknown }): unknown {
  const authHome = map.authHome;
  if (!authHome || typeof authHome !== "object" || !("errors" in authHome)) {
    return undefined;
  }
  const errors = authHome.errors;
  if (!errors || typeof errors !== "object" || !("surfaceMismatch" in errors)) {
    return undefined;
  }
  return errors.surfaceMismatch;
}

describe("surface mismatch login copy", () => {
  it("zh-CN tells an employee login on the enterprise portal to use www", () => {
    expect(
      formatSurfaceMismatchLoginMessage(
        { requestSurface: "enterprise", targetSurface: "employee" },
        "zh-CN",
      ),
    ).toBe(SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_ZH);
    expect(SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_ZH).toContain("https://www.openbot.love/");
    expect(SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_ZH).not.toContain("biz.openbot.love");
    expect(SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_ZH).not.toContain("admin.openbot.love");
  });

  it("en keeps the same guidance for the English locale", () => {
    expect(
      formatSurfaceMismatchLoginMessage(
        { requestSurface: "enterprise", targetSurface: "employee" },
        "en",
      ),
    ).toBe(SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_EN);
    expect(SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_EN).toContain("https://www.openbot.love/");
  });

  it("names biz or admin only when that is the login that was attempted", () => {
    expect(
      formatSurfaceMismatchLoginMessage(
        { requestSurface: "employee", targetSurface: "enterprise" },
        "zh-CN",
      ),
    ).toBe(
      "你正在员工登录入口，不能在这里完成企业管理员登录。请改用企业登录页：https://biz.openbot.love/enterprise/login",
    );
    expect(
      formatSurfaceMismatchLoginMessage(
        { requestSurface: "employee", targetSurface: "platform" },
        "en",
      ),
    ).toContain("https://admin.openbot.love/platform/login");
  });

  it("localizes the gateway code without keeping the English API sentence on zh-CN", async () => {
    await i18n.setLocale("zh-CN");
    const message = localizePlatformAuthLoginError(
      "PLATFORM_AUTH_SURFACE_MISMATCH",
      "This login entry does not match the requested surface.",
      "",
      { requestSurface: "enterprise", targetSurface: "employee" },
    );
    expect(message).toBe(SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_ZH);
    expect(message).not.toContain("requested surface");

    await i18n.setLocale("en");
    expect(
      localizePlatformAuthLoginError(
        "PLATFORM_AUTH_SURFACE_MISMATCH",
        "This login entry does not match the requested surface.",
        "",
        { requestSurface: "enterprise", targetSurface: "employee" },
      ),
    ).toBe(SURFACE_MISMATCH_EMPLOYEE_ON_ENTERPRISE_EN);
  });

  it("publishes the same templates from the zh-CN and en catalogs", () => {
    expect(readSurfaceMismatch(zh_CN)).toEqual(SURFACE_MISMATCH_COPY["zh-CN"]);
    expect(readSurfaceMismatch(en)).toEqual(SURFACE_MISMATCH_COPY.en);
  });

  it("links only the public OpenBot login portals", () => {
    expect(isSafeOpenBotLoginHref("https://www.openbot.love/")).toBe(true);
    expect(isSafeOpenBotLoginHref("https://biz.openbot.love/enterprise/login")).toBe(true);
    expect(isSafeOpenBotLoginHref("https://admin.openbot.love/platform/login")).toBe(true);
    expect(isSafeOpenBotLoginHref("https://evil.example/enterprise/login")).toBe(false);
    expect(isSafeOpenBotLoginHref("javascript:alert(1)")).toBe(false);
  });
});
