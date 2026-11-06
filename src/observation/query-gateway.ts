/** Thin read-only adapter; method registration belongs to the diagnosis pack. */
import { loadConfig, type OpenBotConfig } from "../config/config.js";
import {
  resolveDiagnosisProductionAuth,
  type DiagnosisGatewayAuthDeps,
  type DiagnosisGatewayAuthClient,
} from "../diagnosis/report-query-gateway.js";
import { ErrorCodes, errorShape } from "../gateway/protocol/index.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import { normalizeTaskOutcomeSubjectRef } from "../task-outcome/subject-ref.js";
import { queryObservation } from "./query.js";
export const OBSERVATION_QUERY_METHOD = "diagnosis.observation.query";
export function createObservationQueryHandlers(
  options: {
    authDeps?: DiagnosisGatewayAuthDeps;
    loadConfig?: () => OpenBotConfig;
    now?: () => number;
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
      const allowed = new Set([
        "agentId",
        "taskId",
        "outcomeVersion",
        "from",
        "to",
        "evidenceLookupWindow",
      ]);
      if (
        Object.keys(params).some((k) => !allowed.has(k)) ||
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
        const result = queryObservation({
          cfg: (options.loadConfig ?? loadConfig)(),
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
        respond(true, result, undefined);
      } catch {
        deny("read_failed");
      }
    },
  };
}
