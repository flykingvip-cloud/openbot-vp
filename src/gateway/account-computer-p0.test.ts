/**
 * Account Computer v4.1 P0: account execution isolation and governance §7.1.
 * This is not Gateway-compromise blast-radius isolation.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertAccountMountsAllowed,
  buildAccountSandboxMountPlan,
  formatAccountDockerBind,
} from "../agents/sandbox/account-mounts.js";
import { multitenantSandboxStartupIssue } from "../agents/sandbox/account-sandbox-startup.js";
import { resolveAccountExecScopeKey } from "../agents/sandbox/account-scope.js";
import {
  AccountBrowserProfileOverrideError,
  allocateAccountBrowserCdpPort,
  assertNoClientBrowserProfileOverride,
  ensureColdAccountBrowserProfile,
  isGlobalBrowserCdpPoolPort,
  peekAccountBrowserCdpPort,
  releaseAccountBrowserCdpPort,
  releaseAccountBrowserCdpPortsOnExit,
  resetAccountBrowserCdpPortsForTests,
} from "../browser/account-browser-namespace.js";
import { rejectAgentAssetWriteWhenDenied } from "./access-control/authorize.js";
import { resolveAccountExecutionPaths } from "./account-execution-paths.js";
import { adaptCommercialRunGate } from "./governance/adapters/commercial-run-adapter.js";
import { resolveSecurityProfile as resolveGate0 } from "./security-profile.js";
import { resolveSecurityProfile as resolveDirectoryProfile } from "./security-profile/resolve.js";
import {
  SECURITY_PROFILE_ERROR_CODES,
  SecurityProfileStartupError,
} from "./security-profile/types.js";
import { validateSecurityProfileStartup } from "./security-profile/validate-startup.js";

const ENV_KEYS = [
  "OPENBOT_DATA_MODE",
  "OPENBOT_MULTITENANT",
  "OPENBOT_TENANTS_ROOT",
  "OPENBOT_STATE_DIR",
  "OPENBOT_TENANT_EXECUTION_BOUNDARY",
  "OPENBOT_SECURITY_PROFILE",
] as const;

function saveEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
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

describe("account computer P0 browser isolation", () => {
  let prev: Record<string, string | undefined>;
  let root: string;

  afterEach(async () => {
    restoreEnv(prev);
    resetAccountBrowserCdpPortsForTests();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps one profile directory per tenant and user and rejects client overrides", async () => {
    prev = saveEnv();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-browser-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    const stateDir = path.join(root, "operator-state");
    process.env.OPENBOT_STATE_DIR = stateDir;
    const cfg = { data: { mode: "managed" as const } };
    const ctx = { tenantId: "tenant-a", userId: "user-a", domain: "employee" as const };
    const first = resolveAccountExecutionPaths({ ctx, cfg, agentId: "bot" });
    const again = resolveAccountExecutionPaths({ ctx, cfg, agentId: "other-bot" });
    expect(first.browserProfileDir).toBe(again.browserProfileDir);
    expect(first.browserProfileDir).toBe(
      path.join(stateDir, "operators", "user-a", "state", "browser"),
    );
    expect(first.workspaceDir).not.toBe(again.workspaceDir);
    await ensureColdAccountBrowserProfile(first.browserProfileDir);
    const marker = path.join(first.browserProfileDir, "Cookies");
    await fs.writeFile(marker, "keep", "utf8");
    await ensureColdAccountBrowserProfile(first.browserProfileDir);
    expect(await fs.readFile(marker, "utf8")).toBe("keep");

    const other = resolveAccountExecutionPaths({
      ctx: { tenantId: "tenant-a", userId: "user-b", domain: "employee" },
      cfg,
      agentId: "bot",
    });
    expect(other.browserProfileDir).not.toBe(first.browserProfileDir);

    expect(() =>
      assertNoClientBrowserProfileOverride({
        multitenantManaged: true,
        profilePath: other.browserProfileDir,
      }),
    ).toThrow(AccountBrowserProfileOverrideError);
    expect(() =>
      assertNoClientBrowserProfileOverride({
        multitenantManaged: false,
        profile: "openclaw",
      }),
    ).not.toThrow();
  });

  it("allocates a CDP port outside the global pool and releases it", async () => {
    prev = saveEnv();
    const holder = "account:tenant-a:user-a:browser";
    const port = await allocateAccountBrowserCdpPort(holder);
    expect(isGlobalBrowserCdpPoolPort(port)).toBe(false);
    expect(await allocateAccountBrowserCdpPort(holder)).toBe(port);
    releaseAccountBrowserCdpPort(holder);
    expect(peekAccountBrowserCdpPort(holder)).toBeUndefined();
  });

  it("releases CDP holders from the process-exit hook", async () => {
    prev = saveEnv();
    const holder = "account:tenant-a:user-a:browser";
    await allocateAccountBrowserCdpPort(holder);
    expect(peekAccountBrowserCdpPort(holder)).toBeTypeOf("number");
    releaseAccountBrowserCdpPortsOnExit();
    expect(peekAccountBrowserCdpPort(holder)).toBeUndefined();
  });
});

describe("account computer P0 sandbox mounts", () => {
  it("allows only the current agent workspace and artifacts", () => {
    const tenantsRoot = "/var/openbot/tenants";
    const userRoot = path.join(tenantsRoot, "tenant-a", "users", "user-a");
    const workspaceDir = path.join(userRoot, "OpenBot", "agents", "bot", "workspace");
    const artifactsDir = path.join(userRoot, "OpenBot", "agents", "bot", "artifacts");
    const browserProfileDir = path.join(userRoot, "state", "browser");
    const credentialDir = path.join(userRoot, "state", "agents", "bot", "agent");
    const otherUser = path.join(tenantsRoot, "tenant-a", "users", "user-b");
    const plan = buildAccountSandboxMountPlan({
      workspaceDir,
      artifactsDir,
      browserProfileDir,
      sharedSkillsDir: "/opt/openbot/skills",
    });
    const binds = [...plan.exec, ...plan.browser].map(formatAccountDockerBind);
    expect(
      resolveAccountExecScopeKey({ tenantId: "tenant-a", userId: "user-a", agentId: "bot" }),
    ).toBe("account:tenant-a:user-a:agent:bot");
    expect(() =>
      assertAccountMountsAllowed({
        binds,
        allow: [...plan.exec, ...plan.browser],
        tenantsRoot,
        userRoot,
        credentialDir,
        configDir: "/etc/openbot",
      }),
    ).not.toThrow();

    const foreign = `${path.join(otherUser, "OpenBot", "agents", "bot", "workspace")}:/account/workspace:rw`;
    expect(() =>
      assertAccountMountsAllowed({
        binds: [foreign],
        allow: plan.exec,
        tenantsRoot,
        userRoot,
        credentialDir,
        configDir: "/etc/openbot",
        otherUserRoots: [otherUser],
      }),
    ).toThrow(/another user/);
    expect(() =>
      assertAccountMountsAllowed({
        binds: [`${tenantsRoot}:/tenants:rw`],
        allow: plan.exec,
        tenantsRoot,
        userRoot,
        credentialDir,
        configDir: "/etc/openbot",
      }),
    ).toThrow(/tenants/);
    expect(() =>
      assertAccountMountsAllowed({
        binds: [`${credentialDir}:/account/secrets:ro`],
        allow: plan.exec,
        tenantsRoot,
        userRoot,
        credentialDir,
        configDir: "/etc/openbot",
      }),
    ).toThrow(/credential/);
    expect(() =>
      assertAccountMountsAllowed({
        binds: ["/var/run/docker.sock:/var/run/docker.sock:rw"],
        allow: plan.exec,
        tenantsRoot,
        userRoot,
        credentialDir,
        configDir: "/etc/openbot",
      }),
    ).toThrow(/docker.sock/);
  });
});

describe("account computer P0 startup", () => {
  let prev: Record<string, string | undefined>;

  afterEach(() => {
    restoreEnv(prev);
  });

  it("refuses dedicated plus multitenant as shared-process, never I4", () => {
    prev = saveEnv();
    const env = {
      OPENBOT_SECURITY_PROFILE: "managed_enterprise",
      OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
      OPENBOT_TENANTS_ROOT: "/var/lib/openbot/tenant-volumes",
      OPENBOT_MULTITENANT: "1",
      OPENBOT_DATA_MODE: "managed",
    };
    const cfg = {
      data: { mode: "managed" as const },
      agents: { defaults: { sandbox: { mode: "all" as const } } },
    };
    const gate0 = resolveGate0(cfg, env);
    expect(gate0.ok).toBe(false);
    expect(gate0.isolationLevel).toBe("I2");
    expect(gate0.isolationLevel).not.toBe("I4");
    expect(gate0.tenantExecutionBoundary).toBe("shared_process");
    expect(gate0.isolationClaim).toBe("account_execution_isolation");
    expect(gate0.errors.map((error) => error.code)).toContain(
      "SECURITY_PROFILE_MISSING_EXECUTION_BOUNDARY",
    );

    const directory = resolveDirectoryProfile({ cfg, env });
    expect(directory.isolationLevel).toBe("shared_process");
    expect(() => validateSecurityProfileStartup({ cfg, env: { ...process.env, ...env } })).toThrow(
      SecurityProfileStartupError,
    );
    try {
      validateSecurityProfileStartup({ cfg, env: { ...process.env, ...env } });
    } catch (err) {
      expect((err as SecurityProfileStartupError).code).toBe(
        SECURITY_PROFILE_ERROR_CODES.MANAGED_MISSING_EXECUTION_BOUNDARY,
      );
    }
  });

  it("refuses multitenant sandbox off and unbound gateway exec", () => {
    prev = saveEnv();
    const env = {
      OPENBOT_DATA_MODE: "managed",
      OPENBOT_MULTITENANT: "1",
      OPENBOT_TENANTS_ROOT: "/var/lib/openbot/tenant-volumes",
      OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
      OPENBOT_SECURITY_PROFILE: "managed_enterprise",
    };
    const off = resolveGate0({ data: { mode: "managed" } }, env);
    expect(off.ok).toBe(false);
    expect(off.errors.map((error) => error.code)).toContain(
      "SECURITY_PROFILE_MULTITENANT_SANDBOX_OFF",
    );
    expect(off.isolationLevel).not.toBe("I4");
    expect(() =>
      validateSecurityProfileStartup({
        cfg: { data: { mode: "managed" } },
        env: { ...process.env, ...env },
      }),
    ).toThrow(SecurityProfileStartupError);
    try {
      validateSecurityProfileStartup({
        cfg: { data: { mode: "managed" } },
        env: { ...process.env, ...env },
      });
    } catch (err) {
      expect((err as SecurityProfileStartupError).code).toBe(
        SECURITY_PROFILE_ERROR_CODES.MANAGED_MULTITENANT_SANDBOX_OFF,
      );
    }

    const gatewayExecCfg = {
      data: { mode: "managed" as const },
      agents: { defaults: { sandbox: { mode: "all" as const } } },
      tools: { exec: { host: "gateway" as const } },
    };
    expect(multitenantSandboxStartupIssue(gatewayExecCfg)).toBe("unscoped-gateway-exec");
    const gatewayGate = resolveGate0(gatewayExecCfg, env);
    expect(gatewayGate.ok).toBe(false);
    expect(gatewayGate.errors.map((error) => error.code)).toContain(
      "SECURITY_PROFILE_UNSCOPED_GATEWAY_EXEC",
    );
    expect(() =>
      validateSecurityProfileStartup({
        cfg: gatewayExecCfg,
        env: { ...process.env, ...env },
      }),
    ).toThrow(/DG0_MANAGED_UNSCOPED_GATEWAY_EXEC/);
  });

  it("still starts personal local with sandbox off", () => {
    prev = saveEnv();
    const resolution = resolveGate0({ data: { mode: "local" } }, {});
    expect(resolution.ok).toBe(true);
    expect(resolution.profile).toBe("personal_local");
    expect(resolution.isolationLevel).toBe("I1");
    const startup = validateSecurityProfileStartup({
      cfg: {},
      env: { ...process.env, OPENBOT_DATA_MODE: "local", OPENBOT_MULTITENANT: undefined },
    });
    expect(startup.profile.kind).toBe("PersonalLocal");
  });
});

describe("account computer P0 governance", () => {
  it("stamps correlation fields on the commercial decision and keeps runtimeLeaseId empty", () => {
    const decision = adaptCommercialRunGate({
      ts: "2026-10-06T00:00:00.000Z",
      gate: {
        status: "acquired",
        authorizationDecisionId: "gd-commercial-1",
        runId: "run-1",
        entry: "E6",
        tenantId: "tenant-a",
        userId: "user-a",
        executionId: "run-1",
        runtimeLeaseId: "",
        dataSpaceRef: "/tenants/tenant-a/users/user-a/OpenBot",
        browserNamespaceRef: "/tenants/tenant-a/users/user-a/state/browser",
        subjectId: "run-1",
      },
    });
    expect(decision.decisionId.startsWith("gd-") || decision.decisionId.length > 0).toBe(true);
    expect(decision.entry).toBe("E6");
    expect(decision.tenantId).toBe("tenant-a");
    expect(decision.userId).toBe("user-a");
    expect(decision.executionId).toBe("run-1");
    expect(decision.runtimeLeaseId).toBe("");
    expect(decision.dataSpaceRef).toContain("user-a");
    expect(decision.browserNamespaceRef).toContain("state/browser");
  });

  it("aborts the following write when asset access is denied", () => {
    let wrote = false;
    expect(() => {
      rejectAgentAssetWriteWhenDenied({
        allowed: false,
        mode: "enforce",
        decision: { allowed: false, reason: "explicit-deny" },
      });
      wrote = true;
    }).toThrow(/agent asset access denied: explicit-deny/);
    expect(wrote).toBe(false);
    expect(() =>
      rejectAgentAssetWriteWhenDenied({
        allowed: true,
        mode: "shadow",
        decision: { allowed: false, reason: "explicit-deny" },
      }),
    ).toThrow(/agent asset access denied: explicit-deny/);
  });
});
