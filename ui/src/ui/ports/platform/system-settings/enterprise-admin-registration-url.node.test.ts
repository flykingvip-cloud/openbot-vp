import { describe, expect, it } from "vitest";
import { buildPlatformEnterpriseAdminRegistrationUrl } from "./page.ts";

describe("buildPlatformEnterpriseAdminRegistrationUrl", () => {
  it("prefers API activationUrl when present", () => {
    expect(
      buildPlatformEnterpriseAdminRegistrationUrl({
        inviteCode: "ADMIN-1",
        activationUrl:
          "https://biz.openbot.love/enterprise/login?authMode=enterprise-activate&code=ADMIN-1#auth",
      }),
    ).toBe(
      "https://biz.openbot.love/enterprise/login?authMode=enterprise-activate&code=ADMIN-1#auth",
    );
  });

  it("builds biz enterprise-login deep link with authMode", () => {
    const url = buildPlatformEnterpriseAdminRegistrationUrl({
      inviteCode: "ADMIN-XYZ",
      email: "ops@acme.test",
      adminName: "运营",
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("biz.openbot.love");
    expect(parsed.pathname).toBe("/enterprise/login");
    expect(parsed.searchParams.get("authMode")).toBe("enterprise-activate");
    expect(parsed.searchParams.get("code")).toBe("ADMIN-XYZ");
    expect(parsed.searchParams.get("email")).toBe("ops@acme.test");
    expect(parsed.searchParams.get("name")).toBe("运营");
    expect(parsed.hash).toBe("#auth");
  });
});
