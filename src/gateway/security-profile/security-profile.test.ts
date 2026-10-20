import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import {
  assertSecurityProfileAllowsStartup,
  SecurityProfileStartupError as Gate0StartupError,
} from "../security-profile.js";
import { formatSecurityProfileAuditLine } from "./audit-summary.js";
import { resolveSecurityProfile } from "./resolve.js";
import { SECURITY_PROFILE_ERROR_CODES, SecurityProfileStartupError } from "./types.js";
import { validateSecurityProfileStartup } from "./validate-startup.js";

const managedCfg = { data: { mode: "managed" as const } } satisfies OpenBotConfig;

function saveEnv(keys: string[]): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of keys) {
    prev[key] = process.env[key];
  }
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("resolveSecurityProfile", () => {
  it("defaults to PersonalLocal with local data mode", () => {
    const profile = resolveSecurityProfile({ cfg: {}, env: {} });
    expect(profile.kind).toBe("PersonalLocal");
    expect(profile.dataMode).toBe("local");
    expect(profile.isolationLevel).toBe("single_operator");
    expect(profile.resolutionSource).toBe("default");
  });

  it("maps managed data mode to ManagedEnterprise", () => {
    const profile = resolveSecurityProfile({
      cfg: {},
      env: { OPENBOT_DATA_MODE: "managed" },
    });
    expect(profile.kind).toBe("ManagedEnterprise");
    expect(profile.dataMode).toBe("managed");
  });

  it("ignores client-supplied profile overrides (server-controlled resolution only)", () => {
    const cfg = {
      data: { mode: "local" as const },
      // Hypothetical client-injected key must not change profile resolution.
      securityProfile: "ManagedEnterprise",
    } as OpenBotConfig;
    const profile = resolveSecurityProfile({ cfg, env: {} });
    expect(profile.kind).toBe("PersonalLocal");
  });
});

