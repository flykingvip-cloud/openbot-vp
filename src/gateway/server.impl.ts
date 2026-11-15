import path from "node:path";
import {
  recoverAsyncWaitJobsAtGatewayBoot,
  createAsyncWaitRecoveryContinueEnqueue,
  setAsyncWaitRecoveryFollowupConsumerEnsure,
  ensureAsyncWaitRecoveryFollowupConsumer,
  setAsyncWaitRecoveryContinueEnqueue,
} from "../agent-runtime/state/index.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { maybeProvisionBuiltinStewardAtStartup } from "../agents/builtin-steward/provision.js";
import { getActiveEmbeddedRunCount } from "../agents/pi-embedded-runner/runs.js";
import { registerSkillsChangeListener } from "../agents/skills/refresh.js";
import { initSubagentRegistry } from "../agents/subagent-registry.js";
import { getTotalPendingReplies } from "../auto-reply/reply/dispatcher-registry.js";
import type { CanvasHostServer } from "../canvas-host/server.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import { formatCliCommand } from "../cli/command-format.js";
import { createDefaultDeps } from "../cli/deps.js";
import { isRestartEnabled } from "../config/commands.js";
import {
  CONFIG_PATH,
  type OpenBotConfig,
  isNixMode,
  loadConfig,
  migrateLegacyConfig,
  readConfigFileSnapshot,
  writeConfigFile,
} from "../config/config.js";
import { formatConfigIssueLines } from "../config/issue-format.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { startConversationEvaluation } from "../conversation-evaluation/index.js";
import { shutdownShadowHook } from "../conversation-task/gateway-shadow-hook.js";
import { initShadowHookFromServerConfig } from "../conversation-task/runtime-bootstrap.js";
import { resolveConversationFlags } from "../conversations/flags.js";
import { ensureConversationRetentionCronJob } from "../conversations/retention-cron.js";
import { createFabricAuditStore } from "../fabric/audit-store.js";
import { formatFabricAuditLine } from "../fabric/audit.js";
import { isFabricEnabled } from "../fabric/feature.js";
import { createLoopbackToolInvoker } from "../fabric/loopback-invoker.js";
import { createGatewayFabricService } from "../fabric/wiring.js";
import { clearAgentRunContext, onAgentEvent } from "../infra/agent-events.js";
import {
  ensureControlUiAssetsBuilt,
  isPackageProvenControlUiRootSync,
  resolveControlUiRootOverrideSync,
  resolveControlUiRootSync,
} from "../infra/control-ui-assets.js";
import { isDiagnosticsEnabled } from "../infra/diagnostic-events.js";
import { logAcceptedEnvOption } from "../infra/env.js";
import { createExecApprovalForwarder } from "../infra/exec-approval-forwarder.js";
import { onHeartbeatEvent } from "../infra/heartbeat-events.js";
import { startHeartbeatRunner, type HeartbeatRunner } from "../infra/heartbeat-runner.js";
import { resolveEffectiveHomeDir } from "../infra/home-dir.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import { ensureOpenClawCliOnPath } from "../infra/path-env.js";
import { setGatewaySigusr1RestartPolicy, setPreRestartDeferralCheck } from "../infra/restart.js";
import {
  primeRemoteSkillsCache,
  refreshRemoteBinsForConnectedNodes,
  setSkillsRemoteRegistry,
} from "../infra/skills-remote.js";
import { scheduleGatewayUpdateCheck } from "../infra/update-startup.js";
import {
  LOCAL_FILES_APPROVAL_REQUESTED_EVENT,
  LOCAL_FILES_APPROVAL_RESOLVED_EVENT,
} from "../local-files/events.js";
import { startDiagnosticHeartbeat, stopDiagnosticHeartbeat } from "../logging/diagnostic.js";
import { createSubsystemLogger, runtimeForLogger } from "../logging/subsystem.js";
import { resolveConfiguredHeartbeatPeriodMs } from "../observation/heartbeat-activity.js";
import { createHeartbeatActivityLifecycle } from "../observation/heartbeat-activity-lifecycle.js";
import { createObservationQueryHandlers } from "../observation/query-gateway.js";
import { createObservationReasoningOptions } from "../observation/reasoning-model-resolver.js";
import { getGlobalHookRunner, runGlobalGatewayStopSafely } from "../plugins/hook-runner-global.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { createPluginRuntime } from "../plugins/runtime/index.js";
import type { PluginServicesHandle } from "../plugins/services.js";
import { getTotalQueueSize } from "../process/command-queue.js";
import type { RuntimeEnv } from "../runtime.js";
import type { CommandSecretAssignment } from "../secrets/command-config.js";
import {
  activateSecretsRuntimeSnapshot,
  clearSecretsRuntimeSnapshot,
  getActiveSecretsRuntimeSnapshot,
  resolveCommandSecretsFromActiveRuntimeSnapshot,
} from "../secrets/runtime.js";
import { recoverTaskOutcomeConsumersAtGatewayBoot } from "../task-outcome/consumer-boot.js";
import { setVaultSyncRevisionEventSink, VAULT_SYNC_REVISIONS_EVENT } from "../vault-sync/index.js";
import { runOnboardingWizard } from "../wizard/onboarding.js";
import { registerGrowthEventBroadcast } from "./agent-growth/growth-events.js";
import { maybeSeedAgentRuntimeFromPlatformState } from "./agent-runtime-seed.js";
import { startChannelHealthMonitor } from "./channel-health-monitor.js";
import { createBroadcastChatEvent } from "./chat-event-isolation.js";
import type { GroupTaskHeartbeatScheduler } from "./collaboration-dispatch/group-task-heartbeat-scheduler.js";
import { startGatewayConfigReloader } from "./config-reload.js";
import type { ControlUiRootState } from "./control-ui.js";
import {
  GATEWAY_EVENT_UPDATE_AVAILABLE,
  type GatewayUpdateAvailableEventPayload,
} from "./events.js";
import { resolveExecApprovalJournalPath } from "./exec-approval-journal.js";
import { ExecApprovalManager } from "./exec-approval-manager.js";
import {
  AccountSpawnHandoffStore,
  resolveAccountSpawnHandoffPath,
} from "./governance/account-spawn-handoff.js";
import {
  configureAccountSpawnHandoffStore,
  recoverAccountSpawnHandoffs,
} from "./governance/spawn-snapshot-handoff.js";
import { startGatewayGroupTaskHeartbeatScheduler } from "./group-task-heartbeat-scheduler-boot.js";
import { recoverPendingHandoffTxnsAtGatewayBoot } from "./handoff-recovery-boot.js";
import { LocalFileApprovalService } from "./local-files/approval.js";
import { createNodeInvokePort } from "./local-files/node-port.js";
import { configureLocalFilesRuntime } from "./local-files/runtime.js";
import { loadLoomAttributionSource } from "./loom-attribution-source.js";
import { NodeRegistry } from "./node-registry.js";
import {
  assertSecurityProfileAllowsStartup,
  toSecurityProfileStartupAudit,
} from "./security-profile.js";
import {
  logSecurityProfileStartup,
  validateSecurityProfileStartup,
} from "./security-profile/index.js";
import {
  applyGatewayAuthOverridesForStartupPreflight,
  createGatewayAuthRateLimiters,
} from "./server-auth-runtime.js";
import type { startBrowserControlServerIfEnabled } from "./server-browser.js";
import { createChannelManager } from "./server-channels.js";
import { createAgentEventHandler } from "./server-chat.js";
import { createGatewayCloseHandler } from "./server-close.js";
import { buildGatewayCronService } from "./server-cron.js";
import { startGatewayDiscovery } from "./server-discovery-runtime.js";
import { applyGatewayLaneConcurrency } from "./server-lanes.js";
import { startGatewayMaintenanceTimers } from "./server-maintenance.js";
import { resolveMediaCleanupTtlMs } from "./server-media-ttl.js";
import { GATEWAY_EVENTS, listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers } from "./server-methods.js";
import { createExecApprovalHandlers } from "./server-methods/exec-approval.js";
import { setFabricAuditStoreProvider, setFabricServiceProvider } from "./server-methods/fabric.js";
import { safeParseJson } from "./server-methods/nodes.helpers.js";
import { createSecretsHandlers } from "./server-methods/secrets.js";
import { setSupervisorPortsProvider } from "./server-methods/supervisor.js";
import { hasConnectedMobileNode } from "./server-mobile-nodes.js";
import { loadGatewayModelCatalog } from "./server-model-catalog.js";
import { createNodeSubscriptionManager } from "./server-node-subscriptions.js";
import { loadGatewayPlugins, createFallbackGatewayContextHolder } from "./server-plugins.js";
import { createGatewayReloadHandlers } from "./server-reload-handlers.js";
import { resolveGatewayRuntimeConfig } from "./server-runtime-config.js";
import { createGatewayRuntimeState } from "./server-runtime-state.js";
import { createSecretsActivationCoordinator } from "./server-secrets-activation.js";
import { resolveSessionKeyForRun } from "./server-session-key.js";
import { logGatewayStartup } from "./server-startup-log.js";
import { startGatewaySidecars } from "./server-startup.js";
import { startGatewayTailscaleExposure } from "./server-tailscale.js";
import { createWizardSessionTracker } from "./server-wizard-sessions.js";
import { attachGatewayWsHandlers } from "./server-ws-runtime.js";
import {
  getHealthCache,
  getHealthVersion,
  getPresenceVersion,
  incrementPresenceVersion,
  refreshGatewayHealthSnapshot,
} from "./server/health-state.js";
import { createReadinessChecker } from "./server/readiness.js";
import { loadGatewayTlsRuntime } from "./server/tls.js";
import { ensureSkillExecutionBindingHooksRegistered } from "./skill-execution-binding/index.js";
import { ensureGatewayStartupAuth } from "./startup-auth.js";
import { maybeSeedControlUiAllowedOriginsAtStartup } from "./startup-control-ui-origins.js";
import {
  getSupervisorTaskEventRecipients,
  setSupervisorTaskEventSink,
} from "./supervisor/events.js";
import { resolveSupervisorPorts, startSupervisorRuntime } from "./supervisor/wiring.js";
import { bindWechatPersonalNodeRegistry } from "./user-operational-identity-wechat/worker.js";

