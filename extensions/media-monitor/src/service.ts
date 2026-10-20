import type {
  OpenClawPluginApi,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "openclaw/plugin-sdk/media-monitor";
import type { MediaMonitorPluginConfig } from "./config.js";
import { runMonitorTargetJob, type JobRunnerDeps } from "./job-runner.js";
import { resolveMonitorStorePath } from "./monitor-store.js";
import { flushOutbox } from "./outbox-flusher.js";
import { listDueTargets } from "./scheduler.js";

export type MediaMonitorServiceHandle = {
  storePath: string;
  config: MediaMonitorPluginConfig;
  runTarget: (targetId: string, opts?: { tenantId?: string; agentId?: string }) => Promise<unknown>;
  flushOutbox: () => Promise<unknown>;
  tickDue: () => Promise<unknown>;
};

let activeHandle: MediaMonitorServiceHandle | null = null;

export function getMediaMonitorServiceHandle(): MediaMonitorServiceHandle | null {
  return activeHandle;
}

export function createMediaMonitorService(params: {
  api: OpenClawPluginApi;
  config: MediaMonitorPluginConfig;
  resolveCookie?: () => string | undefined;
}): OpenClawPluginService {
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let outboxTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let storePath = "";
  const ownerId = `media-monitor:${process.pid}`;

  const buildDeps = (): JobRunnerDeps => ({
    api: params.api,
    storePath,
    config: params.config,
    ownerId,
    resolveCookie: params.resolveCookie,
  });

  const tickDue = async () => {
    if (!params.config.enabled || running) {
      return { skipped: true };
    }
    running = true;
    try {
      const due = await listDueTargets({ storePath, limit: 1 });
      const results = [];
      for (const target of due) {
        // staggerMs is reserved for multi-due ticks; listDueTargets(limit:1) means this branch is inert today.
        if (params.config.staggerMs > 0 && results.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, params.config.staggerMs));
        }
        results.push(
          await runMonitorTargetJob({
            deps: buildDeps(),
            targetId: target.id,
          }),
        );
      }
      return { ok: true, results };
    } catch (err) {
      params.api.logger.warn(
        `media-monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false };
    } finally {
      running = false;
    }
  };

  const service: OpenClawPluginService = {
    id: "media-monitor",
    start: async (ctx: OpenClawPluginServiceContext) => {
      storePath = resolveMonitorStorePath(ctx.stateDir);
      activeHandle = {
        storePath,
        config: params.config,
        runTarget: (targetId, opts) =>
          runMonitorTargetJob({
            deps: buildDeps(),
            targetId,
            tenantId: opts?.tenantId,
            agentId: opts?.agentId,
          }),
        flushOutbox: () => flushOutbox({ api: params.api, storePath }),
        tickDue,
      };

      if (!params.config.enabled) {
        params.api.logger.info("media-monitor service disabled by config");
        return;
      }

      // Internal due-check: complements OpenBot cron triggers (gateway method / tool).
      // Not a user-visible second scheduler UI.
      tickTimer = setInterval(() => {
        void tickDue();
      }, params.config.tickIntervalMs);
      tickTimer.unref?.();

      outboxTimer = setInterval(() => {
        void flushOutbox({ api: params.api, storePath }).catch((err) => {
          params.api.logger.warn(
            `media-monitor outbox flush failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, params.config.outboxFlushIntervalMs);
      outboxTimer.unref?.();

      params.api.logger.info(`media-monitor service started store=${storePath}`);
    },
    stop: async () => {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      if (outboxTimer) {
        clearInterval(outboxTimer);
        outboxTimer = null;
      }
      activeHandle = null;
    },
  };

  return service;
}
