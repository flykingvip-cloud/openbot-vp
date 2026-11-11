import { ExecProtocolError } from "./errors.js";
import type { HostCommandProbe } from "./types.js";

/**
 * A' must never fall back to host execution. This probe exists so tests can
 * assert the forbidden path was not taken. The control plane does not call it.
 */
export function createHostCommandProbe(): HostCommandProbe {
  const calls: HostCommandProbe["calls"] = [];
  return {
    calls,
    attempt(reason: string, taskId?: string) {
      calls.push({ reason, atMs: Date.now(), taskId });
    },
  };
}

export function forbidHostFallback(reason: string, taskId?: string): never {
  throw new ExecProtocolError(
    "EXEC_UNREACHABLE",
    `host fallback is forbidden on A' control plane: ${reason}`,
    { taskId },
  );
}

export function assertNoHostCommands(probe: HostCommandProbe | undefined): void {
  if (probe && probe.calls.length > 0) {
    throw new Error(
      `A' host command probe recorded ${probe.calls.length} forbidden attempt(s): ${probe.calls
        .map((call) => call.reason)
        .join("; ")}`,
    );
  }
}