export { __resetModelCatalogCacheForTest } from "./server-model-catalog.js";

ensureOpenClawCliOnPath();

const log = createSubsystemLogger("gateway");
const logCanvas = log.child("canvas");
const logDiscovery = log.child("discovery");
const logTailscale = log.child("tailscale");
const logChannels = log.child("channels");
const logBrowser = log.child("browser");
const logHealth = log.child("health");
const logCron = log.child("cron");
const logReload = log.child("reload");
const logHooks = log.child("hooks");
const logPlugins = log.child("plugins");
const logWsControl = log.child("ws");
const logSecrets = log.child("secrets");
const gatewayRuntime = runtimeForLogger(log);
const canvasRuntime = runtimeForLogger(logCanvas);

export type GatewayServer = {
  close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
};

export type GatewayServerOptions = {
  /**
   * Bind address policy for the Gateway WebSocket/HTTP server.
   * - loopback: 127.0.0.1
   * - lan: 0.0.0.0
   * - tailnet: bind only to the Tailscale IPv4 address (100.64.0.0/10)
   * - auto: prefer loopback, else LAN
   */
  bind?: import("../config/config.js").GatewayBindMode;
  /**
   * Advanced override for the bind host, bypassing bind resolution.
   * Prefer `bind` unless you really need a specific address.
   */
  host?: string;
  /**
   * If false, do not serve the browser Control UI.
   * Default: config `gateway.controlUi.enabled` (or true when absent).
   */
  controlUiEnabled?: boolean;
  /**
   * If false, do not serve `POST /v1/chat/completions`.
   * Default: config `gateway.http.endpoints.chatCompletions.enabled` (or false when absent).
   */
  openAiChatCompletionsEnabled?: boolean;
  /**
   * If false, do not serve `POST /v1/responses` (OpenResponses API).
   * Default: config `gateway.http.endpoints.responses.enabled` (or false when absent).
   */
  openResponsesEnabled?: boolean;
  /**
   * Override gateway auth configuration (merges with config).
   */
  auth?: import("../config/config.js").GatewayAuthConfig;
  /**
   * Override gateway Tailscale exposure configuration (merges with config).
   */
  tailscale?: import("../config/config.js").GatewayTailscaleConfig;
  /**
   * Test-only: allow canvas host startup even when NODE_ENV/VITEST would disable it.
   */
  allowCanvasHostInTests?: boolean;
  /**
   * Test-only: override the onboarding wizard runner.
   */
  wizardRunner?: (
    opts: import("../commands/onboard-types.js").OnboardOptions,
    runtime: import("../runtime.js").RuntimeEnv,
    prompter: import("../wizard/prompts.js").WizardPrompter,
  ) => Promise<void>;
};

