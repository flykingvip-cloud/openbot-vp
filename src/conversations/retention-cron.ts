/**
 * System cron registration + tick for conversation retention / cold migration.
 * Supports local plane and enterprise managed multi-tenant planes.
 */
import type { OpenBotConfig } from "../config/config.js";
import { isManagedDataMode } from "../config/data-space.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { SqliteConversationCatalog } from "./catalog/sqlite-catalog.js";
import { resolveConversationFlags } from "./flags.js";
import {
  buildSystemPlaneContext,
  listRetentionPlaneTargets,
  type ManagedPlaneTarget,
} from "./managed-planes.js";
import { resolveCatalogPathForPlane } from "./managed-planes.js";

const log = createSubsystemLogger("conversations/retention-cron");

export const RETENTION_CRON_JOB_NAME = "openbot.conversation.retention";
/** Payload text recognized by gateway cron wrapper. */
export const RETENTION_CRON_TICK_TEXT = "OPENBOT_CONVERSATION_RETENTION_TICK";
/** Default interval: 6 hours */
export const RETENTION_CRON_DEFAULT_EVERY_MS = 6 * 60 * 60 * 1000;

export type RetentionPlaneTickResult = {
  tenantId: string | null;
  dataPlaneId: string;
  dataRoot: string;
  ok: boolean;
  evaluated: number;
  mutated: number;
  coldMigrated: number;
  coldFailed: number;
  error?: string;
};

export type RetentionCronTickResult = {
  ok: boolean;
  /** Aggregate across all planes. */
  evaluated: number;
  mutated: number;
  coldMigrated: number;
  coldFailed: number;
  planes: RetentionPlaneTickResult[];
  skippedReason?: string;
  error?: string;
};

export function isRetentionCronTickText(text: string | undefined | null): boolean {
  return (text?.trim() ?? "") === RETENTION_CRON_TICK_TEXT;
}

/**
 * Ensure the system retention cron job exists (idempotent by name).
 */
export async function ensureConversationRetentionCronJob(params: {
  cron: {
    list?: (opts?: {
      includeDisabled?: boolean;
    }) =>
      | Array<{ id: string; name?: string; enabled?: boolean }>
      | Promise<Array<{ id: string; name?: string; enabled?: boolean }>>;
    add: (input: {
      name: string;
      enabled: boolean;
      schedule: { kind: "every"; everyMs: number };
      sessionTarget: "main";
      wakeMode: "next-heartbeat";
      payload: { kind: "systemEvent"; text: string };
      description?: string;
    }) => Promise<{ id: string; name?: string }>;
  };
  everyMs?: number;
  enabled?: boolean;
}): Promise<{ created: boolean; jobId?: string; existingId?: string }> {
  const everyMs = Math.max(60_000, params.everyMs ?? RETENTION_CRON_DEFAULT_EVERY_MS);
  try {
    const jobs = params.cron.list ? await params.cron.list({ includeDisabled: true }) : [];
    const existing = jobs.find((j) => j.name === RETENTION_CRON_JOB_NAME);
    if (existing) {
      return { created: false, existingId: existing.id };
    }
    const job = await params.cron.add({
      name: RETENTION_CRON_JOB_NAME,
      enabled: params.enabled !== false,
      schedule: { kind: "every", everyMs },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: RETENTION_CRON_TICK_TEXT },
      description:
        "OpenBot conversation retention scan + cold migration (local + managed tenant planes)",
    });
    log.info(`registered retention cron job id=${job.id} everyMs=${everyMs}`);
    return { created: true, jobId: job.id };
  } catch (err) {
    log.warn(`ensure retention cron failed: ${String(err)}`);
    return { created: false };
  }
}

