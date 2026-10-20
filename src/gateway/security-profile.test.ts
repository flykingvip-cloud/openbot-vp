import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/types.js";
import {
  assertSecurityProfileAllowsStartup,
  resolveSecurityProfile,
  SecurityProfileStartupError,
  toSecurityProfileStartupAudit,
} from "./security-profile.js";

function cfg(partial?: OpenBotConfig): OpenBotConfig {
  return partial ?? {};
}

describe("resolveSecurityProfile", () => {
  it("starts Personal Local with documented local defaults", () => {
    const resolution = resolveSecurityProfile(cfg({ data: { mode: "local" } }), {});
    expect(resolution.ok).toBe(true);
    expect(resolution.profile).toBe("personal_local");
    expect(resolution.isolationLevel).toBe("I1");
    expect(resolution.source).toBe("derived_data_mode");
  });

  it("starts Managed Enterprise with complete dedicated-boundary configuration", () => {
    const resolution = resolveSecurityProfile(
      cfg({
        data: { mode: "managed" },
        gateway: {
          security: {
            profile: "managed_enterprise",
            tenantExecutionBoundary: "dedicated",
            tenantsRootConfigured: true,
          },
        },
      }),
      {
        OPENBOT_SECURITY_PROFILE: "managed_enterprise",
        OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
        OPENBOT_TENANTS_ROOT: "/var/empty/tenants-placeholder",
      },
    );
    expect(resolution.ok).toBe(true);
    expect(resolution.profile).toBe("managed_enterprise");
    expect(resolution.isolationLevel).toBe("I4");
    expect(resolution.tenantExecutionBoundary).toBe("dedicated");
  });

  it("fails Managed Enterprise when tenant execution boundary is missing", () => {
    const resolution = resolveSecurityProfile(cfg({ data: { mode: "managed" } }), {
      OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      OPENBOT_TENANTS_ROOT: "/var/empty/tenants-placeholder",
    });
    expect(resolution.ok).toBe(false);
    expect(resolution.errors.map((e) => e.code)).toContain(
      "SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY",
    );
  });

  it("fails Managed Enterprise with a shared browser or credential root", () => {
    const browser = resolveSecurityProfile(cfg({ data: { mode: "managed" } }), {
      OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
      OPENBOT_TENANTS_ROOT: "/var/empty/tenants-placeholder",
      OPENBOT_SHARED_BROWSER_ROOT: "/var/empty/shared-browser",
    });
    expect(browser.ok).toBe(false);
    expect(browser.errors.map((e) => e.code)).toContain("SECURITY_PROFILE_SHARED_BROWSER_ROOT");

    const creds = resolveSecurityProfile(cfg({ data: { mode: "managed" } }), {
      OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
      OPENBOT_TENANTS_ROOT: "/var/empty/tenants-placeholder",
      OPENBOT_SHARED_CREDENTIAL_ROOT: "/var/empty/shared-creds",
    });
    expect(creds.ok).toBe(false);
    expect(creds.errors.map((e) => e.code)).toContain("SECURITY_PROFILE_SHARED_CREDENTIAL_ROOT");
  });

  it("rejects client-supplied security profile hints", () => {
    const resolution = resolveSecurityProfile(
      cfg({ data: { mode: "local" } }),
      {},
      { clientProfileHint: "managed_enterprise" },
    );
    expect(resolution.ok).toBe(false);
    expect(resolution.errors.map((e) => e.code)).toContain(
      "SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED",
    );
    // Server-derived profile remains personal_local; client cannot switch it.
    expect(resolution.profile).toBe("personal_local");
  });

  it("redacts startup audit and error messages (no path/tenant leakage)", () => {
    const resolution = resolveSecurityProfile(cfg({ data: { mode: "managed" } }), {
      OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
      OPENBOT_TENANTS_ROOT: "/secret/tenant/path-should-not-leak",
      OPENBOT_SHARED_BROWSER_ROOT: "/secret/browser",
    });
    const audit = toSecurityProfileStartupAudit(resolution);
    const serialized = JSON.stringify({ audit, errors: resolution.errors });
    expect(serialized).not.toContain("/secret/");
    expect(serialized).not.toContain("path-should-not-leak");
    expect(audit.errorCodes).toContain("SECURITY_PROFILE_SHARED_BROWSER_ROOT");
  });

  it("assertSecurityProfileAllowsStartup throws before serving traffic", () => {
    expect(() =>
      assertSecurityProfileAllowsStartup(cfg({ data: { mode: "managed" } }), {
        OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      }),
    ).toThrow(SecurityProfileStartupError);
  });

  it("env OPENBOT_SECURITY_PROFILE takes precedence over config", () => {
    const resolution = resolveSecurityProfile(
      cfg({
        data: { mode: "managed" },
        gateway: { security: { profile: "managed_enterprise" } },
      }),
      { OPENBOT_SECURITY_PROFILE: "personal_local" },
    );
    expect(resolution.profile).toBe("personal_local");
    expect(resolution.source).toBe("env");
  });
});
