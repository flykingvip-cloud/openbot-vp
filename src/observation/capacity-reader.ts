/** Read-only raw-source adapter. Never repairs registries or supplies credit fallbacks. */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { OpenBotConfig } from "../config/config.js";
import { DEFAULT_AGENT_RUN_STALE_MS } from "../gateway/billing/agent-run-registry.js";
import { CONFIG_DIR } from "../utils.js";
import { buildCapacitySnapshot, type CapacityInput } from "./capacity-snapshot.js";
import { readOutcomeMetadata } from "./outcome-reader.js";
const text = z.string().trim().min(1);
const date = text.refine((v) => Number.isFinite(Date.parse(v)));
const registrySchema = z.object({
  version: z.literal(1),
  runs: z.record(
    z.string(),
    z.object({ runId: text, enterpriseId: text, startedAt: date, finishedAt: date.optional() }),
  ),
});
const snapshotsSchema = z.object({
  version: z.literal(1),
  activeByEnterprise: z.record(z.string(), text),
  snapshots: z.record(
    z.string(),
    z.object({
      id: text,
      enterpriseId: text,
      subscriptionId: text,
      planVersionId: text,
      effectiveAt: date,
      expiresAt: date.optional(),
      entitlementSnapshot: z.object({
        maxConcurrentRuns: z.number().finite().int().nonnegative(),
        concurrencyPolicy: z
          .object({
            includedRuns: z.number().finite().int().nonnegative(),
            maxBurstRuns: z.number().finite().int().nonnegative(),
            mode: z.enum(["block", "queue", "pay_as_you_go"]),
          })
          .optional(),
      }),
    }),
  ),
});
const subscriptionSchema = z.object({
  version: z.literal(1),
  subscriptions: z.record(
    z.string(),
    z.object({
      id: text,
      enterpriseId: text,
      planVersionId: text,
      status: text,
      startTime: date,
      endTime: date.nullable(),
    }),
  ),
});
async function raw(
  file: string,
): Promise<{ state: "readable"; value: unknown } | { state: "missing" | "corrupt" }> {
  try {
    return { state: "readable", value: JSON.parse(await fs.readFile(file, "utf8")) as unknown };
  } catch (error) {
    return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "corrupt" };
  }
}
/** configDir is a server composition-root option, never a request parameter. */
export function createCapacityReader(configDir: string = CONFIG_DIR) {
  return async (input: {
    cfg: OpenBotConfig;
    caller: { subjectRef: string; tenantId?: string | null };
    agentId: string;
    taskId: string;
    outcomeVersion: number;
    sampledAt: number;
    projectedAt: number;
    maxAgeMs: number;
    staleRunMs?: number;
  }) => {
    const authorize = () =>
      readOutcomeMetadata({
        cfg: input.cfg,
        agentId: input.agentId,
        taskId: input.taskId,
        outcomeVersion: input.outcomeVersion,
        callerSubjectRef: input.caller.subjectRef,
        callerTenantId: input.caller.tenantId,
      });
    const auth = authorize();
    if (!auth.ok) {
      return auth;
    }
    if (auth.outcome.scope.kind !== "enterprise") {
      return { ok: false as const, code: "capacity_enterprise_scope_required" as const };
    }
    if (
      !Number.isFinite(input.sampledAt) ||
      input.sampledAt > input.projectedAt ||
      !Number.isFinite(input.staleRunMs ?? DEFAULT_AGENT_RUN_STALE_MS) ||
      (input.staleRunMs ?? DEFAULT_AGENT_RUN_STALE_MS) <= 0
    ) {
      return { ok: false as const, code: "invalid_capacity_clock" as const };
    }
    const tenant = auth.outcome.scope.tenantId;
    const [runFile, snapshotFile, subscriptionFile] = await Promise.all([
      raw(path.join(configDir, "openbot-agent-run-registry.json")),
      raw(path.join(configDir, "openbot-subscription-runtime-snapshots.json")),
      raw(path.join(configDir, "openbot-billing-subscriptions.json")),
    ]);
    const registry = runFile.state === "readable" ? registrySchema.safeParse(runFile.value) : null;
    const runState =
      runFile.state !== "readable" ? runFile.state : registry?.success ? "readable" : "corrupt";
    const rows = registry?.success ? Object.entries(registry.data.runs) : [];
    const validRows = rows.every(
      ([id, r]) =>
        id === r.runId &&
        Date.parse(r.startedAt) <= input.sampledAt &&
        (r.finishedAt === undefined ||
          (Date.parse(r.finishedAt) >= Date.parse(r.startedAt) &&
            Date.parse(r.finishedAt) <= input.sampledAt)),
    );
    const active = validRows
      ? rows
          .map(([, r]) => r)
          .filter((r) => r.enterpriseId === tenant && r.finishedAt === undefined)
      : [];
    const snapshots =
      snapshotFile.state === "readable" ? snapshotsSchema.safeParse(snapshotFile.value) : null;
    const subscriptions =
      subscriptionFile.state === "readable"
        ? subscriptionSchema.safeParse(subscriptionFile.value)
        : null;
    const snapshot = snapshots?.success
      ? snapshots.data.snapshots[snapshots.data.activeByEnterprise[tenant]]
      : undefined;
    const subscription =
      subscriptions?.success && snapshot
        ? subscriptions.data.subscriptions[snapshot.subscriptionId]
        : undefined;
    const activeSnapshot = Boolean(
      snapshot &&
      subscription &&
      snapshot.enterpriseId === tenant &&
      subscription.enterpriseId === tenant &&
      subscription.id === snapshot.subscriptionId &&
      subscription.planVersionId === snapshot.planVersionId &&
      subscription.status === "active" &&
      Date.parse(subscription.startTime) <= input.sampledAt &&
      (subscription.endTime === null || Date.parse(subscription.endTime) > input.sampledAt) &&
      Date.parse(snapshot.effectiveAt) <= input.sampledAt &&
      (!snapshot.expiresAt || Date.parse(snapshot.expiresAt) > input.sampledAt),
    );
    const source = { scopeRef: tenant, sampledAt: input.sampledAt, provenance: "unknown" as const };
    const collected: CapacityInput = {
      scopeRef: tenant,
      projectedAt: input.projectedAt,
      maxAgeMs: input.maxAgeMs,
      registry: {
        ...source,
        sourceRef: "agent-run-registry",
        state: validRows ? runState : "corrupt",
        complete: runState === "readable" && validRows,
        activeRuns: runState === "readable" && validRows ? active.length : null,
        staleRunCount:
          runState === "readable" && validRows
            ? active.filter(
                (r) =>
                  input.sampledAt - Date.parse(r.startedAt) >=
                  (input.staleRunMs ?? DEFAULT_AGENT_RUN_STALE_MS),
              ).length
            : null,
      },
      ...(activeSnapshot && snapshot
        ? {
            entitlement: {
              ...source,
              sourceRef: "subscription-runtime-snapshot",
              version: snapshot.id,
              maxConcurrentRuns: snapshot.entitlementSnapshot.maxConcurrentRuns,
              mode: snapshot.entitlementSnapshot.concurrencyPolicy?.mode ?? "unknown",
            },
          }
        : {}),
    };
    const fresh = authorize();
    if (!fresh.ok) {
      return fresh;
    }
    if (JSON.stringify(fresh.outcome.scope) !== JSON.stringify(auth.outcome.scope)) {
      return { ok: false as const, code: "scope_changed" as const };
    }
    return {
      ok: true as const,
      snapshot: buildCapacitySnapshot(collected),
      sources: {
        registry: { state: collected.registry!.state, provenance: "unknown" as const },
        entitlement: {
          state: activeSnapshot ? ("readable" as const) : ("unknown" as const),
          provenance: "unknown" as const,
        },
        quota: { state: "unknown" as const, reason: "authoritative_balance_not_collected" },
      },
      reasons: [
        "raw_sources_have_no_provenance_proof",
        "no_continuous_health_or_heartbeat_source",
        ...(!activeSnapshot ? ["active_entitlement_missing_invalid_or_expired"] : []),
      ],
    };
  };
}
