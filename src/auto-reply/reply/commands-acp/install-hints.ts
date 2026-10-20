import { existsSync } from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../../../config/config.js";

export function resolveConfiguredAcpBackendId(cfg: OpenBotConfig): string {
  return cfg.acp?.backend?.trim() || "acpx";
}

export function resolveAcpInstallCommandHint(cfg: OpenBotConfig): string {
  const configured = cfg.acp?.runtime?.installCommand?.trim();
  if (configured) {
    return configured;
  }
  const backendId = resolveConfiguredAcpBackendId(cfg).toLowerCase();
  if (backendId === "acpx") {
    const localPath = path.resolve(process.cwd(), "extensions/acpx");
    if (existsSync(localPath)) {
      return `openbot plugins install ${localPath}`;
    }
    return "openbot plugins install acpx";
  }
  return `Install and enable the plugin that provides ACP backend "${backendId}".`;
}
