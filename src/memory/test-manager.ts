import type { OpenBotConfig } from "../config/config.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";
import { registerIsolatedTestV1Root } from "./test-manager-helpers.js";

export async function createMemoryManagerOrThrow(
  cfg: OpenBotConfig,
  agentId = "main",
): Promise<MemoryIndexManager> {
  const result = await getMemorySearchManager({ cfg, agentId });
  if (!result.manager) {
    throw new Error("manager missing");
  }
  registerIsolatedTestV1Root(result.manager);
  return result.manager as MemoryIndexManager;
}
