import chalk from "chalk";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { resolveConfiguredModelRef } from "../agents/model-selection.js";
import type { loadConfig } from "../config/config.js";
import { getResolvedLoggerSettings } from "../logging.js";
import { collectEnabledInsecureOrDangerousFlags } from "../security/dangerous-config-flags.js";
import { resolveSecurityProfile, toSecurityProfileStartupAudit } from "./security-profile.js";

export function logGatewayStartup(params: {
  cfg: ReturnType<typeof loadConfig>;
  bindHost: string;
  bindHosts?: string[];
  port: number;
  tlsEnabled?: boolean;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string) => void };
  isNixMode: boolean;
}) {
  const { provider: agentProvider, model: agentModel } = resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const modelRef = `${agentProvider}/${agentModel}`;
  params.log.info(`agent model: ${modelRef}`, {
    consoleMessage: `agent model: ${chalk.whiteBright(modelRef)}`,
  });
  const scheme = params.tlsEnabled ? "wss" : "ws";
  const formatHost = (host: string) => (host.includes(":") ? `[${host}]` : host);
  const hosts =
    params.bindHosts && params.bindHosts.length > 0 ? params.bindHosts : [params.bindHost];
  const listenEndpoints = hosts.map((host) => `${scheme}://${formatHost(host)}:${params.port}`);
  params.log.info(`listening on ${listenEndpoints.join(", ")} (PID ${process.pid})`);
  params.log.info(`log file: ${getResolvedLoggerSettings().file}`);
  if (params.isNixMode) {
    params.log.info("gateway: running in Nix mode (config managed externally)");
  }

  const securityAudit = toSecurityProfileStartupAudit(
    resolveSecurityProfile(params.cfg, process.env),
  );
  params.log.info(
    `security profile: ${securityAudit.profile} isolation=${securityAudit.isolationLevel} boundary=${securityAudit.tenantExecutionBoundary} ok=${securityAudit.ok}`,
    { securityProfile: securityAudit },
  );

  // Startup audit of the active log-redaction tier (F-8): managed/hosted
  // deployments shipping logs to aggregation should run "all".
  const redactMode = params.cfg.logging?.redactSensitive ?? "tools";
  params.log.info(`log redaction: logging.redactSensitive=${redactMode}`, {
    logRedaction: { mode: redactMode },
  });
  if (redactMode !== "all" && securityAudit.profile === "managed_enterprise") {
    params.log.warn(
      `security warning: managed profile with logging.redactSensitive="${redactMode}"; ` +
        'set "all" before shipping logs to aggregation.',
    );
  }

  const enabledDangerousFlags = collectEnabledInsecureOrDangerousFlags(params.cfg);
  if (enabledDangerousFlags.length > 0) {
    const warning =
      `security warning: dangerous config flags enabled: ${enabledDangerousFlags.join(", ")}. ` +
      "Run `openbot security audit`.";
    params.log.warn(warning);
  }
}
