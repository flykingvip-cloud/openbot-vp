import crypto from "node:crypto";
import {
  accountBrowserCdpPublishSpec,
  allocateAccountBrowserCdpPort,
  ensureColdAccountBrowserProfile,
  releaseAccountBrowserCdpPort,
} from "../../browser/account-browser-namespace.js";
import { startBrowserBridgeServer, stopBrowserBridgeServer } from "../../browser/bridge-server.js";
import { type ResolvedBrowserConfig, resolveProfile } from "../../browser/config.js";
import {
  DEFAULT_BROWSER_EVALUATE_ENABLED,
  DEFAULT_OPENCLAW_BROWSER_COLOR,
  DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME,
} from "../../browser/constants.js";
import { deriveDefaultBrowserCdpPortRange } from "../../config/port-defaults.js";
import { defaultRuntime } from "../../runtime.js";
import { publishAccountComputerObserver } from "./account-computer-stream.js";
import {
  ACCOUNT_BROWSER_CONTAINER_DIR,
  assertAccountMountsAllowed,
  collectDockerVolumeBinds,
  parseAccountDockerBind,
} from "./account-mounts.js";
import { accountComputerObserverUserId, resolveAccountBrowserScopeKey } from "./account-scope.js";
import { BROWSER_BRIDGES } from "./browser-bridges.js";
import { computeSandboxBrowserConfigHash } from "./config-hash.js";
import { resolveSandboxBrowserDockerCreateConfig } from "./config.js";
import { DEFAULT_SANDBOX_BROWSER_IMAGE, SANDBOX_BROWSER_SECURITY_HASH_EPOCH } from "./constants.js";
import {
  buildSandboxCreateArgs,
  dockerContainerState,
  execDocker,
  readDockerContainerEnvVar,
  readDockerContainerLabel,
  readDockerPort,
} from "./docker.js";
import {
  buildNoVncObserverTokenUrl,
  consumeNoVncObserverToken,
  generateNoVncPassword,
  isNoVncEnabled,
  NOVNC_PASSWORD_ENV_KEY,
  issueNoVncObserverToken,
} from "./novnc-auth.js";
import { readBrowserRegistry, updateBrowserRegistry } from "./registry.js";
import { resolveSandboxAgentId, slugifySessionKey } from "./shared.js";
import { isToolAllowed } from "./tool-policy.js";
import type { SandboxBrowserContext, SandboxConfig } from "./types.js";
import { validateNetworkMode } from "./validate-sandbox-security.js";
import { appendWorkspaceMountArgs } from "./workspace-mounts.js";

const HOT_BROWSER_WINDOW_MS = 5 * 60 * 1000;
const CDP_SOURCE_RANGE_ENV_KEY = "OPENCLAW_BROWSER_CDP_SOURCE_RANGE";

