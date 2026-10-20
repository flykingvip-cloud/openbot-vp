/**
 * cli-backend-worker.ts — bridge a configured CLI backend into a Fabric Worker
 * (development-supervisor M0, Task 0.4).
 *
 * Builds the Worker-surface for a cli-backend from its additive `worker` metadata
 * (`taskCapabilities`/`control`/…). When a backend declares no `worker` block it is
 * model-surface only and this returns null (back-compat — the existing direct-chat
 * `<backendId>/<model>` path is unaffected).
 *
 * The CLI execution boundary (`runCli`) is INJECTED so this stays testable and the
 * model surface stays untouched; wiring binds the default to `runCliAgent` (M1).
 */

import type { OpenBotConfig } from "../config/config.js";
import { createCliWorker, type CliRunFn } from "../fabric/worker/cli-worker.js";
import type {
  Worker,
  WorkerControlCapability,
  WorkerTaskCapability,
} from "../fabric/worker/types.js";
import { resolveCliBackendConfig } from "./cli-backends.js";

/**
 * Build a `Worker` for backend `backendId`, or null when the backend is unknown
 * or declares no `worker` metadata (model-surface only). `runCli` is the injected
 * CLI execution boundary.
 */
export function createWorkerFromBackend(
  cfg: OpenBotConfig | undefined,
  backendId: string,
  runCli: CliRunFn,
): Worker | null {
  const resolved = resolveCliBackendConfig(backendId, cfg);
  const worker = resolved?.config.worker;
  if (!resolved || !worker) {
    return null;
  }
  return createCliWorker({
    id: resolved.id,
    taskCapabilities: (worker.taskCapabilities ?? []) as WorkerTaskCapability[],
    control: (worker.control ?? []) as WorkerControlCapability[],
    runCli,
  });
}
