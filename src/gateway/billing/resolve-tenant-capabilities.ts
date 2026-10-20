import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolvePlatformModelsMode } from "../models/platform-models-config.js";

export type TenantCapabilities = {
  /** Gateway 平台模型层是否处于 AOR 增强模式。 */
  aor?: boolean;
};

/** 企业端 UI 能力信号（Phase 4.7）；不引入 per-tenant DB。 */
export function resolveTenantCapabilities(cfg?: OpenBotConfig): TenantCapabilities {
  const config = cfg ?? loadConfig();
  return {
    aor: resolvePlatformModelsMode(config) === "aor_enhanced",
  };
}