async function runRetentionOnPlane(params: {
  cfg: OpenBotConfig;
  plane: ManagedPlaneTarget;
  enforce: boolean;
  migrateCold: boolean;
  limit: number;
}): Promise<RetentionPlaneTickResult> {
  const base: RetentionPlaneTickResult = {
    tenantId: params.plane.tenantId,
    dataPlaneId: params.plane.dataPlaneId,
    dataRoot: params.plane.dataRoot,
    ok: false,
    evaluated: 0,
    mutated: 0,
    coldMigrated: 0,
    coldFailed: 0,
  };
  try {
    const ctx = buildSystemPlaneContext({
      cfg: params.cfg,
      tenantId: params.plane.tenantId,
      mode: params.plane.mode,
    });
    // Ensure system ctx dataPlaneId matches plane (managed multi-tenant).
    const planeCtx = {
      ...ctx,
      dataPlaneId: params.plane.dataPlaneId,
      tenantId: params.plane.tenantId,
      mode: params.plane.mode,
    };

    const catalogPath = resolveCatalogPathForPlane({
      dataRoot: params.plane.dataRoot,
      mode: params.plane.mode,
      tenantId: params.plane.tenantId,
    });
    const catalog = new SqliteConversationCatalog({ path: catalogPath });
    try {
      // Per-tenant rollout: enforce only when this plane's tenant is in canary.
      const planeFlags = resolveConversationFlags(params.cfg, {
        tenantId: params.plane.tenantId,
      });
      const enforce = params.enforce && planeFlags.retentionEnforceEnabled;
      const migrateCold = params.migrateCold && planeFlags.retentionEnforceEnabled;
      const { runRetentionScan } = await import("./service.js");
      // Temporarily inject catalog via deps so we don't depend on global cfg data root.
      const result = await runRetentionScan({
        deps: {
          cfg: params.cfg,
          ctx: planeCtx,
          catalog,
          dataRoot: params.plane.dataRoot,
        },
        enforce,
        migrateCold,
        limit: params.limit,
      });
      return {
        ...base,
        ok: true,
        evaluated: result.evaluated.length,
        mutated: result.mutated,
        coldMigrated: result.cold?.migrated ?? 0,
        coldFailed: result.cold?.failed ?? 0,
      };
    } finally {
      catalog.close?.();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`retention plane tick failed tenant=${params.plane.tenantId ?? "local"}: ${message}`);
    return { ...base, ok: false, error: message };
  }
}

/**
 * Execute retention across all discovered planes (local or managed tenants).
 */
export async function runConversationRetentionCronTick(params: {
  cfg: OpenBotConfig;
  enforce?: boolean;
  migrateCold?: boolean;
  limit?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<RetentionCronTickResult> {
  try {
    // Global default; per-plane enforce re-checked with tenant subject below.
    const flags = resolveConversationFlags(params.cfg);
    const enforce = params.enforce ?? flags.retentionEnforceEnabled;
    const migrateCold = params.migrateCold ?? enforce;
    const limit = params.limit ?? 200;
    const env = params.env ?? process.env;

    const planes = listRetentionPlaneTargets({ cfg: params.cfg, env });
    if (planes.length === 0) {
      const reason = isManagedDataMode(params.cfg) ? "no_managed_tenants_discovered" : "no_planes";
      log.warn(`retention cron tick skipped: ${reason}`);
      return {
        ok: false,
        evaluated: 0,
        mutated: 0,
        coldMigrated: 0,
        coldFailed: 0,
        planes: [],
        skippedReason: reason,
        error: reason,
      };
    }

    const planeResults: RetentionPlaneTickResult[] = [];
    for (const plane of planes) {
      const result = await runRetentionOnPlane({
        cfg: params.cfg,
        plane,
        enforce,
        migrateCold,
        limit,
      });
      planeResults.push(result);
    }

    const evaluated = planeResults.reduce((s, p) => s + p.evaluated, 0);
    const mutated = planeResults.reduce((s, p) => s + p.mutated, 0);
    const coldMigrated = planeResults.reduce((s, p) => s + p.coldMigrated, 0);
    const coldFailed = planeResults.reduce((s, p) => s + p.coldFailed, 0);
    const anyOk = planeResults.some((p) => p.ok);
    const allFailed = planeResults.every((p) => !p.ok);

    log.info(
      `retention cron tick planes=${planes.length} evaluated=${evaluated} mutated=${mutated} coldMigrated=${coldMigrated} mode=${isManagedDataMode(params.cfg) ? "managed" : "local"}`,
    );

    return {
      ok: anyOk && !allFailed,
      evaluated,
      mutated,
      coldMigrated,
      coldFailed,
      planes: planeResults,
      error: allFailed
        ? planeResults
            .map((p) => p.error)
            .filter(Boolean)
            .join("; ") || "all_planes_failed"
        : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`retention cron tick failed: ${message}`);
    return {
      ok: false,
      evaluated: 0,
      mutated: 0,
      coldMigrated: 0,
      coldFailed: 0,
      planes: [],
      error: message,
    };
  }
}

/**
 * Intercept systemEvent text from cron and run retention if matched.
 */
export async function maybeHandleRetentionCronSystemEvent(params: {
  text: string;
  cfg: OpenBotConfig;
}): Promise<RetentionCronTickResult | null> {
  if (!isRetentionCronTickText(params.text)) {
    return null;
  }
  return runConversationRetentionCronTick({ cfg: params.cfg });
}
