import type { OpenBotConfig } from "../config/config.js";
import { resolveOperatorStateRoot } from "../config/operator-state-scope.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { PluginRegistry } from "./registry.js";
import type { OpenClawPluginServiceContext, PluginLogger } from "./types.js";

const log = createSubsystemLogger("plugins");

function createPluginLogger(): PluginLogger {
  return {
    info: (msg) => log.info(msg),
    warn: (msg) => log.warn(msg),
    error: (msg) => log.error(msg),
    debug: (msg) => log.debug(msg),
  };
}

function createServiceContext(params: {
  config: OpenBotConfig;
  workspaceDir?: string;
}): OpenClawPluginServiceContext {
  const ctx = {
    config: params.config,
    workspaceDir: params.workspaceDir,
    logger: createPluginLogger(),
  } as OpenClawPluginServiceContext;
  // Lazy getter: follows AsyncLocalStorage / env operator scope at access time
  // so two operators on one gateway process do not share roots when scoped.
  Object.defineProperty(ctx, "stateDir", {
    enumerable: true,
    configurable: false,
    get: () => resolveOperatorStateRoot(),
  });
  return ctx;
}

export type PluginServicesHandle = {
  stop: () => Promise<void>;
};

export async function startPluginServices(params: {
  registry: PluginRegistry;
  config: OpenBotConfig;
  workspaceDir?: string;
}): Promise<PluginServicesHandle> {
  const running: Array<{
    id: string;
    stop?: () => void | Promise<void>;
  }> = [];
  const serviceContext = createServiceContext({
    config: params.config,
    workspaceDir: params.workspaceDir,
  });

  for (const entry of params.registry.services) {
    const service = entry.service;
    try {
      await service.start(serviceContext);
      running.push({
        id: service.id,
        stop: service.stop ? () => service.stop?.(serviceContext) : undefined,
      });
    } catch (err) {
      log.error(`plugin service failed (${service.id}): ${String(err)}`);
    }
  }

  return {
    stop: async () => {
      for (const entry of running.toReversed()) {
        if (!entry.stop) {
          continue;
        }
        try {
          await entry.stop();
        } catch (err) {
          log.warn(`plugin service stop failed (${entry.id}): ${String(err)}`);
        }
      }
    },
  };
}
