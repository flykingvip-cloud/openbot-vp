/**
 * Stage 3 six-column **Plugin/SDK authz** slice (narrow E1/E2).
 *
 * Proposition (§5.2 Plugin/SDK authz): plugins do not own security-profile
 * selection. Profile is server/env/config only; a client/plugin hint is
 * rejected; Managed Enterprise refuses unrestricted in-process plugin
 * tenant access; plugin-sdk does not export profile-selection APIs;
 * gateway startup does not pass clientProfileHint.
 *
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 * Not Plugin schema / idempotency / errors / backward; not live multi-tenant
 * fleet; not HTTP registerHttpHandler lint (schema column); not Stage 1
 * cross-operator store rewrite.
 *
 * Anchors: `resolveSecurityProfile` / `assertSecurityProfileAllowsStartup`
 * (`clientProfileHint` → SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED),
 * Managed Enterprise `pluginTenantAccess=unrestricted`
 * → SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS, `src/plugin-sdk/index.ts`
 * exports, `server.impl.ts` startup call site.
 */
import { readFileSync } from "node:fs";
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

describe("Stage 3 Plugin/SDK authz (E1/E2 narrow)", () => {
  it("client/plugin profile hint is rejected; server-derived profile unchanged", () => {
    const resolution = resolveSecurityProfile(
      cfg({ data: { mode: "local" } }),
      {},
      { clientProfileHint: "managed_enterprise" },
    );
    expect(resolution.ok).toBe(false);
    expect(resolution.errors.map((e) => e.code)).toContain(
      "SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED",
    );
    // Hint cannot flip the profile; local data mode stays personal_local.
    expect(resolution.profile).toBe("personal_local");

    expect(() =>
      assertSecurityProfileAllowsStartup(
        cfg({ data: { mode: "local" } }),
        {},
        {
          clientProfileHint: "managed_enterprise",
        },
      ),
    ).toThrow(SecurityProfileStartupError);
  });

  it("Managed Enterprise rejects unrestricted plugin tenant access", () => {
    const env = {
      OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
      OPENBOT_TENANTS_ROOT: "/var/empty/tenants-plugin-authz",
    };

    const ok = resolveSecurityProfile(
      cfg({
        data: { mode: "managed" },
        gateway: {
          security: {
            profile: "managed_enterprise",
            tenantExecutionBoundary: "dedicated",
            tenantsRootConfigured: true,
            pluginTenantAccess: "restricted",
          },
        },
      }),
      env,
    );
    expect(ok.ok).toBe(true);
    expect(ok.profile).toBe("managed_enterprise");

    const unrestricted = resolveSecurityProfile(
      cfg({
        data: { mode: "managed" },
        gateway: {
          security: {
            profile: "managed_enterprise",
            tenantExecutionBoundary: "dedicated",
            tenantsRootConfigured: true,
            pluginTenantAccess: "unrestricted",
          },
        },
      }),
      env,
    );
    expect(unrestricted.ok).toBe(false);
    expect(unrestricted.errors.map((e) => e.code)).toContain(
      "SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS",
    );

    const viaEnv = resolveSecurityProfile(
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
      { ...env, OPENBOT_PLUGIN_TENANT_ACCESS: "unrestricted" },
    );
    expect(viaEnv.ok).toBe(false);
    expect(viaEnv.errors.map((e) => e.code)).toContain(
      "SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS",
    );
  });

  it("plugin-sdk public index does not export security-profile selection APIs", () => {
    const source = readFileSync("src/plugin-sdk/index.ts", "utf8");
    for (const forbidden of [
      "resolveSecurityProfile",
      "assertSecurityProfileAllowsStartup",
      "SecurityProfileStartupError",
      "clientProfileHint",
      "OPENBOT_SECURITY_PROFILE",
      "pluginTenantAccess",
      "SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED",
      "SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS",
    ]) {
      expect(source, `plugin-sdk must not surface ${forbidden}`).not.toContain(forbidden);
    }
    // SDK still exposes HTTP route helpers (schema column), but not profile gates.
    expect(source).toContain("registerPluginHttpRoute");
  });

  it("gateway startup owns profile: assertSecurityProfileAllowsStartup without client hint", () => {
    const source = readFileSync("src/gateway/server.impl.ts", "utf8");
    expect(source).toMatch(
      /assertSecurityProfileAllowsStartup\s*\(\s*cfgAtStart\s*,\s*process\.env\s*\)/,
    );
    // No third-arg clientProfileHint at the startup call site.
    expect(source).not.toMatch(
      /assertSecurityProfileAllowsStartup\s*\(\s*cfgAtStart\s*,\s*process\.env\s*,\s*\{[^}]*clientProfileHint/,
    );
  });
});
