/**
 * cli-backend-usage-attribution.ts — per-run usage attribution for CLI backends
 * (cli-backend-onboarding Task 9 / R9.1, R9.2).
 *
 * Records WHO consumed WHICH credential on WHICH backend/model for a run, as the
 * basis for chargeback / cost-center / team billing. This is an AUDIT trail, not
 * a billing engine: it appends a structured, append-only JSONL record and does
 * NOT compute charges (token/credit accounting stays in the existing
 * `record-credit-usage` / `usage-ingest` path — R9.2, no parallel engine).
 *
 * SECURITY: the credential is recorded by its stable `credentialId` only — never
 * the SecretRef target or any resolved secret value.
 *
 * Persisted at `CONFIG_DIR/openbot-cli-backend-usage.jsonl`.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";

export interface UsageAttribution {
  tenantId: string;
  /** End user / seat / employee id (best-effort; may be the seat id). */
  userId: string;
  backendId: string;
  /** Credential id (never the secret value). */
  credentialId: string;
  model?: string;
  /** The run id (== runId / executionId). */
  executionId: string;
  occurredAt: string;
}

export function resolveDefaultCliBackendUsagePath(): string {
  return path.join(CONFIG_DIR, "openbot-cli-backend-usage.jsonl");
}

/**
 * Best-effort append of a usage-attribution record. Never throws: attribution is
 * an observability/billing-input side effect and must not affect the run.
 */
export async function recordCliBackendUsage(
  attribution: Omit<UsageAttribution, "occurredAt"> & { occurredAt?: string },
  opts?: { storePath?: string },
): Promise<void> {
  try {
    const record: UsageAttribution = {
      tenantId: attribution.tenantId,
      userId: attribution.userId,
      backendId: attribution.backendId,
      credentialId: attribution.credentialId,
      ...(attribution.model ? { model: attribution.model } : {}),
      executionId: attribution.executionId,
      occurredAt: attribution.occurredAt ?? new Date().toISOString(),
    };
    const resolvedPath = resolveUserPath(
      opts?.storePath?.trim() || resolveDefaultCliBackendUsagePath(),
    );
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await appendFile(resolvedPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // swallow: attribution must never break or delay a run.
  }
}

/**
 * Best-effort read of usage-attribution records from the append-only JSONL store.
 * Filters by optional tenant and executionId prefix (e.g. supervised taskId).
 */
export async function queryCliBackendUsage(
  opts: {
    tenantId?: string;
    executionIdPrefix?: string;
    limit?: number;
    storePath?: string;
  } = {},
): Promise<UsageAttribution[]> {
  const resolvedPath = resolveUserPath(
    opts.storePath?.trim() || resolveDefaultCliBackendUsagePath(),
  );
  const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : 200;
  const tenantId = opts.tenantId?.trim();
  const prefix = opts.executionIdPrefix?.trim();

  try {
    const raw = await readFile(resolvedPath, "utf8");
    const matches: UsageAttribution[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const rec = JSON.parse(trimmed) as UsageAttribution;
        if (tenantId && rec.tenantId !== tenantId) {
          continue;
        }
        if (prefix && !rec.executionId.startsWith(prefix)) {
          continue;
        }
        matches.push(rec);
      } catch {
        // skip malformed lines
      }
    }
    return matches.length > limit ? matches.slice(-limit) : matches;
  } catch {
    return [];
  }
}