describe("validateSecurityProfileStartup", () => {
  const envKeys = [
    "OPENBOT_DATA_MODE",
    "OPENCLAW_DATA_MODE",
    "OPENBOT_TENANTS_ROOT",
    "OPENCLAW_TENANTS_ROOT",
    "OPENBOT_MULTITENANT",
    "OPENBOT_TENANT_EXECUTION_BOUNDARY",
    "OPENBOT_SECURITY_PROFILE",
    "OPENBOT_SHARED_CREDENTIAL_ROOT",
    "OPENBOT_PLUGIN_TENANT_ACCESS",
    "OPENBOT_STATE_DIR",
    "OPENCLAW_STATE_DIR",
    "OPENBOT_CONFIG_DIR",
    "OPENBOT_ACCOUNT_WORKER",
    "OPENBOT_ACCOUNT_WORKER_DOCKER",
    "OPENBOT_DOCKER_BIN",
    "OPENCLAW_DOCKER_BIN",
  ];

  afterEach(() => {
    // restoreEnv handled per test
  });

  it("allows Personal Local startup with documented defaults", () => {
    const prev = saveEnv(envKeys);
    try {
      delete process.env.OPENBOT_DATA_MODE;
      const result = validateSecurityProfileStartup({ cfg: {}, env: process.env });
      expect(result.profile.kind).toBe("PersonalLocal");
      expect(result.audit.profile).toBe("PersonalLocal");
    } finally {
      restoreEnv(prev);
    }
  });

  it("rejects shared-process multitenant even when sandbox.mode=all", () => {
    const prev = saveEnv(envKeys);
    try {
      process.env.OPENBOT_DATA_MODE = "managed";
      process.env.OPENBOT_TENANTS_ROOT = "/var/lib/openbot/tenant-volumes";
      process.env.OPENBOT_MULTITENANT = "1";
      process.env.OPENBOT_TENANT_EXECUTION_BOUNDARY = "dedicated";
      // P6b: unset defaults ON — explicit off to assert missing boundary.
      process.env.OPENBOT_ACCOUNT_WORKER = "0";
      process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "0";
      const cfg = {
        ...managedCfg,
        agents: { defaults: { sandbox: { mode: "all" as const } } },
      };
      expect(() => validateSecurityProfileStartup({ cfg, env: process.env })).toThrow(
        /DG0_MANAGED_MISSING_EXECUTION_BOUNDARY/,
      );
      expect(() => assertSecurityProfileAllowsStartup(cfg, process.env)).toThrow(Gate0StartupError);
      const gate0 = (() => {
        try {
          assertSecurityProfileAllowsStartup(cfg, process.env);
          return null;
        } catch (err) {
          return err as Gate0StartupError;
        }
      })();
      expect(gate0?.resolution.ok).toBe(false);
      expect(gate0?.resolution.isolationLevel).toBe("I2");
      expect(gate0?.resolution.isolationLevel).not.toBe("I4");
      expect(gate0?.codes).toContain("SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY");
    } finally {
      restoreEnv(prev);
    }
  });

  it("allows multitenant when exec runs in the Docker account worker", () => {
    const prev = saveEnv(envKeys);
    try {
      process.env.OPENBOT_DATA_MODE = "managed";
      process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
      process.env.OPENBOT_TENANTS_ROOT = "/var/lib/openbot/tenant-volumes";
      process.env.OPENBOT_MULTITENANT = "1";
      process.env.OPENBOT_ACCOUNT_WORKER = "1";
      process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "1";
      // Probe accepts configured docker binary; use node so CI hosts without docker still pass.
      process.env.OPENBOT_DOCKER_BIN = process.execPath;
      delete process.env.OPENBOT_TENANT_EXECUTION_BOUNDARY;
      const cfg = {
        ...managedCfg,
        agents: { defaults: { sandbox: { mode: "all" as const } } },
      };
      const started = validateSecurityProfileStartup({ cfg, env: process.env });
      expect(started.profile.kind).toBe("ManagedEnterprise");
      const gate0 = assertSecurityProfileAllowsStartup(cfg, process.env);
      expect(gate0.ok).toBe(true);
      expect(gate0.profile).toBe("managed_enterprise");
      expect(gate0.isolationLevel).toBe("I2");
      expect(gate0.isolationLevel).not.toBe("I4");
      expect(gate0.tenantExecutionBoundary).toBe("shared_process");
      expect(gate0.isolationClaim).toBe("account_execution_isolation");
      expect(gate0.errors).toEqual([]);
    } finally {
      restoreEnv(prev);
    }
  });

  it("does not treat the memory account worker or host exec as an execution boundary", () => {
    const prev = saveEnv(envKeys);
    try {
      process.env.OPENBOT_DATA_MODE = "managed";
      process.env.OPENBOT_TENANTS_ROOT = "/var/lib/openbot/tenant-volumes";
      process.env.OPENBOT_MULTITENANT = "1";
      process.env.OPENBOT_ACCOUNT_WORKER = "1";
      process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "0";
      const sandboxed = {
        ...managedCfg,
        agents: { defaults: { sandbox: { mode: "all" as const } } },
      };
      expect(() => validateSecurityProfileStartup({ cfg: sandboxed, env: process.env })).toThrow(
        /DG0_MANAGED_MISSING_EXECUTION_BOUNDARY/,
      );

      process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "1";
      process.env.OPENBOT_ACCOUNT_WORKER = "0";
      expect(() => validateSecurityProfileStartup({ cfg: sandboxed, env: process.env })).toThrow(
        /DG0_MANAGED_MISSING_EXECUTION_BOUNDARY/,
      );

      process.env.OPENBOT_ACCOUNT_WORKER = "1";
      const sandboxOff = { data: { mode: "managed" as const } };
      expect(() => validateSecurityProfileStartup({ cfg: sandboxOff, env: process.env })).toThrow(
        /DG0_MANAGED_MULTITENANT_SANDBOX_OFF/,
      );

      const gatewayExec = {
        ...sandboxed,
        tools: { exec: { host: "gateway" as const } },
      };
      expect(() => validateSecurityProfileStartup({ cfg: gatewayExec, env: process.env })).toThrow(
        /DG0_MANAGED_UNSCOPED_GATEWAY_EXEC/,
      );
    } finally {
      restoreEnv(prev);
    }
  });

  it("allows Managed Enterprise with server-side data.tenantId (single-tenant worker)", () => {
    const prev = saveEnv(envKeys);
    try {
      process.env.OPENBOT_DATA_MODE = "managed";
      process.env.OPENBOT_TENANTS_ROOT = "/var/lib/openbot/tenant-volumes";
      delete process.env.OPENBOT_MULTITENANT;
      const cfg = { data: { mode: "managed" as const, tenantId: "tenant-a" } };
      const result = validateSecurityProfileStartup({
        cfg,
        env: process.env,
      });
      expect(result.profile.kind).toBe("ManagedEnterprise");
      expect(result.profile.isolationLevel).toBe("dedicated_tenant_boundary");
      expect(result.audit.dedicatedSingleTenant).toBe(true);
      const gate0 = assertSecurityProfileAllowsStartup(cfg, process.env);
      expect(gate0.ok).toBe(true);
      expect(gate0.profile).toBe("managed_enterprise");
      expect(gate0.isolationLevel).toBe("I4");
      expect(gate0.tenantExecutionBoundary).toBe("dedicated");
    } finally {
      restoreEnv(prev);
    }
  });

  it("rejects Managed Enterprise without explicit OPENBOT_TENANTS_ROOT", () => {
    const prev = saveEnv(envKeys);
    try {
      process.env.OPENBOT_DATA_MODE = "managed";
      delete process.env.OPENBOT_TENANTS_ROOT;
      process.env.OPENBOT_MULTITENANT = "1";
      expect(() => validateSecurityProfileStartup({ cfg: managedCfg, env: process.env })).toThrow(
        SecurityProfileStartupError,
      );
      try {
        validateSecurityProfileStartup({ cfg: managedCfg, env: process.env });
      } catch (err) {
        expect(err).toBeInstanceOf(SecurityProfileStartupError);
        expect((err as SecurityProfileStartupError).code).toBe(
          SECURITY_PROFILE_ERROR_CODES.MANAGED_MISSING_TENANTS_ROOT,
        );
        expect(String(err)).not.toMatch(/tenant-a|\/var\/lib|password|token/i);
      }
    } finally {
      restoreEnv(prev);
    }
  });

  it("rejects Managed Enterprise without execution boundary markers", () => {
    const prev = saveEnv(envKeys);
    try {
      process.env.OPENBOT_DATA_MODE = "managed";
      process.env.OPENBOT_TENANTS_ROOT = "/var/lib/openbot/tenant-volumes";
      delete process.env.OPENBOT_MULTITENANT;
      expect(() =>
        validateSecurityProfileStartup({ cfg: { data: { mode: "managed" } }, env: process.env }),
      ).toThrow(SecurityProfileStartupError);
    } finally {
      restoreEnv(prev);
    }
  });

  it("rejects Managed Enterprise when tenant root aliases gateway state root", () => {
    const prev = saveEnv(envKeys);
    try {
      process.env.OPENBOT_DATA_MODE = "managed";
      process.env.OPENBOT_TENANTS_ROOT = "/var/lib/openbot/state";
      process.env.OPENBOT_STATE_DIR = "/var/lib/openbot/state";
      process.env.OPENBOT_MULTITENANT = "1";
      expect(() => validateSecurityProfileStartup({ cfg: managedCfg, env: process.env })).toThrow(
        /DG0_MANAGED_SHARED_STATE_ROOT/,
      );
      expect(() => assertSecurityProfileAllowsStartup(managedCfg, process.env)).toThrow(
        Gate0StartupError,
      );
    } finally {
      restoreEnv(prev);
    }
  });
});

