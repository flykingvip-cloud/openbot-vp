import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BROWSER_EVALUATE_ENABLED } from "../../browser/constants.js";
import { ensureBrowserControlAuth, resolveBrowserControlAuth } from "../../browser/control-auth.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import { ensureAccountProductionDirectories } from "../../gateway/account-execution-paths.js";
import { resolveAccountExecutionPaths } from "../../gateway/account-execution-paths.js";
import { resolveTenantsRoot } from "../../gateway/tenant-store-paths.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { syncSkillsToWorkspace } from "../skills.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../workspace.js";
import {
  grantAccountComputerBrowserTool,
  shouldGrantAccountComputerBrowserTool,
} from "./account-computer-browser-routing.js";
import { publishAccountComputerFailure } from "./account-computer-stream.js";
import {
  ACCOUNT_EXEC_WORKSPACE,
  type AccountMountGuard,
  assertAccountMountsAllowed,
  buildAccountSandboxMountPlan,
  formatAccountDockerBind,
  parseAccountDockerBind,
} from "./account-mounts.js";
import {
  accountComputerObserverUserId,
  type EmbeddedSandboxAccountInput,
  resolveProductionSandboxAccount,
} from "./account-scope.js";
import { resolveSharedAccountMountDirs } from "./account-shared-mounts.js";
import { resolveAccountWorkerBrowserControl } from "./account-worker-browser-bridge.js";
import { publishAccountWorkerBrowserObserver } from "./account-worker-embedded.js";
import { isAccountWorkerPrototypeEnabled } from "./account-worker-gateway.js";
import { AccountWorker, type AccountWorkerSandboxHandle } from "./account-worker.js";
import { ensureSandboxBrowser } from "./browser.js";
import { resolveSandboxConfigForAgent } from "./config.js";
import { decideAccountWorkerDockerFailure } from "./docker-engine-client.js";
import { ensureSandboxContainer } from "./docker.js";
import { createSandboxFsBridge } from "./fs-bridge.js";
import { maybePruneSandboxes } from "./prune.js";
import { parseRuntimeControllerRequest } from "./runtime-controller.js";
import { resolveSandboxRuntimeStatus } from "./runtime-status.js";
import { ensureSandboxRuntimeOwnership } from "./sandbox-runtime-ownership.js";
import { resolveSandboxScopeKey, resolveSandboxWorkspaceDir } from "./shared.js";
import { resolveSandboxToolPolicyForAgent } from "./tool-policy.js";
import type {
  SandboxConfig,
  SandboxContext,
  SandboxDockerConfig,
  SandboxWorkspaceInfo,
} from "./types.js";
import { ensureSandboxWorkspace } from "./workspace.js";

export function applyAccountSandboxConfig(params: {
  cfg: SandboxConfig;
  config?: OpenBotConfig;
  account: { tenantId: string; userId: string };
  agentId: string;
}): SandboxConfig {
  const paths = resolveAccountExecutionPaths({
    ctx: {
      tenantId: params.account.tenantId,
      userId: params.account.userId,
      domain: "employee",
    },
    cfg: params.config,
    agentId: params.agentId,
  });
  const shared = resolveSharedAccountMountDirs(params.config);
  const plan = buildAccountSandboxMountPlan({
    workspaceDir: paths.workspaceDir,
    artifactsDir: paths.artifactsDir,
    browserProfileDir: paths.browserProfileDir,
    sharedSkillsDir: shared.sharedSkillsDir,
    sharedCanvasDir: shared.sharedCanvasDir,
  });
  const execBinds = plan.exec.map(formatAccountDockerBind);
  const browserBinds = plan.browser.map(formatAccountDockerBind);
  const guard: AccountMountGuard = {
    execAllow: plan.exec,
    browserAllow: plan.browser,
    tenantsRoot: resolveTenantsRoot(),
    userRoot: paths.userRoot,
    credentialDir: paths.credentialDir,
    configDir: CONFIG_DIR,
    agentId: params.agentId,
    dataRoot: paths.dataRoot,
    browserProfileDir: paths.browserProfileDir,
  };
  assertAccountMountsAllowed({
    binds: [...execBinds, ...browserBinds],
    allow: [...plan.exec, ...plan.browser],
    tenantsRoot: guard.tenantsRoot,
    userRoot: guard.userRoot,
    credentialDir: guard.credentialDir,
    configDir: guard.configDir,
    agentId: guard.agentId,
    dataRoot: guard.dataRoot,
  });
  return {
    ...params.cfg,
    scope: "account",
    workspaceAccess: "rw",
    account: {
      tenantId: params.account.tenantId,
      userId: params.account.userId,
      agentId: params.agentId,
    },
    docker: { ...params.cfg.docker, binds: execBinds, workdir: ACCOUNT_EXEC_WORKSPACE },
    accountBrowserBinds: browserBinds,
    accountMountGuard: guard,
  };
}

