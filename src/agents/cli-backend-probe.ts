/**
 * cli-backend-probe.ts — bounded executable probe for CLI backends.
 *
 * Shared by platform admin (`cliBackend.test`) and supervisor worker health.
 */

import { spawn } from "node:child_process";

export const CLI_BACKEND_PROBE_TIMEOUT_MS = 45_000;
export const CLI_BACKEND_PROBE_MAX_OUTPUT = 8 * 1024;

export interface CliBackendProbeResult {
  ok: boolean;
  resolved: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

/** Spawn `command probeArgs` with a hard timeout; never throws. */
export function probeCliBackendCommand(
  command: string,
  probeArgs: string[] = ["--version"],
): Promise<CliBackendProbeResult> {
  return new Promise<CliBackendProbeResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (result: CliBackendProbeResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, probeArgs, { shell: false });
    } catch (err) {
      done({
        ok: false,
        resolved: false,
        stderr: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({
        ok: false,
        resolved: true,
        stderr: `probe timed out after ${CLI_BACKEND_PROBE_TIMEOUT_MS}ms`,
      });
    }, CLI_BACKEND_PROBE_TIMEOUT_MS);
    const cap = (buf: string, chunk: unknown) =>
      buf.length >= CLI_BACKEND_PROBE_MAX_OUTPUT ? buf : buf + String(chunk);
    child.stdout?.on("data", (chunk) => {
      stdout = cap(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = cap(stderr, chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      const enoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      done({ ok: false, resolved: !enoent, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({
        ok: code === 0,
        resolved: true,
        exitCode: code ?? undefined,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
      });
    });
  });
}
