import path from "node:path";
/** Thin read-only adapter; method registration belongs to the diagnosis pack. */
import { loadConfig, type OpenBotConfig } from "../config/config.js";
import {
  resolveDiagnosisProductionAuth,
  type DiagnosisGatewayAuthDeps,
  type DiagnosisGatewayAuthClient,
} from "../diagnosis/report-query-gateway.js";
import { resolvePlatformAuthConfig } from "../gateway/platform-auth/config.js";
import { loadStore } from "../gateway/platform-auth/store.js";
import { ErrorCodes, errorShape } from "../gateway/protocol/index.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import { normalizeTaskOutcomeSubjectRef } from "../task-outcome/subject-ref.js";
import { CONFIG_DIR } from "../utils.js";
import { queryActionIntents } from "./action-intent-query.js";
import { createActionIntentStore } from "./action-intent-store.js";
import { createCapacityReader } from "./capacity-reader.js";
import { createPlatformHeartbeatActivityQuery } from "./heartbeat-activity-query.js";
import type { startHeartbeatActivity } from "./heartbeat-activity.js";
import { createMetricCompareGatewayHelper } from "./metric-compare-gateway.js";
import { queryPlatformTaskIndex } from "./platform-task-index.js";
import { queryPlatformObservationSnapshot } from "./platform-window-snapshot.js";
import { queryObservationWithJournal } from "./query.js";
import { createReasoningGatewayAdapter } from "./reasoning-gateway.js";
import type { ReasoningInput, ReasoningModelPort } from "./reasoning-pass.js";
export const OBSERVATION_QUERY_METHOD = "diagnosis.observation.query";

