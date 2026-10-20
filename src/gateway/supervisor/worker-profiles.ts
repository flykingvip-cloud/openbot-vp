/**
 * supervisor/worker-profiles.ts — recommended credential + placement defaults per worker.
 *
 * Static capability lives on CliBackendConfig.worker; runtime identity/placement
 * are resolved per run into ExecutionContext (see design D-EXECCTX).
 */

import type { CredentialPolicy, ExecutionPlacement } from "../../fabric/worker/types.js";

export type WorkerExecutionProfile = {
  credentialPolicy: CredentialPolicy;
  executionPlacement: ExecutionPlacement;
};

const LOCAL_IDE_WORKER_IDS = new Set([
  "cursor-cli",
  "devin-cli",
  "windsurf-cli",
  "grok-cli",
  "kiro-cli",
  "trae-cli",
]);

/** Recommended execution profile until tenant-scoped policy config lands. */
export function defaultWorkerExecutionProfile(workerId: string): WorkerExecutionProfile {
  const normalized = workerId.trim().toLowerCase();
  if (LOCAL_IDE_WORKER_IDS.has(normalized)) {
    return { credentialPolicy: "local_ide_login", executionPlacement: "node_agent" };
  }
  return { credentialPolicy: "enterprise_shared", executionPlacement: "gateway" };
}

/** @deprecated Prefer getWorkerExecutionProfile({ tenantId, workerId }) for tenant overrides. */
export function resolveWorkerExecutionProfile(workerId: string): WorkerExecutionProfile {
  return defaultWorkerExecutionProfile(workerId);
}
