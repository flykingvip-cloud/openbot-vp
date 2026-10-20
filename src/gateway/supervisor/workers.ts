/**
 * supervisor/workers.ts — list CLI backends that expose a Worker surface (M4.2).
 */

import { describeCliBackends } from "../../agents/cli-backend-admin.js";
import type { OpenBotConfig } from "../../config/config.js";

export type SupervisorWorkerDescriptor = {
  backendId: string;
  source: "builtin" | "config" | "override";
  taskCapabilities: string[];
  control: string[];
  models: string[];
};

export function listSupervisorWorkers(cfg?: OpenBotConfig): SupervisorWorkerDescriptor[] {
  return describeCliBackends(cfg)
    .filter((entry) => Boolean(entry.effective?.worker))
    .map((entry) => {
      const worker = entry.effective?.worker;
      const models = entry.effective?.modelCatalog?.map((model) => model.id).filter(Boolean) ?? [];
      return {
        backendId: entry.id,
        source: entry.source,
        taskCapabilities: [...(worker?.taskCapabilities ?? [])],
        control: [...(worker?.control ?? [])],
        models,
      };
    });
}