async function defaultListGrantedTenantIds(loadCfg: () => OpenBotConfig): Promise<string[]> {
  try {
    const config = resolvePlatformAuthConfig(loadCfg().gateway?.auth?.trustedProxy);
    if (!config) {
      return [];
    }
    const store = await loadStore(config);
    return Object.values(store.enterprises)
      .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function createObservationQueryHandlers(
  options: {
    authDeps?: DiagnosisGatewayAuthDeps;
    platformActivityCollector?: Pick<ReturnType<typeof startHeartbeatActivity>, "query"> | null;
    loadConfig?: () => OpenBotConfig;
    now?: () => number;
    reasoningResolver?: typeof import("./reasoning-model-resolver.js").createReasoningModelResolver;
    reasoning?: {
      enabled?: boolean;
      modelRef?: string;
      model?: ReasoningModelPort;
      timeoutMs?: number;
    };
    capacityReader?: ReturnType<typeof createCapacityReader>;
    actionIntentStore?: Pick<ReturnType<typeof createActionIntentStore>, "list" | "detail">;
    listGrantedTenantIds?: () => Promise<readonly string[]>;
  } = {},
): GatewayRequestHandlers {
  return {
    [OBSERVATION_QUERY_METHOD]: async ({ client, params, respond }) => {
      const deny = (reason: string) =>
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, reason));
      const scopes = client?.connect.scopes ?? [];
      if (!client || (!scopes.includes("operator.read") && !scopes.includes("operator.admin"))) {
        deny("unauthorized");
        return;
      }
      const auth = await resolveDiagnosisProductionAuth(
        client as unknown as DiagnosisGatewayAuthClient,
        options.authDeps,
      );
      if (!auth) {
        deny("unauthorized");
        return;
      }
      if (params.platformActivity !== undefined) {
        if (params.platformActivity !== true || Object.keys(params).length !== 1) {
          deny("invalid_platform_activity_request");
          return;
        }
        if (!options.platformActivityCollector) {
          deny("platform_activity_unavailable");
          return;
        }
        const read = createPlatformHeartbeatActivityQuery({
          collector: options.platformActivityCollector,
          authorize: async () => {
            const fresh = await resolveDiagnosisProductionAuth(
              client as unknown as DiagnosisGatewayAuthClient,
              options.authDeps,
            );
            return fresh
              ? {
                  principalRef: fresh.principal.principalId,
                  tenantId: fresh.trusted.tenantId,
                  sessionDomain: client.sessionDomain ?? "employee",
                  scopes: client.connect.scopes ?? [],
                }
              : null;
          },
        });
        const activity = await read();
        if (!activity.ok) {
          deny(activity.code);
          return;
        }
        respond(true, activity, undefined);
        return;
      }
      if (params.platformWindow !== undefined) {
        if (params.platformWindow !== true) {
          deny("invalid_platform_window_request");
          return;
        }
        const allowedWindow = new Set(["platformWindow", "from", "to"]);
        if (Object.keys(params).some((key) => !allowedWindow.has(key))) {
          deny("invalid_platform_window_request");
          return;
        }
        const scopes = client.connect.scopes ?? [];
        const identityOk =
          client.sessionDomain === "platform" &&
          auth.trusted.tenantId === null &&
          scopes.includes("operator.platform");
        if (!identityOk) {
          deny("unauthorized");
          return;
        }
        const projectedAt = (options.now ?? Date.now)();
        let from = params.from;
        let to = params.to;
        if (from === undefined && to === undefined) {
          to = projectedAt;
          from = projectedAt - 7 * 86_400_000;
        }
        if (
          typeof from !== "number" ||
          typeof to !== "number" ||
          !Number.isFinite(from) ||
          !Number.isFinite(to)
        ) {
          deny("invalid_platform_window_request");
          return;
        }
        const snapshot = queryPlatformObservationSnapshot({
          cfg: (options.loadConfig ?? loadConfig)(),
          from,
          to,
          projectedAt,
          activity: options.platformActivityCollector?.query() ?? null,
        });
        const fresh = await resolveDiagnosisProductionAuth(
          client as unknown as DiagnosisGatewayAuthClient,
          options.authDeps,
        );
        if (
          !fresh ||
          fresh.trusted.tenantId !== auth.trusted.tenantId ||
          fresh.principal.principalId !== auth.principal.principalId ||
          client.sessionDomain !== "platform" ||
          fresh.trusted.tenantId !== null ||
          !(client.connect.scopes ?? []).includes("operator.platform")
        ) {
          deny("unauthorized");
          return;
        }
        if (!snapshot.ok) {
          deny(snapshot.code);
          return;
        }
        respond(true, snapshot, undefined);
        return;
      }
      if (params.taskIndex !== undefined) {
        if (params.taskIndex !== true) {
          deny("invalid_task_index_request");
          return;
        }
        const allowedIndex = new Set(["taskIndex", "from", "to", "tenantId", "agentId"]);
        if (Object.keys(params).some((key) => !allowedIndex.has(key))) {
          deny("invalid_task_index_request");
          return;
        }
        const indexScopes = client.connect.scopes ?? [];
        const indexIdentityOk =
          client.sessionDomain === "platform" &&
          auth.trusted.tenantId === null &&
          indexScopes.includes("operator.platform");
        if (!indexIdentityOk) {
          deny("unauthorized");
          return;
        }
        const projectedAt = (options.now ?? Date.now)();
        let from = params.from;
        let to = params.to;
        if (from === undefined && to === undefined) {
          to = projectedAt;
          from = projectedAt - 7 * 86_400_000;
        }
        if (
          typeof from !== "number" ||
          typeof to !== "number" ||
          !Number.isFinite(from) ||
          !Number.isFinite(to)
        ) {
          deny("invalid_task_index_request");
          return;
        }
        if (params.tenantId !== undefined && typeof params.tenantId !== "string") {
          deny("invalid_task_index_request");
          return;
        }
        if (params.agentId !== undefined && typeof params.agentId !== "string") {
          deny("invalid_task_index_request");
          return;
        }
        const loadCfg = options.loadConfig ?? loadConfig;
        const grantedTenantIds = options.listGrantedTenantIds
          ? [...(await options.listGrantedTenantIds())]
          : await defaultListGrantedTenantIds(loadCfg);
        const index = queryPlatformTaskIndex({
          cfg: loadCfg(),
          from,
          to,
          projectedAt,
          tenantId: params.tenantId,
          agentId: params.agentId,
          grantedTenantIds,
        });
        const fresh = await resolveDiagnosisProductionAuth(
          client as unknown as DiagnosisGatewayAuthClient,
          options.authDeps,
        );
        if (
          !fresh ||
          fresh.trusted.tenantId !== auth.trusted.tenantId ||
          fresh.principal.principalId !== auth.principal.principalId ||
          client.sessionDomain !== "platform" ||
          fresh.trusted.tenantId !== null ||
          !(client.connect.scopes ?? []).includes("operator.platform")
        ) {
          deny("unauthorized");
          return;
        }
        if (!index.ok) {
          deny(index.code);
          return;
        }
        respond(true, index, undefined);
        return;
      }
      const allowed = new Set([
        "agentId",
        "taskId",
        "outcomeVersion",
        "from",
        "to",
        "evidenceLookupWindow",
        "actionIntents",
        "capacity",
        "comparison",
        "reasoning",
      ]);
      if (
        Object.keys(params).some((k) => !allowed.has(k)) ||
        (params.capacity !== undefined && typeof params.capacity !== "boolean") ||
        typeof params.agentId !== "string" ||
        !params.agentId.trim() ||
        typeof params.taskId !== "string" ||
        !params.taskId.trim() ||
        typeof params.outcomeVersion !== "number" ||
        !Number.isSafeInteger(params.outcomeVersion) ||
        params.outcomeVersion < 1 ||
        typeof params.from !== "number" ||
        typeof params.to !== "number"
      ) {
        deny("invalid_params");
        return;
      }
      try {
        const projectedAt = (options.now ?? Date.now)();
        const rawLookup = params.evidenceLookupWindow;
        let evidenceLookupWindow: { from: number; to: number } | undefined;
        if (rawLookup !== undefined) {
          if (
            !rawLookup ||
            typeof rawLookup !== "object" ||
            Array.isArray(rawLookup) ||
            Object.keys(rawLookup).some((k) => k !== "from" && k !== "to")
          ) {
            deny("invalid_evidence_lookup_window");
            return;
          }
          const lookup = rawLookup as Record<string, unknown>;
          if (
            typeof lookup.from !== "number" ||
            typeof lookup.to !== "number" ||
            !Number.isFinite(lookup.from) ||
            !Number.isFinite(lookup.to) ||
            lookup.from >= lookup.to ||
            lookup.from > params.from ||
            lookup.to < params.to ||
            lookup.to - lookup.from > 30 * 86_400_000 ||
            lookup.to > projectedAt
          ) {
            deny("invalid_evidence_lookup_window");
            return;
          }
          evidenceLookupWindow = { from: lookup.from, to: lookup.to };
        }
        const rawIntents = params.actionIntents;
        let actionIntents:
          | { intentId?: string; revision?: number; limit?: number; cursor?: string }
          | undefined;
        if (rawIntents !== undefined) {
          if (
            !rawIntents ||
            typeof rawIntents !== "object" ||
            Array.isArray(rawIntents) ||
            Object.keys(rawIntents).some(
              (k) => !["intentId", "revision", "limit", "cursor"].includes(k),
            )
          ) {
            deny("invalid_action_intents");
            return;
          }
          const value = rawIntents as Record<string, unknown>;
          if (
            (value.intentId !== undefined &&
              (typeof value.intentId !== "string" || !value.intentId.trim())) ||
            (value.revision !== undefined &&
              (typeof value.revision !== "number" ||
                !Number.isSafeInteger(value.revision) ||
                value.revision < 0 ||
                !value.intentId)) ||
            (value.limit !== undefined &&
              (typeof value.limit !== "number" ||
                !Number.isSafeInteger(value.limit) ||
                value.limit < 1 ||
                value.limit > 100)) ||
            (value.cursor !== undefined &&
              (typeof value.cursor !== "string" || !value.cursor || value.cursor.length > 4096)) ||
            (value.intentId && (value.limit !== undefined || value.cursor !== undefined))
          ) {
            deny("invalid_action_intents");
            return;
          }
          actionIntents = value as typeof actionIntents;
        }
        const cfg = (options.loadConfig ?? loadConfig)();
        const caller = {
          subjectRef: normalizeTaskOutcomeSubjectRef(
            client.platformUserId?.trim() || auth.principal.principalId,
          ),
          tenantId: auth.trusted.tenantId,
        };
        const result = await queryObservationWithJournal({
          cfg,
          caller: {
            subjectRef: normalizeTaskOutcomeSubjectRef(
              client.platformUserId?.trim() || auth.principal.principalId,
            ),
            tenantId: auth.trusted.tenantId,
          },
          agentId: params.agentId,
          taskId: params.taskId,
          outcomeVersion: params.outcomeVersion,
          from: params.from,
          to: params.to,
          projectedAt,
          ...(evidenceLookupWindow ? { evidenceLookupWindow } : {}),
        });
        if (!result.ok) {
          deny(result.code);
          return;
        }
        let capacity: Awaited<ReturnType<ReturnType<typeof createCapacityReader>>> | undefined;
        if (params.capacity === true) {
          capacity = await (options.capacityReader ?? createCapacityReader())({
            cfg,
            caller,
            agentId: params.agentId,
            taskId: params.taskId,
            outcomeVersion: params.outcomeVersion,
            sampledAt: projectedAt,
            projectedAt,
            maxAgeMs: 60000,
          });
          const fresh = await resolveDiagnosisProductionAuth(
            client as unknown as DiagnosisGatewayAuthClient,
            options.authDeps,
          );
          if (
            !fresh ||
            fresh.trusted.tenantId !== auth.trusted.tenantId ||
            fresh.principal.principalId !== auth.principal.principalId
          ) {
            deny("unauthorized");
            return;
          }
          if (!capacity.ok) {
            deny(capacity.code);
            return;
          }
        }
        let comparison:
          | Awaited<ReturnType<ReturnType<typeof createMetricCompareGatewayHelper>>>
          | undefined;
        if (params.comparison !== undefined) {
          comparison = await createMetricCompareGatewayHelper({
            cfg,
            authDeps: options.authDeps,
            now: options.now,
          })(client, params.comparison);
          if (!comparison.ok) {
            deny(comparison.code);
            return;
          }
        }
        const finalAuth = async () => {
          const fresh = await resolveDiagnosisProductionAuth(
            client as unknown as DiagnosisGatewayAuthClient,
            options.authDeps,
          );
          const finalScopes = client.connect.scopes ?? [];
          return Boolean(
            fresh &&
            fresh.trusted.tenantId === auth.trusted.tenantId &&
            fresh.principal.principalId === auth.principal.principalId &&
            (finalScopes.includes("operator.read") || finalScopes.includes("operator.admin")),
          );
        };
        let reasoningPass;
        if (params.reasoning !== undefined) {
          const resolved =
            options.reasoning?.enabled && options.reasoningResolver
              ? options.reasoningResolver({
                  cfg,
                  agentId: params.agentId,
                  tenantId: caller.tenantId,
                  subjectRef: caller.subjectRef,
                  client,
                  authorize: finalAuth,
                })
              : undefined;
          const reasoning = await createReasoningGatewayAdapter({
            ...options.reasoning,
            ...resolved,
            authorize: async () =>
              (await finalAuth())
                ? {
                    identityRef: caller.subjectRef,
                    scopeRef: caller.tenantId ?? "",
                    grantVersion: JSON.stringify(client.connect.scopes ?? []),
                  }
                : null,
            readEvidence: async (): Promise<ReasoningInput> => ({
              evidence: result.samples.flatMap((sample) =>
                (["resource", "technical", "execution", "business"] as const).map((layer) => ({
                  evidenceId: sample.sampleId + ":" + layer,
                  layer,
                  status:
                    sample.evidence[layer] === "present"
                      ? "present"
                      : sample.evidence[layer] === "partial"
                        ? "partial"
                        : "unknown",
                  reasonCodes: sample.evidenceReasons[layer],
                })),
              ),
              findings: [],
            }),
          })(params.reasoning);
          if (!reasoning.ok) {
            deny(reasoning.code);
            return;
          }
          reasoningPass = reasoning.reasoningPass;
        }
        if (actionIntents) {
          const intents = await queryActionIntents(
            {
              cfg,
              caller,
              agentId: params.agentId,
              taskId: params.taskId,
              outcomeVersion: params.outcomeVersion,
              ...actionIntents,
            },
            options.actionIntentStore ??
              createActionIntentStore(path.join(CONFIG_DIR, "observation", "action-intents")),
          );
          const fresh = await resolveDiagnosisProductionAuth(
            client as unknown as DiagnosisGatewayAuthClient,
            options.authDeps,
          );
          if (
            !fresh ||
            fresh.trusted.tenantId !== auth.trusted.tenantId ||
            fresh.principal.principalId !== auth.principal.principalId
          ) {
            deny("unauthorized");
            return;
          }
          if (!intents.ok) {
            deny(intents.code);
            return;
          }
          if (!(await finalAuth())) {
            deny("unauthorized");
            return;
          }
          respond(
            true,
            {
              ...result,
              ...(capacity ? { capacity } : {}),
              ...(comparison ? { comparison } : {}),
              actionIntents: intents,
              ...(reasoningPass ? { reasoningPass } : {}),
            },
            undefined,
          );
          return;
        }
        if (!(await finalAuth())) {
          deny("unauthorized");
          return;
        }
        respond(
          true,
          {
            ...result,
            ...(capacity ? { capacity } : {}),
            ...(comparison ? { comparison } : {}),
            ...(reasoningPass ? { reasoningPass } : {}),
          },
          undefined,
        );
      } catch {
        deny("read_failed");
      }
    },
  };
}