export async function startGatewayServer(
  port = 18789,
  opts: GatewayServerOptions = {},
): Promise<GatewayServer> {
  const minimalTestGateway =
    process.env.VITEST === "1" && process.env.OPENCLAW_TEST_MINIMAL_GATEWAY === "1";

  // Ensure all default port derivations (browser/canvas) see the actual runtime port.
  process.env.OPENCLAW_GATEWAY_PORT = String(port);
  logAcceptedEnvOption({
    key: "OPENCLAW_RAW_STREAM",
    description: "raw stream logging enabled",
  });
  logAcceptedEnvOption({
    key: "OPENCLAW_RAW_STREAM_PATH",
    description: "raw stream log path override",
  });

  let configSnapshot = await readConfigFileSnapshot();
  if (configSnapshot.legacyIssues.length > 0) {
    if (isNixMode) {
      throw new Error(
        "Legacy config entries detected while running in Nix mode. Update your Nix config to the latest schema and restart.",
      );
    }
    const { config: migrated, changes } = migrateLegacyConfig(configSnapshot.parsed);
    if (!migrated) {
      log.warn(
        "gateway: legacy config entries detected but no auto-migration changes were produced; continuing with validation.",
      );
    } else {
      await writeConfigFile(migrated);
      if (changes.length > 0) {
        log.info(
          `gateway: migrated legacy config entries:\n${changes
            .map((entry) => `- ${entry}`)
            .join("\n")}`,
        );
      }
    }
  }

  configSnapshot = await readConfigFileSnapshot();
  if (configSnapshot.exists && !configSnapshot.valid) {
    const issues =
      configSnapshot.issues.length > 0
        ? formatConfigIssueLines(configSnapshot.issues, "", { normalizeRoot: true }).join("\n")
        : "Unknown validation issue.";
    throw new Error(
      `Invalid config at ${configSnapshot.path}.\n${issues}\nRun "${formatCliCommand("openbot doctor")}" to repair, then retry.`,
    );
  }

  const autoEnable = applyPluginAutoEnable({ config: configSnapshot.config, env: process.env });
  if (autoEnable.changes.length > 0) {
    try {
      await writeConfigFile(autoEnable.config);
      log.info(
        `gateway: auto-enabled plugins:\n${autoEnable.changes
          .map((entry) => `- ${entry}`)
          .join("\n")}`,
      );
    } catch (err) {
      log.warn(`gateway: failed to persist plugin auto-enable changes: ${String(err)}`);
    }
  }

  const secretsActivation = createSecretsActivationCoordinator({ logSecrets });
  const activateRuntimeSecrets = (
    config: OpenBotConfig,
    params: { reason: "startup" | "reload" | "restart-check"; activate: boolean },
  ) => secretsActivation.activate(config, params);

  // Fail fast before startup if required refs are unresolved.
  let cfgAtStart: OpenBotConfig;
  {
    const freshSnapshot = await readConfigFileSnapshot();
    if (!freshSnapshot.valid) {
      const issues =
        freshSnapshot.issues.length > 0
          ? formatConfigIssueLines(freshSnapshot.issues, "", { normalizeRoot: true }).join("\n")
          : "Unknown validation issue.";
      throw new Error(`Invalid config at ${freshSnapshot.path}.\n${issues}`);
    }
    const startupPreflightConfig = applyGatewayAuthOverridesForStartupPreflight(
      freshSnapshot.config,
      {
        auth: opts.auth,
        tailscale: opts.tailscale,
      },
    );
    await activateRuntimeSecrets(startupPreflightConfig, {
      reason: "startup",
      activate: false,
    });
  }

  cfgAtStart = loadConfig();
  // Gate 0: fail closed before serving traffic when Managed Enterprise
  // isolation requirements are not met. Minimal test gateways skip this so
  // unit harnesses remain hermetic; production CLI path always enforces.
  if (!minimalTestGateway) {
    const securityProfile = assertSecurityProfileAllowsStartup(cfgAtStart, process.env);
    log.info("gateway: security profile validated", {
      securityProfile: toSecurityProfileStartupAudit(securityProfile),
    });
  }
  const authBootstrap = await ensureGatewayStartupAuth({
    cfg: cfgAtStart,
    env: process.env,
    authOverride: opts.auth,
    tailscaleOverride: opts.tailscale,
    persist: true,
  });
  cfgAtStart = authBootstrap.cfg;
  if (authBootstrap.generatedToken) {
    if (authBootstrap.persistedGeneratedToken) {
      log.info(
        "Gateway auth token was missing. Generated a new token and saved it to config (gateway.auth.token).",
      );
    } else {
      log.warn(
        "Gateway auth token was missing. Generated a runtime token for this startup without changing config; restart will generate a different token. Persist one with `openbot config set gateway.auth.mode token` and `openbot config set gateway.auth.token <token>`.",
      );
    }
  }
  cfgAtStart = (
    await activateRuntimeSecrets(cfgAtStart, {
      reason: "startup",
      activate: true,
    })
  ).config;
  const diagnosticsEnabled = isDiagnosticsEnabled(cfgAtStart);
  if (diagnosticsEnabled) {
    startDiagnosticHeartbeat();
  }
  setGatewaySigusr1RestartPolicy({ allowExternal: isRestartEnabled(cfgAtStart) });
  setPreRestartDeferralCheck(
    () => getTotalQueueSize() + getTotalPendingReplies() + getActiveEmbeddedRunCount(),
  );
  // Unconditional startup migration: seed gateway.controlUi.allowedOrigins for existing
  // non-loopback installs that upgraded to v2026.2.26+ without required origins.
  cfgAtStart = await maybeSeedControlUiAllowedOriginsAtStartup({
    config: cfgAtStart,
    writeConfig: writeConfigFile,
    log,
  });

  // Unconditional startup provisioning: ensure existing installs also carry the builtin
  // steward (大白管家) agent entry. Idempotent; persists once only when the list changes.
  cfgAtStart = await maybeProvisionBuiltinStewardAtStartup({
    config: cfgAtStart,
    writeConfig: writeConfigFile,
    log,
  });
  const securityProfileStartup = validateSecurityProfileStartup({
    cfg: cfgAtStart,
    env: process.env,
  });
  logSecurityProfileStartup({ audit: securityProfileStartup.audit, log });
  initSubagentRegistry();
  const defaultAgentId = resolveDefaultAgentId(cfgAtStart);
  const defaultWorkspaceDir = resolveAgentWorkspaceDir(cfgAtStart, defaultAgentId);
  const baseMethods = listGatewayMethods();
  const emptyPluginRegistry = createEmptyPluginRegistry();
  // Per-startup holder for the fallback gateway context. Channel adapters
  // (Telegram polling, etc.) capture this via the plugin subagent runtime
  // so non-WS dispatch paths can still resolve a context. The holder is
  // owned by this gateway instance, so a process can run multiple gateway
  // lifecycles (tests, restarts) without leaking context across them.
  const fallbackGatewayContextHolder = createFallbackGatewayContextHolder();
  const { pluginRegistry, gatewayMethods: baseGatewayMethods } = minimalTestGateway
    ? { pluginRegistry: emptyPluginRegistry, gatewayMethods: baseMethods }
    : loadGatewayPlugins({
        cfg: cfgAtStart,
        workspaceDir: defaultWorkspaceDir,
        log,
        coreGatewayHandlers,
        baseMethods,
        fallbackContextHolder: fallbackGatewayContextHolder,
      });
  const channelLogs = Object.fromEntries(
    listChannelPlugins().map((plugin) => [plugin.id, logChannels.child(plugin.id)]),
  ) as Record<ChannelId, ReturnType<typeof createSubsystemLogger>>;
  const channelRuntimeEnvs = Object.fromEntries(
    Object.entries(channelLogs).map(([id, logger]) => [id, runtimeForLogger(logger)]),
  ) as Record<ChannelId, RuntimeEnv>;
  const channelMethods = listChannelPlugins().flatMap((plugin) => plugin.gatewayMethods ?? []);
  const gatewayMethods = Array.from(new Set([...baseGatewayMethods, ...channelMethods]));
  let pluginServices: PluginServicesHandle | null = null;
  const runtimeConfig = await resolveGatewayRuntimeConfig({
    cfg: cfgAtStart,
    port,
    bind: opts.bind,
    host: opts.host,
    controlUiEnabled: opts.controlUiEnabled,
    openAiChatCompletionsEnabled: opts.openAiChatCompletionsEnabled,
    openResponsesEnabled: opts.openResponsesEnabled,
    auth: opts.auth,
    tailscale: opts.tailscale,
  });
  const {
    bindHost,
    controlUiEnabled,
    openAiChatCompletionsEnabled,
    openAiChatCompletionsConfig,
    openResponsesEnabled,
    openResponsesConfig,
    strictTransportSecurityHeader,
    controlUiBasePath,
    controlUiRoot: controlUiRootOverride,
    resolvedAuth,
    tailscaleConfig,
    tailscaleMode,
  } = runtimeConfig;
  await maybeSeedAgentRuntimeFromPlatformState({
    cfg: cfgAtStart,
    trustedProxy: resolvedAuth?.trustedProxy,
    log,
  }).catch((err) => {
    log.warn(`agent-runtime seed skipped: ${String(err)}`);
  });
  let hooksConfig = runtimeConfig.hooksConfig;
  const canvasHostEnabled = runtimeConfig.canvasHostEnabled;

  // Create auth rate limiters used by connect/auth flows.
  const rateLimitConfig = cfgAtStart.gateway?.auth?.rateLimit;
  const { rateLimiter: authRateLimiter, browserRateLimiter: browserAuthRateLimiter } =
    createGatewayAuthRateLimiters(rateLimitConfig);

  let controlUiRootState: ControlUiRootState | undefined;
  if (controlUiRootOverride) {
    const resolvedOverride = resolveControlUiRootOverrideSync(controlUiRootOverride);
    const resolvedOverridePath = path.resolve(controlUiRootOverride);
    controlUiRootState = resolvedOverride
      ? { kind: "resolved", path: resolvedOverride }
      : { kind: "invalid", path: resolvedOverridePath };
    if (!resolvedOverride) {
      log.warn(`gateway: controlUi.root not found at ${resolvedOverridePath}`);
    }
  } else if (controlUiEnabled) {
    let resolvedRoot = resolveControlUiRootSync({
      moduleUrl: import.meta.url,
      argv1: process.argv[1],
      cwd: process.cwd(),
    });
    if (!resolvedRoot) {
      const ensureResult = await ensureControlUiAssetsBuilt(gatewayRuntime);
      if (!ensureResult.ok && ensureResult.message) {
        log.warn(`gateway: ${ensureResult.message}`);
      }
      resolvedRoot = resolveControlUiRootSync({
        moduleUrl: import.meta.url,
        argv1: process.argv[1],
        cwd: process.cwd(),
      });
    }
    controlUiRootState = resolvedRoot
      ? {
          kind: isPackageProvenControlUiRootSync(resolvedRoot, {
            moduleUrl: import.meta.url,
            argv1: process.argv[1],
            cwd: process.cwd(),
          })
            ? "bundled"
            : "resolved",
          path: resolvedRoot,
        }
      : { kind: "missing" };
  }

  const wizardRunner = opts.wizardRunner ?? runOnboardingWizard;
  const { wizardSessions, findRunningWizard, purgeWizardSession } = createWizardSessionTracker();

  const deps = createDefaultDeps();
  let canvasHostServer: CanvasHostServer | null = null;
  const gatewayTls = await loadGatewayTlsRuntime(cfgAtStart.gateway?.tls, log.child("tls"));
  if (cfgAtStart.gateway?.tls?.enabled && !gatewayTls.enabled) {
    throw new Error(gatewayTls.error ?? "gateway tls: failed to enable");
  }
  const serverStartedAt = Date.now();
  const channelManager = createChannelManager({
    loadConfig,
    channelLogs,
    channelRuntimeEnvs,
    channelRuntime: createPluginRuntime().channel,
  });
  const getReadiness = createReadinessChecker({
    channelManager,
    startedAt: serverStartedAt,
  });
  const {
    canvasHost,
    httpServer,
    httpServers,
    httpBindHosts,
    wss,
    clients,
    broadcast,
    broadcastToConnIds,
    agentRunSeq,
    dedupe,
    chatRunState,
    chatRunBuffers,
    chatDeltaSentAt,
    addChatRun,
    removeChatRun,
    chatAbortControllers,
    toolEventRecipients,
  } = await createGatewayRuntimeState({
    cfg: cfgAtStart,
    bindHost,
    port,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot: controlUiRootState,
    openAiChatCompletionsEnabled,
    openAiChatCompletionsConfig,
    openResponsesEnabled,
    openResponsesConfig,
    strictTransportSecurityHeader,
    resolvedAuth,
    rateLimiter: authRateLimiter,
    gatewayTls,
    hooksConfig: () => hooksConfig,
    pluginRegistry,
    deps,
    canvasRuntime,
    canvasHostEnabled,
    allowCanvasHostInTests: opts.allowCanvasHostInTests,
    logCanvas,
    log,
    logHooks,
    logPlugins,
    getReadiness,
  });
  let bonjourStop: (() => Promise<void>) | null = null;
  const nodeRegistry = new NodeRegistry();
  bindWechatPersonalNodeRegistry(nodeRegistry);
  const nodePresenceTimers = new Map<string, ReturnType<typeof setInterval>>();
  const nodeSubscriptions = createNodeSubscriptionManager();
  const nodeSendEvent = (opts: { nodeId: string; event: string; payloadJSON?: string | null }) => {
    const payload = safeParseJson(opts.payloadJSON ?? null);
    nodeRegistry.sendEvent(opts.nodeId, opts.event, payload);
  };
  const nodeSendToSession = (sessionKey: string, event: string, payload: unknown) =>
    nodeSubscriptions.sendToSession(sessionKey, event, payload, nodeSendEvent);
  const nodeSendToAllSubscribed = (event: string, payload: unknown) =>
    nodeSubscriptions.sendToAllSubscribed(event, payload, nodeSendEvent);
  const nodeSubscribe = nodeSubscriptions.subscribe;
  const nodeUnsubscribe = nodeSubscriptions.unsubscribe;
  const nodeUnsubscribeAll = nodeSubscriptions.unsubscribeAll;
  const broadcastVoiceWakeChanged = (triggers: string[]) => {
    broadcast("voicewake.changed", { triggers }, { dropIfSlow: true });
  };
  const hasMobileNodeConnected = () => hasConnectedMobileNode(nodeRegistry);
  applyGatewayLaneConcurrency(cfgAtStart);

  let cronState = buildGatewayCronService({
    cfg: cfgAtStart,
    deps,
    broadcast,
  });
  let { cron, storePath: cronStorePath } = cronState;

  const { getRuntimeSnapshot, startChannels, startChannel, stopChannel, markChannelLoggedOut } =
    channelManager;

  if (!minimalTestGateway) {
    const machineDisplayName = await getMachineDisplayName();
    const discovery = await startGatewayDiscovery({
      machineDisplayName,
      port,
      gatewayTls: gatewayTls.enabled
        ? { enabled: true, fingerprintSha256: gatewayTls.fingerprintSha256 }
        : undefined,
      wideAreaDiscoveryEnabled: cfgAtStart.discovery?.wideArea?.enabled === true,
      wideAreaDiscoveryDomain: cfgAtStart.discovery?.wideArea?.domain,
      tailscaleMode,
      mdnsMode: cfgAtStart.discovery?.mdns?.mode,
      logDiscovery,
    });
    bonjourStop = discovery.bonjourStop;
  }

  if (!minimalTestGateway) {
    setSkillsRemoteRegistry(nodeRegistry);
    void primeRemoteSkillsCache();
  }
  // Debounce skills-triggered node probes to avoid feedback loops and rapid-fire invokes.
  // Skills changes can happen in bursts (e.g., file watcher events), and each probe
  // takes time to complete. A 30-second delay ensures we batch changes together.
  let skillsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const skillsRefreshDelayMs = 30_000;
  const skillsChangeUnsub = minimalTestGateway
    ? () => {}
    : registerSkillsChangeListener((event) => {
        if (event.reason === "remote-node") {
          return;
        }
        if (skillsRefreshTimer) {
          clearTimeout(skillsRefreshTimer);
        }
        skillsRefreshTimer = setTimeout(() => {
          skillsRefreshTimer = null;
          const latest = loadConfig();
          void refreshRemoteBinsForConnectedNodes(latest);
        }, skillsRefreshDelayMs);
      });

  if (!minimalTestGateway) {
    ensureSkillExecutionBindingHooksRegistered();
  }

  const noopInterval = () => setInterval(() => {}, 1 << 30);
  let tickInterval = noopInterval();
  let healthInterval = noopInterval();
  let dedupeCleanup = noopInterval();
  let mediaCleanup: ReturnType<typeof setInterval> | null = null;
  const broadcastChat = createBroadcastChatEvent({
    clients,
    broadcastToConnIds,
  });
  if (!minimalTestGateway) {
    // These placeholders are replaced below; release them before losing their handles.
    clearInterval(tickInterval);
    clearInterval(healthInterval);
    clearInterval(dedupeCleanup);
    ({ tickInterval, healthInterval, dedupeCleanup, mediaCleanup } = startGatewayMaintenanceTimers({
      broadcast,
      broadcastChat,
      nodeSendToAllSubscribed,
      getPresenceVersion,
      getHealthVersion,
      refreshGatewayHealthSnapshot,
      logHealth,
      dedupe,
      chatAbortControllers,
      chatRunState,
      chatRunBuffers,
      chatDeltaSentAt,
      removeChatRun,
      agentRunSeq,
      nodeSendToSession,
      ...(typeof cfgAtStart.media?.ttlHours === "number"
        ? { mediaCleanupTtlMs: resolveMediaCleanupTtlMs(cfgAtStart.media.ttlHours) }
        : {}),
    }));
  }

  const agentUnsub = minimalTestGateway
    ? null
    : onAgentEvent(
        createAgentEventHandler({
          broadcast,
          broadcastChat,
          broadcastToConnIds,
          nodeSendToSession,
          agentRunSeq,
          chatRunState,
          chatAbortControllers,
          resolveSessionKeyForRun,
          clearAgentRunContext,
          toolEventRecipients,
        }),
      );

  // M0 conversation evaluation is off unless OPENBOT_CONVERSATION_EVALUATION=1.
  // The disabled handle does not subscribe and does not write.
  const conversationEvaluation = minimalTestGateway ? null : startConversationEvaluation();

  const heartbeatActivity = createHeartbeatActivityLifecycle({
    minimalTestGateway,
    subscribeBroadcast: () =>
      onHeartbeatEvent((evt) => {
        broadcast("heartbeat", evt, { dropIfSlow: true });
      }),
    resolveExpectedPeriodMs: () => resolveConfiguredHeartbeatPeriodMs(loadConfig()),
  });

  let heartbeatRunner: HeartbeatRunner = minimalTestGateway
    ? {
        stop: () => {},
        updateConfig: () => {},
      }
    : startHeartbeatRunner({ cfg: cfgAtStart });

  // S4: group-task-heartbeat background scheduler (default schedulerEnabled=false → dormant).
  // Observe-first; real nudge/escalate only when tip enables emit + wake gray.
  const groupTaskHeartbeatScheduler: GroupTaskHeartbeatScheduler | null = minimalTestGateway
    ? null
    : startGatewayGroupTaskHeartbeatScheduler({ cfg: cfgAtStart });

  const healthCheckMinutes = cfgAtStart.gateway?.channelHealthCheckMinutes;
  const healthCheckDisabled = healthCheckMinutes === 0;
  let channelHealthMonitor = healthCheckDisabled
    ? null
    : startChannelHealthMonitor({
        channelManager,
        checkIntervalMs: (healthCheckMinutes ?? 5) * 60_000,
      });

  if (!minimalTestGateway) {
    void cron
      .start()
      .then(async () => {
        const flags = resolveConversationFlags(cfgAtStart);
        if (!flags.catalogEnabled) {
          return;
        }
        await ensureConversationRetentionCronJob({
          cron,
          enabled: true,
        });
      })
      .catch((err) => logCron.error(`failed to start: ${String(err)}`));
  }

  // Recover pending outbound deliveries from previous crash/restart.
  if (!minimalTestGateway) {
    void (async () => {
      const { deliverOutboundPayloads } = await import("../infra/outbound/deliver.js");
      const { recoverAcceptedArtifactDeliveries } =
        await import("../agent-runtime/delivery/accepted-artifact-recover.js");
      const logRecovery = log.child("delivery-recovery");
      await recoverAcceptedArtifactDeliveries({
        deliver: deliverOutboundPayloads,
        log: logRecovery,
        cfg: cfgAtStart,
      });
    })().catch((err) => log.error(`Delivery recovery failed: ${String(err)}`));
  }

  // Recover pending collaboration handoff txns (WP-02). Flag-off = no-op.
  if (!minimalTestGateway) {
    void (async () => {
      const logRecovery = log.child("handoff-recovery");
      await recoverPendingHandoffTxnsAtGatewayBoot({
        cfg: cfgAtStart,
        log: {
          info: (message) => logRecovery.info(message),
          warn: (message) => logRecovery.warn(message),
        },
      });
    })().catch((err) => log.error(`Handoff recovery failed: ${String(err)}`));
  }

  // Recover pending TaskOutcome growth-evolution consumers (R85b).
  // Also starts an independent runtime drain so retries do not need a new user message.
  if (!minimalTestGateway) {
    void (async () => {
      const logRecovery = log.child("task-outcome-consumer");
      await recoverTaskOutcomeConsumersAtGatewayBoot({
        cfg: cfgAtStart,
        startRuntimeDrain: true,
        log: {
          info: (message) => logRecovery.info(message),
          warn: (message) => logRecovery.warn(message),
        },
      });
    })().catch((err) => log.error(`TaskOutcome consumer recovery failed: ${String(err)}`));
  }

  // Package2: recover durable async-wait intents (pid alive → wait; exited → one bounded wake).
  if (!minimalTestGateway) {
    void (async () => {
      const logRecovery = log.child("async-wait-recovery");
      setAsyncWaitRecoveryFollowupConsumerEnsure(({ cfg, sessionKey }) => {
        ensureAsyncWaitRecoveryFollowupConsumer({ cfg, sessionKey });
      });
      setAsyncWaitRecoveryContinueEnqueue(createAsyncWaitRecoveryContinueEnqueue(cfgAtStart));
      recoverAsyncWaitJobsAtGatewayBoot({
        cfg: cfgAtStart,
        startRecheck: true,
        log: {
          info: (message) => logRecovery.info(message),
          warn: (message) => logRecovery.warn(message),
        },
      });
    })().catch((err) => log.error(`Async-wait recovery failed: ${String(err)}`));
  }

  const execApprovalManager = new ExecApprovalManager({
    journalPath: resolveExecApprovalJournalPath(),
  });
  configureAccountSpawnHandoffStore(new AccountSpawnHandoffStore(resolveAccountSpawnHandoffPath()));
  recoverAccountSpawnHandoffs();
  const execApprovalForwarder = createExecApprovalForwarder();
  const execApprovalHandlers = createExecApprovalHandlers(execApprovalManager, {
    forwarder: execApprovalForwarder,
  });

  // Local disk read grant (non-production prototype).
  //
  // Composed here so the capability signing key lives for the gateway's lifetime:
  // a restart mints a fresh key, which invalidates every previously issued
  // capability. That is the fail-closed direction.
  //
  // A paired Mac that declares the read-only file commands can be bound from
  // the chat approval card. Nothing is granted until that card is allowed.
  // Design: docs/design/openbot-local-disk-read-grant-2026-09-29.md section 8 steps 1-7.
  const localFileApprovals = new LocalFileApprovalService({
    events: {
      requested: (payload) => {
        broadcast(LOCAL_FILES_APPROVAL_REQUESTED_EVENT, payload, { dropIfSlow: true });
      },
      resolved: (payload) => {
        broadcast(LOCAL_FILES_APPROVAL_RESOLVED_EVENT, payload, { dropIfSlow: true });
      },
    },
    // Same route test as exec approvals: without an operator surface able to render
    // the card the request is refused rather than left to time out.
    hasApprovalRoute: () => {
      for (const gatewayClient of clients) {
        const scopes = Array.isArray(gatewayClient.connect.scopes)
          ? gatewayClient.connect.scopes
          : [];
        if (scopes.includes("operator.admin") || scopes.includes("operator.approvals")) {
          return true;
        }
      }
      return false;
    },
  });
  const localFilesRuntime = configureLocalFilesRuntime({
    node: createNodeInvokePort(nodeRegistry),
    approvals: localFileApprovals,
    homeDirForAudit: resolveEffectiveHomeDir(),
    nodes: {
      list: () =>
        nodeRegistry.listConnected().map((session) => ({
          nodeId: session.nodeId,
          caps: session.caps,
          commands: session.commands,
          devicePublicKey: session.client.devicePublicKey,
          displayName: session.displayName,
        })),
      get: (nodeId) => {
        const session = nodeRegistry.get(nodeId);
        if (!session) {
          return undefined;
        }
        return {
          nodeId: session.nodeId,
          caps: session.caps,
          commands: session.commands,
          devicePublicKey: session.client.devicePublicKey,
          displayName: session.displayName,
        };
      },
    },
  });
  // Bindings must survive a restart, otherwise every gateway restart silently
  // revokes disk access for every user. Hydration failure is logged and left as an
  // empty set, which denies access rather than guessing (design 4.3).
  void localFilesRuntime.bindings
    .hydrate()
    .then((count) => {
      if (count > 0) {
        log.info(`local files: loaded ${count} device binding(s)`);
      }
    })
    .catch((err) => {
      log.warn(`local files: failed to load device bindings: ${String(err)}`);
    });
  const secretsHandlers = createSecretsHandlers({
    reloadSecrets: async () => {
      const active = getActiveSecretsRuntimeSnapshot();
      if (!active) {
        throw new Error("Secrets runtime snapshot is not active.");
      }
      const prepared = await activateRuntimeSecrets(active.sourceConfig, {
        reason: "reload",
        activate: true,
      });
      return { warningCount: prepared.warnings.length };
    },
    resolveSecrets: async ({ commandName, targetIds }) => {
      const { assignments, diagnostics, inactiveRefPaths } =
        resolveCommandSecretsFromActiveRuntimeSnapshot({
          commandName,
          targetIds: new Set(targetIds),
        });
      if (assignments.length === 0) {
        return { assignments: [] as CommandSecretAssignment[], diagnostics, inactiveRefPaths };
      }
      return { assignments, diagnostics, inactiveRefPaths };
    },
  });

  const canvasHostServerPort = (canvasHostServer as CanvasHostServer | null)?.port;

  const gatewayRequestContext: import("./server-methods/types.js").GatewayRequestContext = {
    deps,
    cron,
    cronStorePath,
    execApprovalManager,
    loadGatewayModelCatalog,
    getHealthCache,
    refreshHealthSnapshot: refreshGatewayHealthSnapshot,
    logHealth,
    logGateway: log,
    incrementPresenceVersion,
    getHealthVersion,
    broadcast,
    broadcastToConnIds,
    broadcastChat,
    nodeSendToSession,
    nodeSendToAllSubscribed,
    nodeSubscribe,
    nodeUnsubscribe,
    nodeUnsubscribeAll,
    hasConnectedMobileNode: hasMobileNodeConnected,
    hasExecApprovalClients: () => {
      for (const gatewayClient of clients) {
        const scopes = Array.isArray(gatewayClient.connect.scopes)
          ? gatewayClient.connect.scopes
          : [];
        if (scopes.includes("operator.admin") || scopes.includes("operator.approvals")) {
          return true;
        }
      }
      return false;
    },
    nodeRegistry,
    agentRunSeq,
    chatAbortControllers,
    chatAbortedRuns: chatRunState.abortedRuns,
    chatRunBuffers: chatRunState.buffers,
    chatDeltaSentAt: chatRunState.deltaSentAt,
    addChatRun,
    removeChatRun,
    registerToolEventRecipient: toolEventRecipients.add,
    dedupe,
    wizardSessions,
    findRunningWizard,
    purgeWizardSession,
    getRuntimeSnapshot,
    startChannel,
    stopChannel,
    markChannelLoggedOut,
    wizardRunner,
    broadcastVoiceWakeChanged,
  };

  // Store the gateway context as a fallback for plugin subagent dispatch
  // in non-WS paths (Telegram polling, WhatsApp, etc.) where no per-request
  // scope is set via AsyncLocalStorage.
  fallbackGatewayContextHolder.set(gatewayRequestContext);
  registerGrowthEventBroadcast(broadcast);

  // OpenBot Fabric control plane (feature-gated, default OFF). When enabled,
  // install a production service: real exec-policy probes + a real executor.
  // Tools route through the gateway's own loopback /tools/invoke surface;
  // declarative generic.* adapters that name a real binary (git) run as OS
  // processes (the native process runner). Each completed execution emits a
  // canonical control-plane audit line into the gateway log (the audit store).
  // OpenBot Fabric control plane (default OFF). The service + audit store are
  // ALWAYS constructed, but the provider returns a live service only while the
  // feature is enabled (env OPENBOT_FABRIC_ENABLED or config gateway.fabric.enabled).
  // This lets the platform UI toggle enablement (config.patch / fabric.feature.set)
  // and have it take effect for new requests without a gateway restart. When
  // disabled the resolver yields null ⇒ handlers report UNAVAILABLE and the
  // existing tool path is byte-for-byte unchanged (R13.1).
  {
    const fabricToken = resolvedAuth?.mode === "token" ? resolvedAuth.token : undefined;
    const fabricAuditStore = createFabricAuditStore();
    // Stage-2 (M4): build the compile-time Loom attribution resolver once from
    // the repo registry (absent in production installs → null → no signal). The
    // resolver is a pure in-memory matcher (no runtime registry lookup, D4).
    const loomAttribution = loadLoomAttributionSource();
    const fabricService = createGatewayFabricService({
      toolInvoker: createLoopbackToolInvoker({
        baseUrl: `http://127.0.0.1:${port}`,
        token: fabricToken,
      }),
      processRunner: {},
      ...(loomAttribution ? { attributionFor: loomAttribution.attributionFor } : {}),
      onRecord: (rec) => {
        fabricAuditStore.append(rec);
        log.info(`[fabric] ${formatFabricAuditLine(rec)}`);
      },
    });
    setFabricAuditStoreProvider(() => fabricAuditStore);
    setFabricServiceProvider(() => (isFabricEnabled() ? fabricService : null));
    log.info(
      isFabricEnabled()
        ? "[fabric] control plane enabled; /v1/* + fabric.* live"
        : "[fabric] control plane installed (disabled); enable via gateway.fabric.enabled or OPENBOT_FABRIC_ENABLED",
    );

    // Development Supervisor (M1/M2) production wiring:
    // - export ports to supervisor.task.* gateway handlers
    // - start cron-driven driver + resume in-flight tasks once per gateway start
    if (!minimalTestGateway) {
      setSupervisorTaskEventSink((payload) => {
        const recipients = getSupervisorTaskEventRecipients(payload.taskId);
        if (!recipients || recipients.size === 0) {
          return;
        }
        broadcastToConnIds("supervisor.task.event", payload, recipients, { dropIfSlow: true });
      });
      // Vault Sync P2.1: ciphertext revision availability only (no blobs / plaintext).
      setVaultSyncRevisionEventSink((payload) => {
        broadcast(VAULT_SYNC_REVISIONS_EVENT, payload, { dropIfSlow: true });
      });
      setSupervisorPortsProvider(() => resolveSupervisorPorts({ cfg: loadConfig(), nodeRegistry }));
      void startSupervisorRuntime({ cfg: cfgAtStart, nodeRegistry }).catch(() => undefined);
    }
  }

  attachGatewayWsHandlers({
    wss,
    clients,
    port,
    gatewayHost: bindHost ?? undefined,
    canvasHostEnabled: Boolean(canvasHost),
    canvasHostServerPort,
    canvasHostBaseUrl: cfgAtStart.canvasHost?.baseUrl,
    resolvedAuth,
    rateLimiter: authRateLimiter,
    browserRateLimiter: browserAuthRateLimiter,
    gatewayMethods,
    events: GATEWAY_EVENTS,
    logGateway: log,
    logHealth,
    logWsControl,
    extraHandlers: {
      ...pluginRegistry.gatewayHandlers,
      ...execApprovalHandlers,
      ...secretsHandlers,
      ...createObservationQueryHandlers({
        platformActivityCollector: heartbeatActivity,
        ...createObservationReasoningOptions(process.env.OPENBOT_OBSERVATION_REASONING === "1"),
      }),
    },
    broadcast,
    context: gatewayRequestContext,
  });
  logGatewayStartup({
    cfg: cfgAtStart,
    bindHost,
    bindHosts: httpBindHosts,
    port,
    tlsEnabled: gatewayTls.enabled,
    log,
    isNixMode,
  });
  const stopGatewayUpdateCheck = minimalTestGateway
    ? () => {}
    : scheduleGatewayUpdateCheck({
        cfg: cfgAtStart,
        log,
        isNixMode,
        onUpdateAvailableChange: (updateAvailable) => {
          const payload: GatewayUpdateAvailableEventPayload = { updateAvailable };
          broadcast(GATEWAY_EVENT_UPDATE_AVAILABLE, payload, { dropIfSlow: true });
        },
      });
  const tailscaleCleanup = minimalTestGateway
    ? null
    : await startGatewayTailscaleExposure({
        tailscaleMode,
        resetOnExit: tailscaleConfig.resetOnExit,
        port,
        controlUiBasePath,
        logTailscale,
      });

  let browserControl: Awaited<ReturnType<typeof startBrowserControlServerIfEnabled>> = null;
  if (!minimalTestGateway) {
    ({ browserControl, pluginServices } = await startGatewaySidecars({
      cfg: cfgAtStart,
      pluginRegistry,
      defaultWorkspaceDir,
      deps,
      startChannels,
      log,
      logHooks,
      logChannels,
      logBrowser,
    }));
  }

  // Run gateway_start plugin hook (fire-and-forget)
  if (!minimalTestGateway) {
    const hookRunner = getGlobalHookRunner();
    if (hookRunner?.hasHooks("gateway_start")) {
      void hookRunner.runGatewayStart({ port }, { port }).catch((err) => {
        log.warn(`gateway_start hook failed: ${String(err)}`);
      });
    }
  }

  // ConversationTask Runtime — P2.5 shadow + activation (activation stays env-gated).
  initShadowHookFromServerConfig({
    onError: (err) => log.warn(`conversation-task hook init failed: ${String(err)}`),
  });

  const configReloader = minimalTestGateway
    ? { stop: async () => {} }
    : (() => {
        const { applyHotReload, requestGatewayRestart } = createGatewayReloadHandlers({
          deps,
          broadcast,
          getState: () => ({
            hooksConfig,
            heartbeatRunner,
            cronState,
            browserControl,
            channelHealthMonitor,
          }),
          setState: (nextState) => {
            hooksConfig = nextState.hooksConfig;
            heartbeatRunner = nextState.heartbeatRunner;
            cronState = nextState.cronState;
            cron = cronState.cron;
            cronStorePath = cronState.storePath;
            browserControl = nextState.browserControl;
            channelHealthMonitor = nextState.channelHealthMonitor;
          },
          startChannel,
          stopChannel,
          logHooks,
          logBrowser,
          logChannels,
          logCron,
          logReload,
          createHealthMonitor: (checkIntervalMs: number) =>
            startChannelHealthMonitor({ channelManager, checkIntervalMs }),
        });

        return startGatewayConfigReloader({
          initialConfig: cfgAtStart,
          readSnapshot: readConfigFileSnapshot,
          onHotReload: async (plan, nextConfig) => {
            const previousSnapshot = getActiveSecretsRuntimeSnapshot();
            const prepared = await activateRuntimeSecrets(nextConfig, {
              reason: "reload",
              activate: true,
            });
            try {
              await applyHotReload(plan, prepared.config);
            } catch (err) {
              if (previousSnapshot) {
                activateSecretsRuntimeSnapshot(previousSnapshot);
              } else {
                clearSecretsRuntimeSnapshot();
              }
              throw err;
            }
          },
          onRestart: async (plan, nextConfig) => {
            await activateRuntimeSecrets(nextConfig, { reason: "restart-check", activate: false });
            requestGatewayRestart(plan, nextConfig);
          },
          log: {
            info: (msg) => logReload.info(msg),
            warn: (msg) => logReload.warn(msg),
            error: (msg) => logReload.error(msg),
          },
          watchPath: CONFIG_PATH,
        });
      })();

  const close = createGatewayCloseHandler({
    bonjourStop,
    tailscaleCleanup,
    canvasHost,
    canvasHostServer,
    stopChannel,
    pluginServices,
    cron,
    heartbeatRunner,
    updateCheckStop: stopGatewayUpdateCheck,
    nodePresenceTimers,
    broadcast,
    tickInterval,
    healthInterval,
    dedupeCleanup,
    mediaCleanup,
    agentUnsub,
    heartbeatUnsub: heartbeatActivity ? () => heartbeatActivity.stop() : null,
    chatRunState,
    clients,
    configReloader,
    browserControl,
    wss,
    httpServer,
    httpServers,
  });

  return {
    close: async (opts) => {
      groupTaskHeartbeatScheduler?.stop();
      conversationEvaluation?.stop();
      // Run gateway_stop plugin hook before shutdown
      await runGlobalGatewayStopSafely({
        event: { reason: opts?.reason ?? "gateway stopping" },
        ctx: { port },
        onError: (err) => log.warn(`gateway_stop hook failed: ${String(err)}`),
      });
      if (diagnosticsEnabled) {
        stopDiagnosticHeartbeat();
      }
      if (skillsRefreshTimer) {
        clearTimeout(skillsRefreshTimer);
        skillsRefreshTimer = null;
      }
      skillsChangeUnsub();
      authRateLimiter?.dispose();
      browserAuthRateLimiter.dispose();
      channelHealthMonitor?.stop();
      await shutdownShadowHook(2000); // bounded drain of pending shadow writes
      clearSecretsRuntimeSnapshot();
      fallbackGatewayContextHolder.clear();
      await close(opts);
    },
  };
}