async function ensureSandboxWorkspaceLayout(params: {
  cfg: ReturnType<typeof resolveSandboxConfigForAgent>;
  rawSessionKey: string;
  config?: OpenBotConfig;
  workspaceDir?: string;
}): Promise<{
  agentWorkspaceDir: string;
  scopeKey: string;
  sandboxWorkspaceDir: string;
  workspaceDir: string;
}> {
  const { cfg, rawSessionKey } = params;

  if (cfg.scope === "account" && cfg.accountMountGuard && cfg.account) {
    const created = await ensureAccountProductionDirectories({
      ctx: {
        tenantId: cfg.account.tenantId,
        userId: cfg.account.userId,
        domain: "employee",
      },
      cfg: params.config,
      agentId: cfg.account.agentId,
    });
    const scopeKey = resolveSandboxScopeKey(cfg.scope, rawSessionKey, cfg.account);
    return {
      agentWorkspaceDir: created.workspaceDir,
      scopeKey,
      sandboxWorkspaceDir: created.workspaceDir,
      workspaceDir: created.workspaceDir,
    };
  }

  const agentWorkspaceDir = resolveUserPath(
    params.workspaceDir?.trim() || DEFAULT_AGENT_WORKSPACE_DIR,
  );
  const workspaceRoot = resolveUserPath(cfg.workspaceRoot);
  const scopeKey = resolveSandboxScopeKey(cfg.scope, rawSessionKey, cfg.account);
  const sandboxWorkspaceDir =
    cfg.scope === "shared" ? workspaceRoot : resolveSandboxWorkspaceDir(workspaceRoot, scopeKey);
  const workspaceDir = cfg.workspaceAccess === "rw" ? agentWorkspaceDir : sandboxWorkspaceDir;

  if (workspaceDir === sandboxWorkspaceDir) {
    await ensureSandboxWorkspace(
      sandboxWorkspaceDir,
      agentWorkspaceDir,
      params.config?.agents?.defaults?.skipBootstrap,
    );
    if (cfg.workspaceAccess !== "rw") {
      try {
        await syncSkillsToWorkspace({
          sourceWorkspaceDir: agentWorkspaceDir,
          targetWorkspaceDir: sandboxWorkspaceDir,
          config: params.config,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        defaultRuntime.error?.(`Sandbox skill sync failed: ${message}`);
      }
    }
  } else {
    await fs.mkdir(workspaceDir, { recursive: true });
  }
  // After seed and skill writes. Unset docker.user still follows the directory
  // owner; an explicit non-root user (typically 1000:1000) must own the mount.
  await ensureSandboxRuntimeOwnership([workspaceDir], {
    sandboxUser: cfg.docker.user,
    requireExplicitUser: true,
  });

  return { agentWorkspaceDir, scopeKey, sandboxWorkspaceDir, workspaceDir };
}

export async function resolveSandboxDockerUser(params: {
  docker: SandboxDockerConfig;
  workspaceDir: string;
  stat?: (workspaceDir: string) => Promise<{ uid: number; gid: number }>;
}): Promise<SandboxDockerConfig> {
  const configuredUser = params.docker.user?.trim();
  if (configuredUser) {
    return params.docker;
  }
  const stat = params.stat ?? ((workspaceDir: string) => fs.stat(workspaceDir));
  try {
    const workspaceStat = await stat(params.workspaceDir);
    const uid = Number.isInteger(workspaceStat.uid) ? workspaceStat.uid : null;
    const gid = Number.isInteger(workspaceStat.gid) ? workspaceStat.gid : null;
    if (uid === null || gid === null || uid < 0 || gid < 0) {
      return params.docker;
    }
    return { ...params.docker, user: `${uid}:${gid}` };
  } catch {
    return params.docker;
  }
}

/**
 * Gateway sandboxes use `/workspace`. The Account Worker exec container mounts
 * the account workspace at `/account/workspace` and does not have `/workspace`.
 * The filesystem bridge must target that mount or tool construction throws
 * "Sandbox filesystem bridge is unavailable."
 */
function resolveAccountWorkerContainerWorkdir(
  docker: SandboxDockerConfig,
  workspaceDir: string,
): string {
  const host = path.resolve(workspaceDir);
  for (const bind of docker.binds ?? []) {
    try {
      const parsed = parseAccountDockerBind(bind);
      if (path.resolve(parsed.hostPath) === host && parsed.containerPath.startsWith("/")) {
        return parsed.containerPath;
      }
    } catch {
      // Skip binds that are not account host:container[:mode] specs.
    }
  }
  return ACCOUNT_EXEC_WORKSPACE;
}

function resolveSandboxSession(params: { config?: OpenBotConfig; sessionKey?: string }) {
  const rawSessionKey = params.sessionKey?.trim();
  if (!rawSessionKey) {
    return null;
  }

  const runtime = resolveSandboxRuntimeStatus({
    cfg: params.config,
    sessionKey: rawSessionKey,
  });
  if (!runtime.sandboxed) {
    return null;
  }

  const cfg = resolveSandboxConfigForAgent(params.config, runtime.agentId);
  return { rawSessionKey, runtime, cfg };
}

/**
 * Tenant sandbox start for the worker prototype.
 * Parses the lease request first so an illegal body never reaches docker.
 */
async function startSandboxedAccountWorker(params: {
  config?: OpenBotConfig;
  cfg: SandboxConfig;
  rawSessionKey: string;
  agentId: string;
  account: { tenantId: string; userId: string };
  handle: AccountWorkerSandboxHandle;
}): Promise<SandboxContext> {
  const request = parseRuntimeControllerRequest(params.handle.request);
  if (
    request.tenantId !== params.account.tenantId.trim() ||
    request.userId !== params.account.userId.trim() ||
    normalizeAgentId(request.agentId) !== normalizeAgentId(params.agentId)
  ) {
    throw new Error("Account worker request does not match the server-derived account.");
  }
  const tenantId = params.account.tenantId.trim();
  const userId = params.account.userId.trim();
  const lifecycle = params.handle.lifecycle;
  let status: Awaited<ReturnType<AccountWorker["start"]>>;
  let browserContainerName: string | null = null;
  if (lifecycle) {
    status = (await lifecycle.acquire(params.handle.request)).status;
    if (
      status.phase === "RUNNING" &&
      status.execContainerName &&
      status.workspaceDir &&
      lifecycle.browse
    ) {
      browserContainerName = (await lifecycle.browse({ tenantId, userId })).containerName;
    }
  } else {
    const worker =
      params.handle.worker ??
      new AccountWorker({
        cfg: params.config,
        operatorImage: params.cfg.docker.image,
        browserImage: params.cfg.browser.image,
        statePath: params.handle.statePath,
        controlPlane: params.handle.controlPlane,
        driver: params.handle.driver,
        now: params.handle.now,
        idleAfterMs: params.handle.idleAfterMs,
        env: params.handle.env,
      });
    status = await worker.start(params.handle.request);
    if (status.phase === "RUNNING" && status.execContainerName && status.workspaceDir) {
      browserContainerName = (await worker.browse()).containerName;
    }
  }
  if (status.phase !== "RUNNING" || !status.execContainerName || !status.workspaceDir) {
    throw new Error(
      `Account worker did not reach RUNNING (${status.phase}${status.lastFailure ? `: ${status.lastFailure}` : ""}).`,
    );
  }
  if (browserContainerName) {
    try {
      await publishAccountWorkerBrowserObserver({
        tenantId,
        userId,
        containerName: browserContainerName,
        agentLabel: params.agentId,
        env: params.handle.env,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      defaultRuntime.error?.(`Account worker preview publish failed: ${message}`);
    }
  }
  const grantBrowser =
    Boolean(browserContainerName) &&
    shouldGrantAccountComputerBrowserTool(
      resolveSandboxToolPolicyForAgent(params.config, params.agentId),
    );
  let accountBrowser: SandboxContext["browser"];
  let accountComputerAttachFailure: string | undefined;
  if (grantBrowser && browserContainerName) {
    try {
      const control = await resolveAccountWorkerBrowserControl({
        tenantId,
        userId,
        containerName: browserContainerName,
        config: params.config,
        env: params.handle.env,
      });
      if (control.status === "attached") {
        accountBrowser = control.browser;
      } else if (control.status === "unavailable") {
        accountComputerAttachFailure = control.reason;
      }
    } catch (error) {
      accountComputerAttachFailure = error instanceof Error ? error.message : String(error);
    }
    if (accountComputerAttachFailure) {
      defaultRuntime.error?.(
        `Account Computer browser control unavailable session=${params.rawSessionKey} agent=${params.agentId} container=${browserContainerName}: ${accountComputerAttachFailure}`,
      );
    }
  }
  const containerWorkdir = resolveAccountWorkerContainerWorkdir(
    params.cfg.docker,
    status.workspaceDir,
  );
  const sandboxContext: SandboxContext = {
    enabled: true,
    sessionKey: params.rawSessionKey,
    workspaceDir: status.workspaceDir,
    agentWorkspaceDir: status.workspaceDir,
    workspaceAccess: "rw",
    containerName: status.execContainerName,
    containerWorkdir,
    docker: { ...params.cfg.docker, workdir: containerWorkdir },
    tools: accountBrowser ? grantAccountComputerBrowserTool(params.cfg.tools) : params.cfg.tools,
    browserAllowHostControl: false,
    ...(accountBrowser ? { browser: accountBrowser, accountComputerBrowser: true as const } : {}),
    ...(accountComputerAttachFailure ? { accountComputerAttachFailure } : {}),
  };
  // Tool construction refuses a sandboxed workspace that has no bridge.
  // The bridge docker-execs this exec container; paths follow the account mounts.
  sandboxContext.fsBridge = createSandboxFsBridge({ sandbox: sandboxContext });
  return sandboxContext;
}

export async function resolveSandboxContext(params: {
  config?: OpenBotConfig;
  sessionKey?: string;
  workspaceDir?: string;
  /** Server-derived account. Model and tool parameters must not supply this. */
  account?: { tenantId: string; userId: string };
  /**
   * P2 worker prototype. Honored only when the feature flag is on for managed
   * enterprise. The request is a lease, not a container spec.
   */
  accountWorker?: AccountWorkerSandboxHandle;
}): Promise<SandboxContext | null> {
  const resolved = resolveSandboxSession(params);
  if (!resolved) {
    return null;
  }
  if (isSharedTenantAddressingEnabled(params.config) && !params.account?.tenantId?.trim()) {
    throw new Error(
      "Managed multitenant sandbox requires a server-derived account (tenantId and userId).",
    );
  }
  const { rawSessionKey } = resolved;
  const cfg = params.account
    ? applyAccountSandboxConfig({
        cfg: resolved.cfg,
        config: params.config,
        account: params.account,
        agentId: resolved.runtime.agentId,
      })
    : resolved.cfg;

  if (params.account && isAccountWorkerPrototypeEnabled(params.config)) {
    if (!params.accountWorker) {
      throw new Error(
        "Account worker prototype is enabled; refusing to start this tenant sandbox from the gateway docker driver.",
      );
    }
    try {
      return await startSandboxedAccountWorker({
        cfg,
        rawSessionKey,
        agentId: resolved.runtime.agentId,
        account: params.account,
        handle: params.accountWorker,
        config: params.config,
      });
    } catch (error) {
      const decision = decideAccountWorkerDockerFailure(error);
      if (decision.action === "raise") {
        throw error;
      }
      publishAccountComputerFailure({
        tenantId: params.account.tenantId.trim(),
        userId: params.account.userId.trim(),
        failure: decision.failure,
      });
      defaultRuntime.error?.(decision.failure);
      if (decision.action === "host") {
        // No docker CLI and no engine socket. Keep the turn alive on the gateway
        // host instead of failing before a reply. Sandbox containers are not created.
        return null;
      }
      throw new Error(decision.failure, { cause: error });
    }
  }

  await maybePruneSandboxes(cfg);

  const { agentWorkspaceDir, scopeKey, workspaceDir } = await ensureSandboxWorkspaceLayout({
    cfg,
    rawSessionKey,
    config: params.config,
    workspaceDir: params.workspaceDir,
  });

  const docker = await resolveSandboxDockerUser({
    docker: cfg.docker,
    workspaceDir,
  });
  const resolvedCfg = docker === cfg.docker ? cfg : { ...cfg, docker };

  const containerName = await ensureSandboxContainer({
    sessionKey: rawSessionKey,
    workspaceDir,
    agentWorkspaceDir,
    cfg: resolvedCfg,
  });

  const evaluateEnabled =
    params.config?.browser?.evaluateEnabled ?? DEFAULT_BROWSER_EVALUATE_ENABLED;

  const bridgeAuth = cfg.browser.enabled
    ? await (async () => {
        // Sandbox browser bridge server runs on a loopback TCP port; always wire up
        // the same auth that loopback browser clients will send (token/password).
        const cfgForAuth = params.config ?? loadConfig();
        let browserAuth = resolveBrowserControlAuth(cfgForAuth);
        try {
          const ensured = await ensureBrowserControlAuth({ cfg: cfgForAuth });
          browserAuth = ensured.auth;
        } catch (error) {
          const message = error instanceof Error ? error.message : JSON.stringify(error);
          defaultRuntime.error?.(`Sandbox browser auth ensure failed: ${message}`);
        }
        return browserAuth;
      })()
    : undefined;
  const observerUserId = accountComputerObserverUserId(params.account?.userId);
  const browser = await ensureSandboxBrowser({
    scopeKey,
    workspaceDir,
    agentWorkspaceDir,
    cfg: resolvedCfg,
    evaluateEnabled,
    bridgeAuth,
    ...(params.account && observerUserId
      ? {
          observerAccount: {
            tenantId: params.account.tenantId.trim(),
            userId: observerUserId,
          },
        }
      : {}),
  });

  const sandboxContext: SandboxContext = {
    enabled: true,
    sessionKey: rawSessionKey,
    workspaceDir,
    agentWorkspaceDir,
    workspaceAccess: resolvedCfg.workspaceAccess,
    containerName,
    containerWorkdir: resolvedCfg.docker.workdir,
    docker: resolvedCfg.docker,
    tools: resolvedCfg.tools,
    browserAllowHostControl: resolvedCfg.browser.allowHostControl,
    browser: browser ?? undefined,
  };

  sandboxContext.fsBridge = createSandboxFsBridge({ sandbox: sandboxContext });

  return sandboxContext;
}

export async function ensureSandboxWorkspaceForSession(
  params: {
    config?: OpenBotConfig;
    sessionKey?: string;
    workspaceDir?: string;
    /** Server-derived account. Model and tool parameters must not supply this. */
    account?: { tenantId: string; userId: string };
  } & Omit<EmbeddedSandboxAccountInput, "config" | "agentId">,
): Promise<SandboxWorkspaceInfo | null> {
  const resolved = resolveSandboxSession(params);
  if (!resolved) {
    return null;
  }
  const account =
    params.account?.tenantId?.trim() && params.account.userId?.trim()
      ? { tenantId: params.account.tenantId.trim(), userId: params.account.userId.trim() }
      : resolveProductionSandboxAccount({
          config: params.config,
          agentId: resolved.runtime.agentId,
          gatewayClientUser: params.gatewayClientUser,
          gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
          gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId,
          executionIdentity: params.executionIdentity,
        });
  if (isSharedTenantAddressingEnabled(params.config) && !account?.tenantId?.trim()) {
    throw new Error(
      "Managed multitenant sandbox requires a server-derived account (tenantId and userId).",
    );
  }
  const cfg = account
    ? applyAccountSandboxConfig({
        cfg: resolved.cfg,
        config: params.config,
        account,
        agentId: resolved.runtime.agentId,
      })
    : resolved.cfg;
  const { workspaceDir } = await ensureSandboxWorkspaceLayout({
    cfg,
    rawSessionKey: resolved.rawSessionKey,
    config: params.config,
    workspaceDir: params.workspaceDir,
  });

  return {
    workspaceDir,
    containerWorkdir: cfg.docker.workdir,
  };
}
