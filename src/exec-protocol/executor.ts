import { assertChecksumMatch, encodeInlineJsonBytes, sha256Of } from "./checksum.js";
import type { ExecProtocolConfig } from "./config.js";
import { ExecProtocolError } from "./errors.js";
import { newArtifactId } from "./ids.js";
import type { FileExecStore } from "./store.js";
import type { ExecInput, ExecTaskKind, ExecTaskRecord } from "./types.js";

export type ExecutorRuntime = {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type ExecutionResult = {
  outcome: "produced" | "failed" | "cancelled" | "timeout" | "unconfirmed";
  artifact?: { artifactId: string; sha256: string; byteCount: number; bytes: Buffer };
  errorMessage?: string;
  sideEffectApplied?: boolean;
  probeCount?: number;
};

export async function loadInputBytes(store: FileExecStore, input: ExecInput): Promise<Buffer> {
  if (input.kind === "inline-json") {
    const bytes = encodeInlineJsonBytes(input.json);
    assertChecksumMatch({
      expectedSha256: input.sha256,
      expectedByteCount: input.byteCount,
      actual: bytes,
    });
    return bytes;
  }
  if (input.kind === "inline-bytes") {
    const bytes = Buffer.from(input.bytesBase64, "base64");
    assertChecksumMatch({
      expectedSha256: input.sha256,
      expectedByteCount: input.byteCount,
      actual: bytes,
    });
    return bytes;
  }
  const loaded = await store.getArtifactBytes(input.artifactId);
  if (!loaded) {
    throw new ExecProtocolError(
      "EXEC_NOT_FOUND",
      "input artifactId was not uploaded on this isolation node",
    );
  }
  return loaded.bytes;
}

function throwIfAborted(signal: AbortSignal, task: ExecTaskRecord): void {
  if (signal.aborted) {
    throw new ExecProtocolError("EXEC_CONFLICT", "task was cancelled", {
      taskId: task.taskId,
      state: "cancel_requested",
    });
  }
}

export async function runIsolationTask(params: {
  task: ExecTaskRecord;
  store: FileExecStore;
  config: ExecProtocolConfig;
  runtime: ExecutorRuntime;
  signal: AbortSignal;
}): Promise<ExecutionResult> {
  const { task, store, config, runtime, signal } = params;
  const started = runtime.now();
  const remaining = () => Math.max(0, config.executionTimeoutMs - (runtime.now() - started));

  const timedSleep = async (ms: number) => {
    const cap = Math.min(ms, remaining());
    if (cap <= 0) {
      return "timeout" as const;
    }
    try {
      await runtime.sleep(cap, signal);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      throw error;
    }
    throwIfAborted(signal, task);
    if (runtime.now() - started >= config.executionTimeoutMs) {
      return "timeout" as const;
    }
    return "ok" as const;
  };

  try {
    throwIfAborted(signal, task);
    const inputBytes = await loadInputBytes(store, task.input);
    const kind: ExecTaskKind = task.kind;

    if (kind === "fail") {
      return { outcome: "failed", errorMessage: "isolation task requested failure" };
    }

    if (kind === "side-effect-probe") {
      const probeId = task.probeId ?? task.taskId;
      if (!task.sideEffectApplied) {
        task.sideEffectApplied = true;
        // Probe count is diagnostic-only; protocol state is the task record.
        const probeCount = await store.commitTaskAndDiagnosticProbe(task, probeId);
        const artifact = makeArtifact(
          task,
          Buffer.from(JSON.stringify({ probeId, count: probeCount }), "utf8"),
        );
        if (task.sleepMs && task.sleepMs > 0) {
          const sleepResult = await timedSleep(task.sleepMs);
          if (sleepResult === "timeout") {
            return {
              outcome: "unconfirmed",
              artifact,
              sideEffectApplied: true,
              probeCount,
              errorMessage: "execution timeout after side-effect probe increment",
            };
          }
        }
        return { outcome: "produced", artifact, sideEffectApplied: true, probeCount };
      }
      const probeCount = store.getProbe(probeId);
      const artifact = makeArtifact(
        task,
        Buffer.from(JSON.stringify({ probeId, count: probeCount }), "utf8"),
      );
      return { outcome: "produced", artifact, sideEffectApplied: true, probeCount };
    }

    if (kind === "sleep" || kind === "ignore-cancel") {
      const sleepMs = task.sleepMs ?? 0;
      if (kind === "ignore-cancel") {
        await runtime.sleep(Math.min(sleepMs, remaining()));
        if (runtime.now() - started >= config.executionTimeoutMs) {
          return { outcome: "timeout", errorMessage: "execution timeout" };
        }
      } else {
        const sleepResult = await timedSleep(sleepMs);
        if (sleepResult === "timeout") {
          return { outcome: "timeout", errorMessage: "execution timeout" };
        }
      }
      const artifact = makeArtifact(
        task,
        inputBytes.length > 0 ? inputBytes : Buffer.from("slept", "utf8"),
      );
      return { outcome: "produced", artifact };
    }

    if (kind === "corrupt-checksum") {
      const real = makeArtifact(
        task,
        inputBytes.length > 0 ? inputBytes : Buffer.from("corrupt", "utf8"),
      );
      return {
        outcome: "produced",
        artifact: {
          ...real,
          sha256: "0".repeat(64),
        },
      };
    }

    const artifact = makeArtifact(task, inputBytes);
    return { outcome: "produced", artifact };
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof ExecProtocolError && error.state === "cancel_requested")
    ) {
      return { outcome: "cancelled", errorMessage: "cancelled before completion" };
    }
    if (error instanceof ExecProtocolError && error.code === "EXEC_CHECKSUM_MISMATCH") {
      return { outcome: "failed", errorMessage: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { outcome: "failed", errorMessage: message };
  }
}

function makeArtifact(
  task: ExecTaskRecord,
  bytes: Buffer,
): { artifactId: string; sha256: string; byteCount: number; bytes: Buffer } {
  return {
    artifactId: newArtifactId(),
    sha256: sha256Of(bytes),
    byteCount: bytes.byteLength,
    bytes,
  };
}

export function defaultExecutorRuntime(): ExecutorRuntime {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      }),
  };
}