describe("startup gates agree on one decision", () => {
  function decisions(
    cfg: OpenBotConfig,
    env: NodeJS.ProcessEnv,
    clientProfileHint?: string,
  ): { fileOk: boolean; fileCodes: string[]; directoryOk: boolean; directoryCode: string | null } {
    let fileOk = false;
    let fileCodes: string[] = [];
    try {
      assertSecurityProfileAllowsStartup(
        cfg,
        env,
        clientProfileHint ? { clientProfileHint } : undefined,
      );
      fileOk = true;
    } catch (err) {
      fileCodes = err instanceof Gate0StartupError ? [...err.codes] : ["THREW"];
    }
    let directoryOk = false;
    let directoryCode: string | null = null;
    try {
      validateSecurityProfileStartup({ cfg, env, clientProfileHint });
      directoryOk = true;
    } catch (err) {
      directoryCode = err instanceof SecurityProfileStartupError ? err.code : "THREW";
    }
    return { fileOk, fileCodes, directoryOk, directoryCode };
  }

  const dedicatedRoot = {
    OPENBOT_DATA_MODE: "managed",
    OPENBOT_SECURITY_PROFILE: "managed_enterprise",
    OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
    OPENBOT_TENANTS_ROOT: "/var/lib/openbot/tenant-volumes",
  };

  it("allows the same server-selected dedicated managed profile", () => {
    const cfg = { data: { mode: "managed" as const } };
    const result = decisions(cfg, dedicatedRoot);
    expect(result.fileOk).toBe(true);
    expect(result.directoryOk).toBe(true);
  });

  it("rejects a client profile hint on both startup gates", () => {
    const result = decisions({ data: { mode: "local" } }, {}, "managed_enterprise");
    expect(result.fileOk).toBe(false);
    expect(result.directoryOk).toBe(false);
    expect(result.fileCodes).toContain("SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED");
    expect(result.directoryCode).toBe(SECURITY_PROFILE_ERROR_CODES.CLIENT_OVERRIDE_REJECTED);
    const server = decisions({ data: { mode: "local" } }, {});
    expect(server.fileOk).toBe(true);
    expect(server.directoryOk).toBe(true);
  });

  it("rejects tenantsRootConfigured or OPENCLAW_TENANTS_ROOT without OPENBOT_TENANTS_ROOT", () => {
    const booleanOnly = decisions(
      {
        data: { mode: "managed" },
        gateway: {
          security: {
            profile: "managed_enterprise",
            tenantExecutionBoundary: "dedicated",
            tenantsRootConfigured: true,
          },
        },
      },
      { OPENBOT_DATA_MODE: "managed", OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated" },
    );
    expect(booleanOnly.fileOk).toBe(false);
    expect(booleanOnly.directoryOk).toBe(false);
    expect(booleanOnly.fileCodes).toContain("SECURITY_PROFILE_MISSING_TENANTS_ROOT");
    expect(booleanOnly.directoryCode).toBe(
      SECURITY_PROFILE_ERROR_CODES.MANAGED_MISSING_TENANTS_ROOT,
    );

    const legacyOnly = decisions(
      { data: { mode: "managed" } },
      {
        OPENBOT_DATA_MODE: "managed",
        OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
        OPENCLAW_TENANTS_ROOT: "/var/lib/openbot/tenant-volumes",
      },
    );
    expect(legacyOnly.fileOk).toBe(false);
    expect(legacyOnly.directoryOk).toBe(false);
    expect(legacyOnly.directoryCode).toBe(
      SECURITY_PROFILE_ERROR_CODES.MANAGED_MISSING_TENANTS_ROOT,
    );
  });

  it("rejects shared credential root and unrestricted plugin access on both gates", () => {
    const creds = decisions(
      { data: { mode: "managed" } },
      { ...dedicatedRoot, OPENBOT_SHARED_CREDENTIAL_ROOT: "/var/empty/shared-creds" },
    );
    expect(creds.fileOk).toBe(false);
    expect(creds.directoryOk).toBe(false);
    expect(creds.fileCodes).toContain("SECURITY_PROFILE_SHARED_CREDENTIAL_ROOT");
    expect(creds.directoryCode).toBe(SECURITY_PROFILE_ERROR_CODES.MANAGED_SHARED_CREDENTIAL_ROOT);

    const plugin = decisions(
      {
        data: { mode: "managed" },
        gateway: { security: { pluginTenantAccess: "unrestricted" } },
      },
      dedicatedRoot,
    );
    expect(plugin.fileOk).toBe(false);
    expect(plugin.directoryOk).toBe(false);
    expect(plugin.fileCodes).toContain("SECURITY_PROFILE_UNRESTRICTED_PLUGIN_ACCESS");
    expect(plugin.directoryCode).toBe(
      SECURITY_PROFILE_ERROR_CODES.MANAGED_UNRESTRICTED_PLUGIN_ACCESS,
    );
  });
});

describe("formatSecurityProfileAuditLine", () => {
  it("emits redacted profile summary without paths or tenant ids", () => {
    const line = formatSecurityProfileAuditLine({
      profile: "ManagedEnterprise",
      isolationLevel: "dedicated_tenant_boundary",
      dataMode: "managed",
      multitenantAddressing: true,
      explicitTenantsRoot: true,
      dedicatedSingleTenant: false,
    });
    expect(line).toContain("ManagedEnterprise");
    expect(line).not.toMatch(/tenant-a|\/var\/lib|password/i);
  });
});