export async function waitForSandboxCdp(params: {
  cdpPort: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (params.signal?.aborted) {
    return false;
  }
  const deadline = Date.now() + Math.max(0, params.timeoutMs);
  const url = `http://127.0.0.1:${params.cdpPort}/json/version`;
  while (Date.now() < deadline) {
    if (params.signal?.aborted) {
      return false;
    }
    try {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      params.signal?.addEventListener("abort", onAbort, { once: true });
      const remaining = Math.max(1, deadline - Date.now());
      const t = setTimeout(() => ctrl.abort(), Math.min(1000, remaining));
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (res.ok) {
          return true;
        }
      } finally {
        clearTimeout(t);
        params.signal?.removeEventListener("abort", onAbort);
      }
    } catch {
      // ignore
    }
    if (params.signal?.aborted) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

export function buildSandboxBrowserResolvedConfig(params: {
  controlPort: number;
  cdpPort: number;
  headless: boolean;
  evaluateEnabled: boolean;
  /** Place pages above the Account Computer dock. Regular sandboxes leave this off. */
  accountComputerWorkArea?: boolean;
}): ResolvedBrowserConfig {
  const cdpHost = "127.0.0.1";
  const cdpPortRange = deriveDefaultBrowserCdpPortRange(params.controlPort);
  return {
    enabled: true,
    evaluateEnabled: params.evaluateEnabled,
    controlPort: params.controlPort,
    cdpProtocol: "http",
    cdpHost,
    cdpIsLoopback: true,
    cdpPortRangeStart: cdpPortRange.start,
    cdpPortRangeEnd: cdpPortRange.end,
    remoteCdpTimeoutMs: 1500,
    remoteCdpHandshakeTimeoutMs: 3000,
    color: DEFAULT_OPENCLAW_BROWSER_COLOR,
    executablePath: undefined,
    headless: params.headless,
    noSandbox: false,
    attachOnly: true,
    ...(params.accountComputerWorkArea ? { accountComputerWorkArea: true as const } : {}),
    defaultProfile: DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME,
    extraArgs: [],
    profiles: {
      [DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME]: {
        cdpPort: params.cdpPort,
        color: DEFAULT_OPENCLAW_BROWSER_COLOR,
      },
    },
  };
}

async function ensureSandboxBrowserImage(image: string) {
  const result = await execDocker(["image", "inspect", image], {
    allowFailure: true,
  });
  if (result.code === 0) {
    return;
  }
  throw new Error(
    `Sandbox browser image not found: ${image}. Build it with scripts/sandbox-browser-setup.sh.`,
  );
}

async function ensureDockerNetwork(
  network: string,
  opts?: { allowContainerNamespaceJoin?: boolean },
) {
  validateNetworkMode(network, {
    allowContainerNamespaceJoin: opts?.allowContainerNamespaceJoin === true,
  });
  const normalized = network.trim().toLowerCase();
  if (!normalized || normalized === "bridge" || normalized === "none") {
    return;
  }
  const inspect = await execDocker(["network", "inspect", network], { allowFailure: true });
  if (inspect.code === 0) {
    return;
  }
  await execDocker(["network", "create", "--driver", "bridge", network]);
}

export async function ensureSandboxBrowser(params: {
  scopeKey: string;
  workspaceDir: string;
  agentWorkspaceDir: string;
  cfg: SandboxConfig;
  evaluateEnabled?: boolean;
  bridgeAuth?: { token?: string; password?: string };
  /**
   * Publish this browser as the signed-in account's preview.
   * `userId` must be the platform user id, not the login email.
   * A live slot for the same tenant + user keeps the first noVNC port (no second service).
   * Each preview open mints its own observer token for that port.
   * Account mounts, CDP release, and the profile path stay on this same call.
   * This function does not start a second desktop.
   */
  observerAccount?: { tenantId: string; userId: string; agentLabel?: string };
}): Promise<SandboxBrowserContext | null> {
  if (!params.cfg.browser.enabled) {
    return null;
  }
  if (!isToolAllowed(params.cfg.tools, "browser")) {
    return null;
  }

  const accountBrowser =
    params.cfg.scope === "account" && params.cfg.account ? params.cfg.account : undefined;
  if (accountBrowser) {
    const profileBind = (params.cfg.accountBrowserBinds ?? []).find(
      (bind) => parseAccountDockerBind(bind).containerPath === ACCOUNT_BROWSER_CONTAINER_DIR,
    );
    const profileDir =
      params.cfg.accountMountGuard?.browserProfileDir ??
      (profileBind ? parseAccountDockerBind(profileBind).hostPath : undefined);
    if (profileDir) {
      await ensureColdAccountBrowserProfile(profileDir);
    }
  }
  const browserScopeKey = accountBrowser
    ? resolveAccountBrowserScopeKey(accountBrowser)
    : params.scopeKey;
  const slug = params.cfg.scope === "shared" ? "shared" : slugifySessionKey(browserScopeKey);
  const name = `${params.cfg.browser.containerPrefix}${slug}`;
  const containerName = name.slice(0, 63);
  const state = await dockerContainerState(containerName);
  const browserImage = params.cfg.browser.image ?? DEFAULT_SANDBOX_BROWSER_IMAGE;
  const cdpSourceRange = params.cfg.browser.cdpSourceRange?.trim() || undefined;
  const browserDockerCfg = {
    ...resolveSandboxBrowserDockerCreateConfig({
      docker: params.cfg.docker,
      browser: { ...params.cfg.browser, image: browserImage },
    }),
    ...(accountBrowser ? { binds: params.cfg.accountBrowserBinds } : {}),
  };
  const expectedHash = computeSandboxBrowserConfigHash({
    docker: browserDockerCfg,
    browser: {
      cdpPort: params.cfg.browser.cdpPort,
      vncPort: params.cfg.browser.vncPort,
      noVncPort: params.cfg.browser.noVncPort,
      headless: params.cfg.browser.headless,
      enableNoVnc: params.cfg.browser.enableNoVnc,
      cdpSourceRange,
    },
    securityEpoch: SANDBOX_BROWSER_SECURITY_HASH_EPOCH,
    workspaceAccess: params.cfg.workspaceAccess,
    workspaceDir: params.workspaceDir,
    agentWorkspaceDir: params.agentWorkspaceDir,
  });

  const now = Date.now();
  let hasContainer = state.exists;
  let running = state.running;
  let currentHash: string | null = null;
  let hashMismatch = false;
  const noVncEnabled = isNoVncEnabled(params.cfg.browser);
  let noVncPassword: string | undefined;

  if (hasContainer) {
    if (noVncEnabled) {
      noVncPassword =
        (await readDockerContainerEnvVar(containerName, NOVNC_PASSWORD_ENV_KEY)) ?? undefined;
    }
    const registry = await readBrowserRegistry();
    const registryEntry = registry.entries.find((entry) => entry.containerName === containerName);
    currentHash = await readDockerContainerLabel(containerName, "openclaw.configHash");
    hashMismatch = !currentHash || currentHash !== expectedHash;
    if (!currentHash) {
      currentHash = registryEntry?.configHash ?? null;
      hashMismatch = !currentHash || currentHash !== expectedHash;
    }
    if (hashMismatch) {
      const lastUsedAtMs = registryEntry?.lastUsedAtMs;
      const isHot =
        running && (typeof lastUsedAtMs !== "number" || now - lastUsedAtMs < HOT_BROWSER_WINDOW_MS);
      if (isHot) {
        const hint = (() => {
          if (params.cfg.scope === "session") {
            return `openbot sandbox recreate --browser --session ${params.scopeKey}`;
          }
          if (params.cfg.scope === "agent") {
            const agentId = resolveSandboxAgentId(params.scopeKey) ?? "main";
            return `openbot sandbox recreate --browser --agent ${agentId}`;
          }
          return "openbot sandbox recreate --browser --all";
        })();
        defaultRuntime.log(
          `Sandbox browser config changed for ${containerName} (recently used). Recreate to apply: ${hint}`,
        );
      } else {
        await execDocker(["rm", "-f", containerName], { allowFailure: true });
        if (accountBrowser) {
          releaseAccountBrowserCdpPort(browserScopeKey);
        }
        hasContainer = false;
        running = false;
      }
    }
  }

  if (!hasContainer) {
    if (noVncEnabled) {
      noVncPassword = generateNoVncPassword();
    }
    await ensureDockerNetwork(browserDockerCfg.network, {
      allowContainerNamespaceJoin: browserDockerCfg.dangerouslyAllowContainerNamespaceJoin === true,
    });
    await ensureSandboxBrowserImage(browserImage);
    const args = buildSandboxCreateArgs({
      name: containerName,
      cfg: browserDockerCfg,
      scopeKey: browserScopeKey,
      labels: {
        "openclaw.sandboxBrowser": "1",
        "openclaw.browserConfigEpoch": SANDBOX_BROWSER_SECURITY_HASH_EPOCH,
      },
      configHash: expectedHash,
      includeBinds: false,
      bindSourceRoots: accountBrowser
        ? (params.cfg.accountBrowserBinds ?? []).map(
            (bind) => parseAccountDockerBind(bind).hostPath,
          )
        : [params.workspaceDir, params.agentWorkspaceDir],
    });
    if (accountBrowser && params.cfg.accountBrowserBinds?.length) {
      for (const bind of params.cfg.accountBrowserBinds) {
        args.push("-v", bind);
      }
    } else {
      appendWorkspaceMountArgs({
        args,
        workspaceDir: params.workspaceDir,
        agentWorkspaceDir: params.agentWorkspaceDir,
        workdir: params.cfg.docker.workdir,
        workspaceAccess: params.cfg.workspaceAccess,
      });
      if (browserDockerCfg.binds?.length) {
        for (const bind of browserDockerCfg.binds) {
          args.push("-v", bind);
        }
      }
    }
    const guard = params.cfg.accountMountGuard;
    if (accountBrowser && guard) {
      assertAccountMountsAllowed({
        binds: collectDockerVolumeBinds(args),
        allow: guard.browserAllow,
        tenantsRoot: guard.tenantsRoot,
        userRoot: guard.userRoot,
        credentialDir: guard.credentialDir,
        configDir: guard.configDir,
        agentId: guard.agentId,
        dataRoot: guard.dataRoot,
      });
    }
    if (accountBrowser) {
      const hostPort = await allocateAccountBrowserCdpPort(browserScopeKey);
      args.push("-p", accountBrowserCdpPublishSpec(hostPort, params.cfg.browser.cdpPort));
      args.push("-e", `OPENBOT_BROWSER_USER_DATA_DIR=${ACCOUNT_BROWSER_CONTAINER_DIR}`);
      args.push("-e", `OPENCLAW_BROWSER_USER_DATA_DIR=${ACCOUNT_BROWSER_CONTAINER_DIR}`);
    } else {
      args.push("-p", `127.0.0.1::${params.cfg.browser.cdpPort}`);
    }
    if (noVncEnabled) {
      args.push("-p", `127.0.0.1::${params.cfg.browser.noVncPort}`);
    }
    args.push("-e", `OPENCLAW_BROWSER_HEADLESS=${params.cfg.browser.headless ? "1" : "0"}`);
    args.push("-e", `OPENCLAW_BROWSER_ENABLE_NOVNC=${params.cfg.browser.enableNoVnc ? "1" : "0"}`);
    args.push("-e", `OPENCLAW_BROWSER_CDP_PORT=${params.cfg.browser.cdpPort}`);
    if (cdpSourceRange) {
      args.push("-e", `${CDP_SOURCE_RANGE_ENV_KEY}=${cdpSourceRange}`);
    }
    args.push("-e", `OPENCLAW_BROWSER_VNC_PORT=${params.cfg.browser.vncPort}`);
    args.push("-e", `OPENCLAW_BROWSER_NOVNC_PORT=${params.cfg.browser.noVncPort}`);
    // Chromium's setuid/namespace sandbox cannot work inside Docker containers
    // (PID namespace creation requires privileges Docker does not grant by default).
    // The container itself provides isolation, so --no-sandbox is safe here.
    args.push("-e", "OPENCLAW_BROWSER_NO_SANDBOX=1");
    if (noVncEnabled && noVncPassword) {
      args.push("-e", `${NOVNC_PASSWORD_ENV_KEY}=${noVncPassword}`);
    }
    args.push(browserImage);
    try {
      await execDocker(args);
      await execDocker(["start", containerName]);
    } catch (err) {
      if (accountBrowser) {
        releaseAccountBrowserCdpPort(browserScopeKey);
      }
      throw err;
    }
  } else if (!running) {
    await execDocker(["start", containerName]);
  }

  const mappedCdp = await readDockerPort(containerName, params.cfg.browser.cdpPort);
  if (!mappedCdp) {
    throw new Error(`Failed to resolve CDP port mapping for ${containerName}.`);
  }

  const mappedNoVnc = noVncEnabled
    ? await readDockerPort(containerName, params.cfg.browser.noVncPort)
    : null;
  if (noVncEnabled && !noVncPassword) {
    noVncPassword =
      (await readDockerContainerEnvVar(containerName, NOVNC_PASSWORD_ENV_KEY)) ?? undefined;
  }

  const existing = BROWSER_BRIDGES.get(browserScopeKey);
  const existingProfile = existing
    ? resolveProfile(existing.bridge.state.resolved, DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME)
    : null;

  let desiredAuthToken = params.bridgeAuth?.token?.trim() || undefined;
  let desiredAuthPassword = params.bridgeAuth?.password?.trim() || undefined;
  if (!desiredAuthToken && !desiredAuthPassword) {
    // Always require auth for the sandbox bridge server, even if gateway auth
    // mode doesn't produce a shared secret (e.g. trusted-proxy).
    // Keep it stable across calls by reusing the existing bridge auth.
    desiredAuthToken = existing?.authToken;
    desiredAuthPassword = existing?.authPassword;
    if (!desiredAuthToken && !desiredAuthPassword) {
      desiredAuthToken = crypto.randomBytes(24).toString("hex");
    }
  }

  const shouldReuse =
    existing && existing.containerName === containerName && existingProfile?.cdpPort === mappedCdp;
  const authMatches =
    !existing ||
    (existing.authToken === desiredAuthToken && existing.authPassword === desiredAuthPassword);
  if (existing && !shouldReuse) {
    await stopBrowserBridgeServer(existing.bridge.server).catch(() => undefined);
    BROWSER_BRIDGES.delete(browserScopeKey);
  }
  if (existing && shouldReuse && !authMatches) {
    await stopBrowserBridgeServer(existing.bridge.server).catch(() => undefined);
    BROWSER_BRIDGES.delete(browserScopeKey);
  }

  const bridge = (() => {
    if (shouldReuse && authMatches && existing) {
      return existing.bridge;
    }
    return null;
  })();

  const ensureBridge = async () => {
    if (bridge) {
      return bridge;
    }

    const onEnsureAttachTarget = params.cfg.browser.autoStart
      ? async () => {
          const state = await dockerContainerState(containerName);
          if (state.exists && !state.running) {
            await execDocker(["start", containerName]);
          }
          const ok = await waitForSandboxCdp({
            cdpPort: mappedCdp,
            timeoutMs: params.cfg.browser.autoStartTimeoutMs,
          });
          if (!ok) {
            throw new Error(
              `Sandbox browser CDP did not become reachable on 127.0.0.1:${mappedCdp} within ${params.cfg.browser.autoStartTimeoutMs}ms.`,
            );
          }
        }
      : undefined;

    return await startBrowserBridgeServer({
      resolved: buildSandboxBrowserResolvedConfig({
        controlPort: 0,
        cdpPort: mappedCdp,
        headless: params.cfg.browser.headless,
        evaluateEnabled: params.evaluateEnabled ?? DEFAULT_BROWSER_EVALUATE_ENABLED,
      }),
      authToken: desiredAuthToken,
      authPassword: desiredAuthPassword,
      onEnsureAttachTarget,
      resolveSandboxNoVncToken: consumeNoVncObserverToken,
    });
  };

  const resolvedBridge = await ensureBridge();
  if (!shouldReuse || !authMatches) {
    BROWSER_BRIDGES.set(browserScopeKey, {
      bridge: resolvedBridge,
      containerName,
      authToken: desiredAuthToken,
      authPassword: desiredAuthPassword,
    });
  }

  await updateBrowserRegistry({
    containerName,
    sessionKey: params.scopeKey,
    createdAtMs: now,
    lastUsedAtMs: now,
    image: browserImage,
    configHash: hashMismatch && running ? (currentHash ?? undefined) : expectedHash,
    cdpPort: mappedCdp,
    noVncPort: mappedNoVnc ?? undefined,
  });

  const noVncUrl =
    mappedNoVnc && noVncEnabled
      ? (() => {
          const token = issueNoVncObserverToken({
            noVncPort: mappedNoVnc,
            password: noVncPassword,
          });
          return buildNoVncObserverTokenUrl(resolvedBridge.baseUrl, token);
        })()
      : undefined;

  const observerUserId = accountComputerObserverUserId(params.observerAccount?.userId);
  const observerTenantId = params.observerAccount?.tenantId.trim() ?? "";
  if (observerUserId && observerTenantId && mappedNoVnc && noVncEnabled) {
    const agentLabel = params.observerAccount?.agentLabel?.trim();
    publishAccountComputerObserver({
      tenantId: observerTenantId,
      userId: observerUserId,
      ...(agentLabel && !agentLabel.includes("@") ? { agentLabel } : {}),
      noVncPort: mappedNoVnc,
      password: noVncPassword,
      bridgeBaseUrl: resolvedBridge.baseUrl,
      scopeKey: browserScopeKey,
      containerName,
      status: "READY",
    });
  }

  return {
    bridgeUrl: resolvedBridge.baseUrl,
    noVncUrl,
    containerName,
  };
}
