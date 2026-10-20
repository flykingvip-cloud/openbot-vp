/**
 * Stage 3 API-03 evidence: policy reject returns an explicit error
 * (not empty 200 / not silent drop).
 *
 * Surfaces covered here:
 * - managed_enterprise security-profile fail-closed → SECURITY_PROFILE_* codes /
 *   SecurityProfileStartupError (real product functions).
 * - HTTP `/tools/invoke` authoritative denies are proven in
 *   `src/gateway/tools-invoke-http.test.ts` (404 `{ok:false,error}`; enforced
 *   tenant capability deny). This file does not re-mock that HTTP stack.
 *
 * Remaining gaps (ledger stays honest):
 * - Default OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE=shadow: tenantCapabilities deny
 *   does not change HTTP until mode=enforced (by design / rollout).
 * - Not live IdP / multi-tenant fleet; not every webhook/plugin policy surface.
 * Stage 3 overall is not PASS; stage8_eligible stays false.
 */
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../src/config/types.js";
import {
  assertSecurityProfileAllowsStartup,
  resolveSecurityProfile,
  SecurityProfileStartupError,
} from "../../src/gateway/security-profile.js";

function cfg(partial?: OpenBotConfig): OpenBotConfig {
  return partial ?? {};
}

const ENTERPRISE_BASE_ENV = {
  OPENBOT_SECURITY_PROFILE: "managed_enterprise",
  OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
  OPENBOT_TENANTS_ROOT: "/var/empty/tenants-placeholder",
} as const;

describe("Stage 3 API-03 enterprise policy reject (fail-closed, explicit errors)", () => {
  it("rejects managed_enterprise missing execution boundary with an explicit code", () => {
    const resolution = resolveSecurityProfile(cfg({ data: { mode: "managed" } }), {
      OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      OPENBOT_TENANTS_ROOT: "/var/empty/tenants-placeholder",
    });
    expect(resolution.ok).toBe(false);
    expect(resolution.errors.map((e) => e.code)).toContain(
      "SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY",
    );
    expect(
      resolution.errors.every((e) => typeof e.message === "string" && e.message.length > 0),
    ).toBe(true);
  });

  it("rejects shared credential / browser roots with explicit SECURITY_PROFILE_* codes", () => {
    const browser = resolveSecurityProfile(cfg({ data: { mode: "managed" } }), {
      ...ENTERPRISE_BASE_ENV,
      OPENBOT_SHARED_BROWSER_ROOT: "/var/empty/shared-browser",
    });
    expect(browser.ok).toBe(false);
    expect(browser.errors.map((e) => e.code)).toContain("SECURITY_PROFILE_SHARED_BROWSER_ROOT");

    const creds = resolveSecurityProfile(cfg({ data: { mode: "managed" } }), {
      ...ENTERPRISE_BASE_ENV,
      OPENBOT_SHARED_CREDENTIAL_ROOT: "/var/empty/shared-creds",
    });
    expect(creds.ok).toBe(false);
    expect(creds.errors.map((e) => e.code)).toContain("SECURITY_PROFILE_SHARED_CREDENTIAL_ROOT");
  });

  it("rejects client-supplied security profile override with an explicit code", () => {
    const resolution = resolveSecurityProfile(
      cfg({ data: { mode: "local" } }),
      {},
      { clientProfileHint: "managed_enterprise" },
    );
    expect(resolution.ok).toBe(false);
    expect(resolution.errors.map((e) => e.code)).toContain(
      "SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED",
    );
  });

  it("assertSecurityProfileAllowsStartup throws SecurityProfileStartupError (not silent allow)", () => {
    expect(() =>
      assertSecurityProfileAllowsStartup(cfg({ data: { mode: "managed" } }), {
        OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      }),
    ).toThrow(SecurityProfileStartupError);

    try {
      assertSecurityProfileAllowsStartup(cfg({ data: { mode: "managed" } }), {
        OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      });
      expect.unreachable("startup must fail closed");
    } catch (err) {
      expect(err).toBeInstanceOf(SecurityProfileStartupError);
      const startupErr = err as SecurityProfileStartupError;
      expect(startupErr.codes.length).toBeGreaterThan(0);
      expect(startupErr.message.length).toBeGreaterThan(0);
      expect(startupErr.message).toMatch(/security profile/i);
    }
  });
});
