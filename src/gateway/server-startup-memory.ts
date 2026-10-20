import { listAgentIds } from "../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import type { OpenBotConfig } from "../config/config.js";
import { resolveMemoryBackendConfig } from "../memory/backend-config.js";
import { getMemorySearchManager, isManagedCogniWeaveTenant } from "../memory/search-manager.js";

export async function startGatewayMemoryBackend(params: {
  cfg: OpenBotConfig;
  log: { info?: (msg: string) => void; warn: (msg: string) => void };
}): Promise<void> {
  const agentIds = listAgentIds(params.cfg);
  for (const agentId of agentIds) {
    if (!resolveMemorySearchConfig(params.cfg, agentId)) {
      continue;
    }
    const resolved = resolveMemoryBackendConfig({ cfg: params.cfg, agentId });
    if (resolved.backend === "cogniweave" && resolved.cogniweave) {
      const cloudTenant = resolved.cogniweave.cloudSync?.tenantId;
      if (isManagedCogniWeaveTenant(cloudTenant)) {
        // Managed tenants require call-entry ownership proof; defer manager arming
        // until an authenticated TenantContext / seat path injects governance.
        params.log.info?.(
          `cogniweave memory startup deferred for agent "${agentId}" (managed tenant requires ownership proof at call entry)`,
        );
        continue;
      }
      const { manager, error } = await getMemorySearchManager({ cfg: params.cfg, agentId });
      if (!manager) {
        params.log.warn(
          `cogniweave memory startup initialization failed for agent "${agentId}": ${error ?? "unknown error"}`,
        );
        continue;
      }
      params.log.info?.(`cogniweave memory startup initialization armed for agent "${agentId}"`);
      continue;
    }
    if (resolved.backend !== "qmd" || !resolved.qmd) {
      continue;
    }

    const { manager, error } = await getMemorySearchManager({ cfg: params.cfg, agentId });
    if (!manager) {
      params.log.warn(
        `qmd memory startup initialization failed for agent "${agentId}": ${error ?? "unknown error"}`,
      );
      continue;
    }
    params.log.info?.(`qmd memory startup initialization armed for agent "${agentId}"`);
  }
}
