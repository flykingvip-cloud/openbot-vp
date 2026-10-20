/**
 * Read-only evolution perception RPC.
 * Tenant scope comes from the trusted session. The body cannot supply facts,
 * and these methods do not append Ledger events or Apply.
 */

import type { EvolutionTriggerSighting } from "@openbot/evolution-core";
import {
  readEvolutionPerceptionSnapshot,
  runEvolutionPerceptionProject,
  runEvolutionPerceptionQuery,
  EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
  type EvolutionPerceptionWindow,
} from "../evolution-control/perception-runtime.js";
import { applyEvolutionRpcTestIdentity } from "../evolution-control/rpc-test-identity.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

function trustedTenantId(client: GatewayClient | null): string | null {
  applyEvolutionRpcTestIdentity(client);
  const enterprise = client?.sessionEnterpriseId?.trim();
  if (enterprise) {
    return enterprise;
  }
  const tenant = client?.sessionTenantId?.trim();
  return tenant || null;
}

function readWindow(params: Record<string, unknown>): EvolutionPerceptionWindow | undefined {
  const window = params.window;
  if (!window || typeof window !== "object") {
    return undefined;
  }
  const from = (window as { from?: unknown }).from;
  const to = (window as { to?: unknown }).to;
  if (typeof from !== "string" || typeof to !== "string") {
    return undefined;
  }
  return { from, to };
}

function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readSightings(value: unknown): EvolutionTriggerSighting[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sightings: EvolutionTriggerSighting[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.kind !== "string" ||
      typeof row.targetKey !== "string" ||
      typeof row.reasonCode !== "string" ||
      typeof row.observedAt !== "string" ||
      typeof row.factId !== "string"
    ) {
      continue;
    }
    const sighting: EvolutionTriggerSighting = {
      kind: row.kind,
      tenantScope: typeof row.tenantScope === "string" ? row.tenantScope : null,
      targetKey: row.targetKey,
      reasonCode: row.reasonCode,
      observedAt: row.observedAt,
      factId: row.factId,
    };
    if (typeof row.everyMs === "number") {
      sighting.everyMs = row.everyMs;
    }
    if (typeof row.suppressedUntil === "string") {
      sighting.suppressedUntil = row.suppressedUntil;
    }
    if (row.proposalSchema === 1 || row.proposalSchema === 2) {
      sighting.proposalSchema = row.proposalSchema;
    }
    if (typeof row.legacy === "boolean") {
      sighting.legacy = row.legacy;
    }
    sightings.push(sighting);
  }
  return sightings;
}

export const evolutionPerceptionHandlers: GatewayRequestHandlers = {
  "evolution.perception.query": async ({ params, respond, client }) => {
    const response = runEvolutionPerceptionQuery({
      snapshot: readEvolutionPerceptionSnapshot(),
      tenantScope: trustedTenantId(client),
      claimedTenantScope: readOptionalString(params, "tenantScope"),
      agentId: readOptionalString(params, "agentId"),
      window: readWindow(params),
      intent: typeof params.intent === "string" ? params.intent : "",
    });
    respond(true, response);
  },
  "evolution.perception.project": async ({ params, respond, client }) => {
    const operation = typeof params.operation === "string" ? params.operation.trim() : "";
    const projected = runEvolutionPerceptionProject({
      snapshot: readEvolutionPerceptionSnapshot(),
      tenantScope: trustedTenantId(client),
      claimedTenantScope: readOptionalString(params, "tenantScope"),
      agentId: readOptionalString(params, "agentId"),
      window: readWindow(params),
      operation,
      sightings: readSightings(params.sightings),
    });
    if (projected.denied) {
      respond(true, {
        access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
        operation,
        persisted: false,
        denial: projected.denial,
        projection: null,
      });
      return;
    }
    if ("unknownOperation" in projected) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "unknown evolution perception operation"),
      );
      return;
    }
    respond(true, {
      access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
      operation: projected.operation,
      persisted: false,
      projection: projected.projection,
    });
  },
};
