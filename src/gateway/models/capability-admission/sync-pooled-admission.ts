/**
 * Fill a missing platform admission row for a model the admin already pooled
 * and whose latest probe succeeded.
 *
 * Pool membership (`agents.defaults.models`) and connection health are not the
 * admission store. Live chat fail-closes on a missing row (`no_admission_record`)
 * even when the model is allowlisted and the probe is `ok`. This sync writes
 * `autoRouting: eligible` only when no row exists. An admin pause / disable is
 * left untouched. Models outside the caller's platform scope are not given a
 * row, so an unscoped model is not pulled into capability checks.
 */

import type { OpenBotConfig } from "../../../config/types.js";
import { loadConnectedPlatformModelIds } from "../load-connected-platform-model-ids.js";
import {
  isEnterpriseSuppliedModelId,
  retainPlatformPoolMembers,
} from "../platform-model-connection.js";
import { insertModelAdmissionIfAbsent, readStoredModelAdmissions } from "./store.js";

export const POOLED_HEALTHY_ADMISSION_REASON = "已入池且连接健康，同步为可执行准入";

function providerOfModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : "";
}

/** Allowlist entries whose provider is still configured. That is the 入池 set. */
export function listAllowlistedPoolModelIds(cfg: OpenBotConfig | undefined): Set<string> {
  const providers = new Set(Object.keys(cfg?.models?.providers ?? {}));
  const pool = new Set<string>();
  const allowlisted = cfg?.agents?.defaults?.models;
  if (!allowlisted || typeof allowlisted !== "object") {
    return pool;
  }
  for (const key of Object.keys(allowlisted)) {
    const id = key.trim();
    const provider = providerOfModelId(id);
    if (id && provider && providers.has(provider)) {
      pool.add(id);
    }
  }
  return pool;
}

/**
 * Allowlisted models with a recorded probe status of `ok`.
 * Catalog membership alone is not treated as healthy here: an explicit platform
 * model without `ok` stays unadmitted until a real probe succeeds.
 */
export async function listAllowlistedProbeOkModelIds(params: {
  cfg: OpenBotConfig | undefined;
  probeStorePath?: string;
}): Promise<Set<string>> {
  const connected = await loadConnectedPlatformModelIds({
    cfg: params.cfg,
    probeStorePath: params.probeStorePath,
  });
  return retainPlatformPoolMembers(connected, listAllowlistedPoolModelIds(params.cfg));
}

export async function ensureExecutableAdmissionForAllowlistedConnections(params: {
  cfg: OpenBotConfig | undefined;
  storePath?: string;
  probeStorePath?: string;
  /** When set, only these ids may gain a row. */
  limitToModelIds?: ReadonlySet<string>;
  personalByokModelIds?: readonly string[];
}): Promise<string[]> {
  const visible = await listAllowlistedProbeOkModelIds(params);
  const personal = new Set(
    (params.personalByokModelIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const records = await readStoredModelAdmissions(params.storePath);
  const written: string[] = [];
  for (const id of [...visible].toSorted((a, b) => a.localeCompare(b))) {
    if (params.limitToModelIds && !params.limitToModelIds.has(id)) {
      continue;
    }
    if (!id || personal.has(id) || isEnterpriseSuppliedModelId(id) || records[id]) {
      continue;
    }
    const inserted = await insertModelAdmissionIfAbsent(
      id,
      {
        autoRouting: "eligible",
        autoRoutingReason: POOLED_HEALTHY_ADMISSION_REASON,
        tenantSelectable: false,
      },
      params.storePath,
    );
    if (inserted.created) {
      written.push(id);
    }
  }
  return written;
}
