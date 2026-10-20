import type {
  GatewayRequestHandlerOptions,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/media-monitor";
import {
  MonitorAuthError,
  authMatchesTarget,
  requireTargetAccess,
  resolveMonitorAuth,
  type MonitorAuthScope,
} from "./src/auth.js";
import { createMediaMonitorConfigSchema, resolvePluginConfig } from "./src/config.js";
import { runMonitorTargetJob } from "./src/job-runner.js";
import { resolveMonitorStorePath } from "./src/monitor-store.js";
import { readMonitorStore } from "./src/monitor-store.js";
import { flushOutbox } from "./src/outbox-flusher.js";
import { setMediaMonitorRuntime } from "./src/runtime.js";
import { resolveCookieSecret, describeCookieConfigured } from "./src/secrets.js";
import { createMediaMonitorService, getMediaMonitorServiceHandle } from "./src/service.js";
import {
  addMonitorTarget,
  deleteMonitorTarget,
  getMonitorTarget,
  listMonitorTargets,
  updateMonitorTarget,
} from "./src/targets.js";
import { createMediaMonitorTool } from "./src/tool.js";

function respondError(respond: GatewayRequestHandlerOptions["respond"], err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  respond(false, {
    error: message,
    ...(err instanceof MonitorAuthError ? { code: err.code } : {}),
  });
}

function resolveStorePath(): string {
  const handle = getMediaMonitorServiceHandle();
  return (
    handle?.storePath ??
    resolveMonitorStorePath(process.env.OPENBOT_STATE_DIR || `${process.env.HOME}/.openbot`)
  );
}

function requireAuth(opts: GatewayRequestHandlerOptions): MonitorAuthScope {
  return resolveMonitorAuth({ client: opts.client, params: opts.params });
}

const plugin = {
  id: "media-monitor",
  name: "Media Monitor",
  description:
    "Read-only social media monitoring via an external MediaCrawler-compatible sidecar (MVP: xhs).",
  configSchema: createMediaMonitorConfigSchema(),
  register(api: OpenClawPluginApi) {
    setMediaMonitorRuntime(api.runtime);
    const config = resolvePluginConfig(api.pluginConfig);
    api.logger.info(
      `media-monitor register cookie=${describeCookieConfigured(config.cookieSecret)} adapter=${
        config.adapterCommand?.join(" ") ?? "(unset)"
      }`,
    );

    api.registerService(
      createMediaMonitorService({
        api,
        config,
        resolveCookie: () => resolveCookieSecret(config.cookieSecret),
      }),
    );

    api.registerTool(createMediaMonitorTool({ api, config }), { optional: true });

    api.registerGatewayMethod(
      "mediaMonitor.addTarget",
      async (opts: GatewayRequestHandlerOptions) => {
        try {
          const auth = requireAuth(opts);
          if (auth.role === "admin") {
            // Admin may create for an explicit tenant/agent pair.
            if (
              typeof opts.params?.tenantId !== "string" ||
              !opts.params.tenantId.trim() ||
              typeof opts.params?.agentId !== "string" ||
              !opts.params.agentId.trim()
            ) {
              throw new MonitorAuthError(
                "forbidden: admin addTarget requires tenantId and agentId",
              );
            }
          }
          const tenantId =
            auth.role === "admin" ? String(opts.params?.tenantId).trim() : auth.tenantId;
          const agentId =
            auth.role === "admin" ? String(opts.params?.agentId).trim() : auth.agentId;
          const handle = getMediaMonitorServiceHandle();
          const target = await addMonitorTarget({
            storePath: resolveStorePath(),
            config: handle?.config ?? config,
            input: {
              tenantId,
              agentId,
              accountId: String(opts.params?.accountId ?? ""),
              accountUrl: String(opts.params?.accountUrl ?? ""),
              displayName:
                typeof opts.params?.displayName === "string" ? opts.params.displayName : undefined,
              pollIntervalSeconds:
                typeof opts.params?.pollIntervalSeconds === "number"
                  ? opts.params.pollIntervalSeconds
                  : undefined,
              watchedContentIds: Array.isArray(opts.params?.watchedContentIds)
                ? opts.params.watchedContentIds.map(String)
                : undefined,
              notifyChannel:
                typeof opts.params?.notifyChannel === "string"
                  ? opts.params.notifyChannel
                  : undefined,
              notifyTo:
                typeof opts.params?.notifyTo === "string" ? opts.params.notifyTo : undefined,
              notifyAccountId:
                typeof opts.params?.notifyAccountId === "string"
                  ? opts.params.notifyAccountId
                  : undefined,
            },
          });
          opts.respond(true, { target });
        } catch (err) {
          respondError(opts.respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "mediaMonitor.listTargets",
      async (opts: GatewayRequestHandlerOptions) => {
        try {
          const auth = requireAuth(opts);
          const storePath = resolveStorePath();
          const targets =
            auth.role === "admin"
              ? await listMonitorTargets({ storePath })
              : await listMonitorTargets({
                  storePath,
                  tenantId: auth.tenantId,
                  agentId: auth.agentId,
                });
          opts.respond(true, { targets });
        } catch (err) {
          respondError(opts.respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "mediaMonitor.runTarget",
      async (opts: GatewayRequestHandlerOptions) => {
        try {
          const auth = requireAuth(opts);
          const targetId =
            typeof opts.params?.targetId === "string" ? opts.params.targetId.trim() : "";
          if (!targetId) {
            opts.respond(false, { error: "targetId required" });
            return;
          }
          const storePath = resolveStorePath();
          const existing = await getMonitorTarget({ storePath, targetId });
          requireTargetAccess(auth, existing);
          const handle = getMediaMonitorServiceHandle();
          const scope =
            auth.role === "admin"
              ? {
                  tenantId: existing!.tenantId,
                  agentId: existing!.agentId,
                }
              : { tenantId: auth.tenantId, agentId: auth.agentId };
          const result = handle
            ? await handle.runTarget(targetId, scope)
            : await runMonitorTargetJob({
                deps: {
                  api,
                  storePath,
                  config,
                  ownerId: `media-monitor-gw:${process.pid}`,
                  resolveCookie: () => resolveCookieSecret(config.cookieSecret),
                },
                targetId,
                ...scope,
              });
          opts.respond(true, result);
        } catch (err) {
          respondError(opts.respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "mediaMonitor.tickDue",
      async (opts: GatewayRequestHandlerOptions) => {
        try {
          const auth = requireAuth({ ...opts, params: { ...opts.params, admin: true } });
          if (auth.role !== "admin") {
            throw new MonitorAuthError("forbidden: admin capability required");
          }
          const handle = getMediaMonitorServiceHandle();
          if (!handle) {
            opts.respond(false, { error: "service not started" });
            return;
          }
          const result = await handle.tickDue();
          opts.respond(true, result);
        } catch (err) {
          respondError(opts.respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "mediaMonitor.flushOutbox",
      async (opts: GatewayRequestHandlerOptions) => {
        try {
          const auth = requireAuth({ ...opts, params: { ...opts.params, admin: true } });
          if (auth.role !== "admin") {
            throw new MonitorAuthError("forbidden: admin capability required");
          }
          const storePath = resolveStorePath();
          const handle = getMediaMonitorServiceHandle();
          const result = handle
            ? await handle.flushOutbox()
            : await flushOutbox({ api, storePath });
          opts.respond(true, result);
        } catch (err) {
          respondError(opts.respond, err);
        }
      },
    );

    api.registerGatewayMethod("mediaMonitor.status", async (opts: GatewayRequestHandlerOptions) => {
      try {
        const auth = requireAuth(opts);
        const storePath = resolveStorePath();
        const data = await readMonitorStore(storePath);
        const targets = data.targets.filter((target) => authMatchesTarget(auth, target));
        const targetIds = new Set(targets.map((t) => t.id));
        opts.respond(true, {
          enabled: config.enabled,
          storePath,
          targetCount: targets.length,
          eventCount: data.events.filter((e) => targetIds.has(e.targetId)).length,
          outboxPending: data.outbox.filter(
            (row) =>
              targetIds.has(row.targetId) &&
              (row.status === "pending" || row.status === "retry" || row.status === "sending"),
          ).length,
          leases: data.leases.filter((lease) => targetIds.has(lease.targetId)),
          health: targets.map((t) => ({
            id: t.id,
            healthState: t.healthState,
            baselineEstablished: t.cursor.baselineEstablished,
            lastSuccessAt: t.lastSuccessAt,
            lastFailureAt: t.lastFailureAt,
          })),
        });
      } catch (err) {
        respondError(opts.respond, err);
      }
    });

    api.registerGatewayMethod(
      "mediaMonitor.updateTarget",
      async (opts: GatewayRequestHandlerOptions) => {
        try {
          const auth = requireAuth(opts);
          const targetId =
            typeof opts.params?.targetId === "string" ? opts.params.targetId.trim() : "";
          if (!targetId) {
            opts.respond(false, { error: "targetId required" });
            return;
          }
          const storePath = resolveStorePath();
          const existing = await getMonitorTarget({ storePath, targetId });
          requireTargetAccess(auth, existing);
          const target = await updateMonitorTarget({
            storePath,
            targetId,
            tenantId: existing!.tenantId,
            agentId: existing!.agentId,
            patch: {
              enabled: typeof opts.params?.enabled === "boolean" ? opts.params.enabled : undefined,
              displayName:
                typeof opts.params?.displayName === "string" ? opts.params.displayName : undefined,
              pollIntervalSeconds:
                typeof opts.params?.pollIntervalSeconds === "number"
                  ? opts.params.pollIntervalSeconds
                  : undefined,
              watchedContentIds: Array.isArray(opts.params?.watchedContentIds)
                ? opts.params.watchedContentIds.map(String)
                : undefined,
              notifyChannel:
                opts.params?.notifyChannel === null
                  ? null
                  : typeof opts.params?.notifyChannel === "string"
                    ? opts.params.notifyChannel
                    : undefined,
              notifyTo:
                opts.params?.notifyTo === null
                  ? null
                  : typeof opts.params?.notifyTo === "string"
                    ? opts.params.notifyTo
                    : undefined,
              notifyAccountId:
                opts.params?.notifyAccountId === null
                  ? null
                  : typeof opts.params?.notifyAccountId === "string"
                    ? opts.params.notifyAccountId
                    : undefined,
            },
          });
          if (!target) {
            opts.respond(false, { error: "target not found" });
            return;
          }
          opts.respond(true, { target });
        } catch (err) {
          respondError(opts.respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "mediaMonitor.deleteTarget",
      async (opts: GatewayRequestHandlerOptions) => {
        try {
          const auth = requireAuth(opts);
          const targetId =
            typeof opts.params?.targetId === "string" ? opts.params.targetId.trim() : "";
          if (!targetId) {
            opts.respond(false, { error: "targetId required" });
            return;
          }
          const storePath = resolveStorePath();
          const existing = await getMonitorTarget({ storePath, targetId });
          requireTargetAccess(auth, existing);
          const deleted = await deleteMonitorTarget({
            storePath,
            targetId,
            tenantId: existing!.tenantId,
            agentId: existing!.agentId,
          });
          opts.respond(true, { deleted });
        } catch (err) {
          respondError(opts.respond, err);
        }
      },
    );

    api.registerGatewayMethod(
      "mediaMonitor.getTarget",
      async (opts: GatewayRequestHandlerOptions) => {
        try {
          const auth = requireAuth(opts);
          const targetId =
            typeof opts.params?.targetId === "string" ? opts.params.targetId.trim() : "";
          if (!targetId) {
            opts.respond(false, { error: "targetId required" });
            return;
          }
          const storePath = resolveStorePath();
          const target = await getMonitorTarget({ storePath, targetId });
          requireTargetAccess(auth, target);
          opts.respond(true, { target });
        } catch (err) {
          respondError(opts.respond, err);
        }
      },
    );
  },
};

export default plugin;
