import type { OpenBotConfig } from "../../config/types.js";
import { recordOrNull as asRecord } from "../records.js";
import type { PlatformModelsMode } from "./platform-models-types.js";

export type ResolvedPlatformModelsConfig = {
  mode: PlatformModelsMode;
  aor: {
    gatewayUrl: string;
    toolsBaseUrl: string;
    banditStatePath?: string;
    liveCodingArchivePath?: string;
    auditLogPath?: string;
    enableBandit: boolean;
    enableRoutingExplanations: boolean;
    enableOptimizationMetrics: boolean;
  };
};

export function resolvePlatformModelsMode(cfg: OpenBotConfig): PlatformModelsMode {
  const platform = asRecord(cfg.gateway?.platform);
  const models = asRecord(platform?.models);
  const mode = models?.mode;
  return mode === "aor_enhanced" ? "aor_enhanced" : "native";
}

export function resolvePlatformModelsConfig(cfg: OpenBotConfig): ResolvedPlatformModelsConfig {
  const platform = asRecord(cfg.gateway?.platform);
  const models = asRecord(platform?.models);
  const aor = asRecord(models?.aor);
  const defaultGatewayUrl = process.env.AOR_GATEWAY_URL ?? "http://127.0.0.1:18789";
  return {
    mode: resolvePlatformModelsMode(cfg),
    aor: {
      gatewayUrl:
        typeof aor?.gatewayUrl === "string" && aor.gatewayUrl.trim()
          ? aor.gatewayUrl.trim()
          : defaultGatewayUrl,
      toolsBaseUrl:
        typeof aor?.toolsBaseUrl === "string" && aor.toolsBaseUrl.trim()
          ? aor.toolsBaseUrl.trim()
          : defaultGatewayUrl,
      banditStatePath:
        typeof aor?.banditStatePath === "string" && aor.banditStatePath.trim()
          ? aor.banditStatePath.trim()
          : undefined,
      liveCodingArchivePath:
        typeof aor?.liveCodingArchivePath === "string" && aor.liveCodingArchivePath.trim()
          ? aor.liveCodingArchivePath.trim()
          : undefined,
      auditLogPath:
        typeof aor?.auditLogPath === "string" && aor.auditLogPath.trim()
          ? aor.auditLogPath.trim()
          : undefined,
      enableBandit: aor?.enableBandit !== false,
      enableRoutingExplanations: aor?.enableRoutingExplanations !== false,
      enableOptimizationMetrics: aor?.enableOptimizationMetrics !== false,
    },
  };
}
