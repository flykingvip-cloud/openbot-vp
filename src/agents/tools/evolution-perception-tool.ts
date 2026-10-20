import { EVOLUTION_TIMELINE_INTENTS, type EvolutionTriggerSighting } from "@openbot/evolution-core";
/**
 * Da Bai read-only evolution perception tool.
 * Binds §4 intents to the evolution-core projections. Tenant scope is the
 * trusted session, never a tool argument. Does not write Ledger or Apply.
 */
import { Type } from "@sinclair/typebox";
import {
  EVOLUTION_PERCEPTION_PROJECT_OPERATIONS,
  EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
  readEvolutionPerceptionSnapshot,
  runEvolutionPerceptionProject,
  runEvolutionPerceptionQuery,
  type EvolutionPerceptionWindow,
} from "../../gateway/evolution-control/perception-runtime.js";
import { stringEnum } from "../schema/typebox.js";
import { asToolParams, jsonResult, type AnyAgentTool } from "./common.js";

const EvolutionPerceptionToolSchema = Type.Object({
  operation: Type.Optional(
    stringEnum(["query", ...EVOLUTION_PERCEPTION_PROJECT_OPERATIONS], {
      description:
        "query runs a §4 intent. Other values project timeline, digest, pending, automatic, observation, delivery, or triggers.",
    }),
  ),
  intent: Type.Optional(
    stringEnum(EVOLUTION_TIMELINE_INTENTS, {
      description:
        "learned_this_week, diff_from_last_week, automatic, user_approved, observing, rolled_back, or platform_upgrades_this_week.",
    }),
  ),
  window: Type.Optional(
    Type.Object({
      from: Type.String({ description: "Inclusive window start (ISO-8601)." }),
      to: Type.String({ description: "Inclusive window end (ISO-8601)." }),
    }),
  ),
  agentId: Type.Optional(
    Type.String({
      description:
        "Optional digital-human filter inside the trusted tenant. Omit for the whole tenant.",
    }),
  ),
  sightings: Type.Optional(
    Type.Array(
      Type.Object({
        kind: Type.String(),
        tenantScope: Type.Optional(Type.String()),
        targetKey: Type.String(),
        reasonCode: Type.String(),
        observedAt: Type.String(),
        factId: Type.String(),
        everyMs: Type.Optional(Type.Number()),
        suppressedUntil: Type.Optional(Type.String()),
        proposalSchema: Type.Optional(Type.Number()),
        legacy: Type.Optional(Type.Boolean()),
      }),
      { description: "Caller-supplied trigger sightings to classify. They are not stored." },
    ),
  ),
});

export function createEvolutionPerceptionTool(options?: {
  tenantId?: string;
  gatewayClientSessionEnterpriseId?: string;
}): AnyAgentTool {
  return {
    name: "evolution_perception",
    label: "Evolution perception",
    description:
      "只读进化履历。按租户会话回答本周学会了什么、相对上周、自动、批准、观察中、回滚、平台升级。结果只能来自已有事实 id。不要编造「学会了」。不要写入 Ledger，不要 Apply，不要把平台 system 变化说成数字人学会了。",
    parameters: EvolutionPerceptionToolSchema,
    execute: async (_toolCallId, args) => {
      const params = asToolParams(args);
      const tenant = resolveToolTenant(options);
      const operation = typeof params.operation === "string" ? params.operation.trim() : "query";
      const window = readWindow(params.window);
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
      const intent = typeof params.intent === "string" ? params.intent : "";
      if (!tenant.ok) {
        return jsonResult({
          access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
          operation: operation || "query",
          persisted: false,
          denial: { denied: true, reason: "permission_denied" },
          result: null,
          narration: null,
          narrationGuard: null,
        });
      }
      const snapshot = readEvolutionPerceptionSnapshot();
      if (operation === "" || operation === "query") {
        return jsonResult(
          runEvolutionPerceptionQuery({
            snapshot,
            tenantScope: tenant.tenantScope,
            agentId: agentId || undefined,
            window,
            intent,
          }),
        );
      }
      const projected = runEvolutionPerceptionProject({
        snapshot,
        tenantScope: tenant.tenantScope,
        agentId: agentId || undefined,
        window,
        operation,
        sightings: readSightings(params.sightings),
      });
      if (projected.denied) {
        return jsonResult({
          access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
          operation,
          persisted: false,
          denial: projected.denial,
          projection: null,
        });
      }
      if ("unknownOperation" in projected) {
        return jsonResult({
          access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
          operation,
          persisted: false,
          ok: false,
          reason: "unknown_operation",
          projection: null,
        });
      }
      return jsonResult({
        access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
        operation: projected.operation,
        persisted: false,
        projection: projected.projection,
      });
    },
  };
}

function resolveToolTenant(options?: {
  tenantId?: string;
  gatewayClientSessionEnterpriseId?: string;
}): { ok: true; tenantScope: string } | { ok: false } {
  const enterprise = options?.gatewayClientSessionEnterpriseId?.trim() ?? "";
  const tenant = options?.tenantId?.trim() ?? "";
  if (enterprise && tenant && enterprise !== tenant) {
    return { ok: false };
  }
  const tenantScope = enterprise || tenant;
  if (!tenantScope) {
    return { ok: false };
  }
  return { ok: true, tenantScope };
}

function readWindow(value: unknown): EvolutionPerceptionWindow | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const from = (value as { from?: unknown }).from;
  const to = (value as { to?: unknown }).to;
  if (typeof from !== "string" || typeof to !== "string") {
    return undefined;
  }
  return { from, to };
}

function readSightings(value: unknown): EvolutionTriggerSighting[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.kind !== "string" ||
      typeof row.targetKey !== "string" ||
      typeof row.reasonCode !== "string" ||
      typeof row.observedAt !== "string" ||
      typeof row.factId !== "string"
    ) {
      return [];
    }
    return [
      {
        kind: row.kind,
        tenantScope: typeof row.tenantScope === "string" ? row.tenantScope : null,
        targetKey: row.targetKey,
        reasonCode: row.reasonCode,
        observedAt: row.observedAt,
        factId: row.factId,
        ...(typeof row.everyMs === "number" ? { everyMs: row.everyMs } : {}),
        ...(typeof row.suppressedUntil === "string"
          ? { suppressedUntil: row.suppressedUntil }
          : {}),
        ...(row.proposalSchema === 1 || row.proposalSchema === 2
          ? { proposalSchema: row.proposalSchema }
          : {}),
        ...(typeof row.legacy === "boolean" ? { legacy: row.legacy } : {}),
      },
    ];
  });
}
