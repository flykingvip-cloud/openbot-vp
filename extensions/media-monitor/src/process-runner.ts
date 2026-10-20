import { spawn, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import { parseAdapterStdout } from "./contract.js";
import { redactText } from "./redact.js";
import type { ProcessRunResult } from "./types.js";

type AdapterChild = ChildProcessByStdio<null, Readable, Readable>;

function normalizeForCwdSandbox(p: string): string {
  const normalized = path.normalize(p);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function resolveAdapterCwd(cwdRaw: string | undefined): string {
  if (typeof cwdRaw !== "string" || !cwdRaw.trim()) {
    return process.cwd();
  }
  const cwd = cwdRaw.trim();
  if (path.isAbsolute(cwd)) {
    // Absolute paths are allowed for operator-managed sidecar checkouts,
    // but must not be shell-interpolated.
    return cwd;
  }
  const base = process.cwd();
  const resolved = path.resolve(base, cwd);
  const rel = path.relative(normalizeForCwdSandbox(base), normalizeForCwdSandbox(resolved));
  if (rel === "" || rel === ".") {
    return resolved;
  }
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("adapterCwd must stay within the gateway working directory when relative");
  }
  return resolved;
}

export type RunAdapterProcessParams = {
  command: string[];
  extraArgv: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  maxStdoutBytes: number;
  signal?: AbortSignal;
};

function terminateChild(child: AdapterChild): void {
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  setTimeout(() => {
    try {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    } catch {
      // ignore
    }
  }, 1500).unref?.();
}

/**
 * Spawn a bounded sidecar process. Argv is never shell-concatenated.
 * stdout = JSON protocol only; stderr = diagnostics (redacted in errors).
 */
export async function runAdapterProcess(
  params: RunAdapterProcessParams,
): Promise<ProcessRunResult> {
  if (!params.command.length || !params.command[0]?.trim()) {
    return {
      ok: false,
      error: {
        category: "process_error",
        retryable: false,
        message: "adapterCommand is empty",
      },
      stderr: "",
      stdout: "",
    };
  }

  const timeoutMs = Math.max(1000, params.timeoutMs);
  const maxStdoutBytes = Math.max(1024, params.maxStdoutBytes);
  const cwd = resolveAdapterCwd(params.cwd);
  const [bin, ...prefixArgv] = params.command;
  const argv = [...prefixArgv, ...params.extraArgv];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...params.env,
    OPENBOT_MEDIA_ADAPTER_MODE: "jsonl",
  };
  // Never leak inspect flags into the child.
  if ((env.NODE_OPTIONS ?? "").includes("--inspect")) {
    delete env.NODE_OPTIONS;
  }

  return await new Promise<ProcessRunResult>((resolve) => {
    let settled = false;
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let timedOut = false;
    let killedForTimeout = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (result: ProcessRunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      params.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    // stdin ignored → null; stdout/stderr piped.
    const child = spawn(bin!, argv, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    }) as AdapterChild;

    const onAbort = () => {
      terminateChild(child);
      settle({
        ok: false,
        error: {
          category: "process_error",
          retryable: true,
          message: "adapter cancelled",
          timedOut: false,
        },
        stderr: redactText(stderr, 1000),
        stdout,
      });
    };
    if (params.signal) {
      if (params.signal.aborted) {
        onAbort();
        return;
      }
      params.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      const str = String(chunk);
      stdoutBytes += Buffer.byteLength(str, "utf8");
      if (stdoutBytes > maxStdoutBytes) {
        terminateChild(child);
        settle({
          ok: false,
          error: {
            category: "process_error",
            retryable: true,
            message: "adapter stdout exceeded maxStdoutBytes",
          },
          stderr: redactText(stderr, 1000),
          stdout: stdout.slice(0, 2000),
        });
        return;
      }
      stdout += str;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += String(chunk);
      if (stderr.length > 64_000) {
        stderr = stderr.slice(-64_000);
      }
    });

    timer = setTimeout(() => {
      timedOut = true;
      killedForTimeout = true;
      terminateChild(child);
    }, timeoutMs);

    child.once("error", (err) => {
      settle({
        ok: false,
        error: {
          category: "process_error",
          retryable: true,
          message: redactText(err.message || "spawn failed", 500),
        },
        stderr: redactText(stderr, 1000),
        stdout,
      });
    });

    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }
      if (timedOut || killedForTimeout || signal === "SIGTERM" || signal === "SIGKILL") {
        // Prefer timeout when we intentionally terminated the child.
        if (timedOut || killedForTimeout) {
          settle({
            ok: false,
            error: {
              category: "timeout",
              retryable: true,
              message: "adapter subprocess timed out",
              exitCode: code,
              timedOut: true,
            },
            stderr: redactText(stderr, 1000),
            stdout,
          });
          return;
        }
      }

      try {
        const envelope = parseAdapterStdout(stdout);
        if ("error" in envelope) {
          settle({
            ok: true,
            envelope,
            stderr: redactText(stderr, 2000),
            exitCode: code ?? 1,
            timedOut: false,
          });
          return;
        }
        if (code !== 0) {
          settle({
            ok: false,
            error: {
              category: "process_error",
              retryable: true,
              message: `adapter exited non-zero (${code ?? "?"})`,
              exitCode: code,
            },
            stderr: redactText(stderr, 1000),
            stdout,
          });
          return;
        }
        settle({
          ok: true,
          envelope,
          stderr: redactText(stderr, 2000),
          exitCode: code ?? 0,
          timedOut: false,
        });
      } catch (err) {
        settle({
          ok: false,
          error: {
            category: "invalid_output",
            retryable: false,
            message: redactText(err instanceof Error ? err.message : "invalid adapter output", 500),
            exitCode: code,
          },
          stderr: redactText(stderr, 1000),
          stdout: redactText(stdout, 1000),
        });
      }
    });
  });
}
