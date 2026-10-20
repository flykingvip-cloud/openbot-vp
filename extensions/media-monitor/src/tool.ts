import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { MonitorAuthError, requireTargetAccess, resolveMonitorAuth } from "./auth.js";
import type { MediaMonitorPluginConfig } from "./config.js";
import { runMonitorTargetJob } from "./job-runner.js";
import { resolveMonitorStorePath } from "./monitor-store.js";
import { flushOutbox } from "./outbox-flusher.js";
import { listDueTargets } from "./scheduler.js";
import { getMediaMonitorServiceHandle } from "./service.js";
import {
  addMonitorTarget,
  getMonitorTarget,
  listMonitorTargets,
  updateMonitorTarget,
} from "./targets.js";

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function requireToolAuth(rawArgs: Record<string, unknown>) {
  // Agent tools have no Gateway session client; require explicit tenant+agent.
  return resolveMonitorAuth({ client: null, params: rawArgs });
}

export function createMediaMonitorTool(params: {
  api: OpenClawPluginApi;
  config: MediaMonitorPluginConfig;
}): AnyAgentTool {
  return {
    name: "media_monitor",
    label: "Media Monitor",
    description:
      "Manage read-only social media monitor targets (MVP: xhs). Actions: add_target, update_target, list_targets, run_target, tick_due, flush_outbox. Requires tenantId+agentId. Comments only for watchedContentIds. Never auto-posts.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: [
            "add_target",
            "update_target",
            "list_targets",
            "run_target",
            "tick_due",
            "flush_outbox",
          ],
        },
        tenantId: { type: "string" },
        agentId: { type: "string" },
        targetId: { type: "string" },
        accountId: { type: "string" },
        accountUrl: { type: "string" },
        displayName: { type: "string" },
        pollIntervalSeconds: { type: "number" },
        watchedContentIds: {
          type: "array",
          items: { type: "string" },
        },
        notifyChannel: { type: "string" },
        notifyTo: { type: "string" },
      },
      required: ["action", "tenantId", "agentId"],
    },
    execute: async (_toolCallId: string, rawArgs: Record<string, unknown>) => {
      try {
        const action = String(rawArgs.action ?? "");
        const handle = getMediaMonitorServiceHandle();
        const storePath =
          handle?.storePath ??
          resolveMonitorStorePath(process.env.OPENBOT_STATE_DIR || `${process.env.HOME}/.openbot`);
        const config = handle?.config ?? params.config;

        const auth = requireToolAuth(rawArgs);
        if (auth.role !== "tenant") {
          throw new MonitorAuthError("forbidden: tenantId and agentId required");
        }

        if (action === "flush_outbox") {
          const result = await flushOutbox({
            api: params.api,
            storePath,
            tenantId: auth.tenantId,
            agentId: auth.agentId,
          });
          return jsonResult(result);
        }

        if (action === "tick_due") {
          const due = await listDueTargets({
            storePath,
            limit: 1,
            tenantId: auth.tenantId,
            agentId: auth.agentId,
          });
          const results = [];
          for (const target of due) {
            results.push(
              handle
                ? await handle.runTarget(target.id, {
                    tenantId: auth.tenantId,
                    agentId: auth.agentId,
                  })
                : await runMonitorTargetJob({
                    deps: {
                      api: params.api,
                      storePath,
                      config,
                      ownerId: `media-monitor-tool:${process.pid}`,
                    },
                    targetId: target.id,
                    tenantId: auth.tenantId,
                    agentId: auth.agentId,
                  }),
            );
          }
          return jsonResult({ ok: true, results });
        }

        if (action === "add_target") {
          const target = await addMonitorTarget({
            storePath,
            config,
            input: {
              tenantId: auth.tenantId,
              agentId: auth.agentId,
              accountId: String(rawArgs.accountId ?? ""),
              accountUrl: String(rawArgs.accountUrl ?? ""),
              displayName:
                typeof rawArgs.displayName === "string" ? rawArgs.displayName : undefined,
              pollIntervalSeconds:
                typeof rawArgs.pollIntervalSeconds === "number"
                  ? rawArgs.pollIntervalSeconds
                  : undefined,
              watchedContentIds: Array.isArray(rawArgs.watchedContentIds)
                ? rawArgs.watchedContentIds.map(String)
                : undefined,
              notifyChannel:
                typeof rawArgs.notifyChannel === "string" ? rawArgs.notifyChannel : undefined,
              notifyTo: typeof rawArgs.notifyTo === "string" ? rawArgs.notifyTo : undefined,
            },
          });
          return jsonResult({ ok: true, target });
        }

        if (action === "update_target") {
          const targetId = String(rawArgs.targetId ?? "");
          if (!targetId) {
            return jsonResult({ ok: false, error: "targetId required" });
          }
          const existing = await getMonitorTarget({ storePath, targetId });
          requireTargetAccess(auth, existing);
          const target = await updateMonitorTarget({
            storePath,
            targetId,
            tenantId: auth.tenantId,
            agentId: auth.agentId,
            patch: {
              displayName:
                typeof rawArgs.displayName === "string" ? rawArgs.displayName : undefined,
              pollIntervalSeconds:
                typeof rawArgs.pollIntervalSeconds === "number"
                  ? rawArgs.pollIntervalSeconds
                  : undefined,
              watchedContentIds: Array.isArray(rawArgs.watchedContentIds)
                ? rawArgs.watchedContentIds.map(String)
                : undefined,
              notifyChannel:
                typeof rawArgs.notifyChannel === "string" ? rawArgs.notifyChannel : undefined,
              notifyTo: typeof rawArgs.notifyTo === "string" ? rawArgs.notifyTo : undefined,
            },
          });
          if (!target) {
            return jsonResult({ ok: false, error: "target not found" });
          }
          return jsonResult({ ok: true, target });
        }

        if (action === "list_targets") {
          const targets = await listMonitorTargets({
            storePath,
            tenantId: auth.tenantId,
            agentId: auth.agentId,
          });
          return jsonResult({ ok: true, targets });
        }

        if (action === "run_target") {
          const targetId = String(rawArgs.targetId ?? "");
          if (!targetId) {
            return jsonResult({ ok: false, error: "targetId required" });
          }
          const existing = await getMonitorTarget({ storePath, targetId });
          requireTargetAccess(auth, existing);
          const result = handle
            ? await handle.runTarget(targetId, {
                tenantId: auth.tenantId,
                agentId: auth.agentId,
              })
            : await runMonitorTargetJob({
                deps: {
                  api: params.api,
                  storePath,
                  config,
                  ownerId: `media-monitor-tool:${process.pid}`,
                },
                targetId,
                tenantId: auth.tenantId,
                agentId: auth.agentId,
              });
          return jsonResult(result);
        }

        return jsonResult({ ok: false, error: `unknown action: ${action}` });
      } catch (err) {
        return jsonResult({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          ...(err instanceof MonitorAuthError ? { code: err.code } : {}),
        });
      }
    },
  } as unknown as AnyAgentTool;
}
