/**
 * Governance shadow decision sink (governance closure plan v1.0 §7.2, ADR-12).
 *
 * Writes only `CONFIG_DIR/audit/governance-shadow-decisions.jsonl`. It never writes the
 * management-governance or access-control decision streams and never calls
 * `auditManagementDecision`.
 *
 * Mirrors `access-control/audit-sink.ts`: 0o600 file inside a 0o700 directory,
 * best-effort append that never throws into the caller. Gated by
 * `OPENBOT_GOVERNANCE_SHADOW_LOG` (default off). With the flag off nothing is written.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { isTruthyEnvValue } from "../../infra/env.js";
import { CONFIG_DIR } from "../../utils.js";
import type { GovernanceDecision } from "./decision.js";

export const GOVERNANCE_SHADOW_LOG_ENV = "OPENBOT_GOVERNANCE_SHADOW_LOG";
export const GOVERNANCE_SHADOW_DECISIONS_FILE = "governance-shadow-decisions.jsonl";

export function isGovernanceShadowLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[GOVERNANCE_SHADOW_LOG_ENV]);
}

export function governanceShadowDecisionsPath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "audit", GOVERNANCE_SHADOW_DECISIONS_FILE);
}

/**
 * Best-effort append. Resolves `true` when a line was written, `false` when the flag is
 * off or the write failed. Never rejects: a shadow log failure must not change a run.
 */
export async function appendGovernanceShadowDecision(
  decision: GovernanceDecision,
  opts?: { env?: NodeJS.ProcessEnv; configDir?: string },
): Promise<boolean> {
  if (!isGovernanceShadowLogEnabled(opts?.env)) {
    return false;
  }
  try {
    const filePath = governanceShadowDecisionsPath(opts?.configDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.appendFile(filePath, `${JSON.stringify(decision)}\n`, { mode: 0o600 });
    return true;
  } catch (error) {
    console.warn(
      `[governance] failed to write ${GOVERNANCE_SHADOW_DECISIONS_FILE}: ${String(error)}`,
    );
    return false;
  }
}
