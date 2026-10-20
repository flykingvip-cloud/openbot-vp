import { execFile } from "node:child_process";
import type { EvalProbe } from "@openbot/aor-core";

/** Injectable command runner; defaults to `execFile`. */
export type CommandRunner = (
  command: string,
  args: string[],
  cwd?: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const defaultRunner: CommandRunner = (command, args, cwd) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code =
        error && typeof (error as { code?: unknown }).code === "number"
          ? (error as { code: number }).code
          : error
            ? 1
            : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/**
 * A verifiable probe that runs a command (e.g. `pnpm build` or `pnpm test`)
 * and scores 1 on exit code 0, else 0. This is the objective signal that lets
 * the Feedback loop learn real task-completion quality for coding tasks.
 *
 * The runner is injectable so unit tests never shell out.
 */
export function createCommandProbe(params: {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  weight?: number;
  runner?: CommandRunner;
}): EvalProbe {
  const runner = params.runner ?? defaultRunner;
  return {
    name: params.name,
    weight: params.weight ?? 1,
    run: async () => {
      const result = await runner(params.command, params.args ?? [], params.cwd);
      return result.code === 0 ? 1 : 0;
    },
  };
}

/** Parse a coverage percentage (0..100) from text into a 0..1 probe score. */
export function createCoverageProbe(params: {
  command: string;
  args?: string[];
  cwd?: string;
  weight?: number;
  runner?: CommandRunner;
  /** Regex with a single capture group for the percentage. */
  pattern?: RegExp;
}): EvalProbe {
  const runner = params.runner ?? defaultRunner;
  const pattern = params.pattern ?? /All files[^\n]*?(\d+(?:\.\d+)?)/;
  return {
    name: "coverage",
    weight: params.weight ?? 1,
    run: async () => {
      const result = await runner(params.command, params.args ?? [], params.cwd);
      const match = (result.stdout + result.stderr).match(pattern);
      if (!match) {
        return 0;
      }
      const pct = Number.parseFloat(match[1]);
      return Number.isFinite(pct) ? Math.max(0, Math.min(1, pct / 100)) : 0;
    },
  };
}
