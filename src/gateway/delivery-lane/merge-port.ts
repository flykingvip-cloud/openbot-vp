/**
 * merge-port.ts — Tip C injectable MergePort.
 *
 * Real merge/squash is allowed only after DeliveryLane dual-seal + match-head
 * (see merge-request.ts). This module does NOT invent a second GitHub stack:
 * the default adapter shells the existing `gh pr merge` CLI.
 *
 * Merge ≠ production cutover; feature flag stays default OFF (MERGE_PORT.md).
 */

import { execFileUtf8 } from "../../daemon/exec-file.js";

export type MergePortMethod = "squash" | "merge" | "rebase";

export type MergePortRequest = {
  prNumber: number;
  tipSha: string;
  method: MergePortMethod;
  /** Working directory for `gh` (repo root). Optional. */
  cwd?: string;
};

export type MergePortResult = {
  ok: true;
  method: MergePortMethod;
  prNumber: number;
  tipSha: string;
  stdout?: string;
  stderr?: string;
};

/**
 * Thin port so tests inject a fake and production uses `gh pr merge`.
 * Callers MUST re-check implementSeal ∧ acceptSeal ∧ match-head before invoke.
 */
export interface MergePort {
  merge(req: MergePortRequest): Promise<MergePortResult>;
}

export class MergePortError extends Error {
  readonly code: "FAILED" | "INVALID_REQUEST";

  constructor(message: string, code: "FAILED" | "INVALID_REQUEST" = "FAILED") {
    super(message);
    this.name = "MergePortError";
    this.code = code;
  }
}

function methodFlag(method: MergePortMethod): string {
  if (method === "merge") {
    return "--merge";
  }
  if (method === "rebase") {
    return "--rebase";
  }
  return "--squash";
}

/**
 * Default adapter: `gh pr merge <n> --squash|--merge|--rebase`.
 * Does not verify tipSha itself — DeliveryLane requestMerge owns that guard.
 */
export function createGhPrMergePort(opts?: {
  exec?: typeof execFileUtf8;
  /** Extra gh args (e.g. --admin). Default none. */
  extraArgs?: string[];
}): MergePort {
  const exec = opts?.exec ?? execFileUtf8;
  const extraArgs = opts?.extraArgs ?? [];
  return {
    async merge(req: MergePortRequest): Promise<MergePortResult> {
      if (!Number.isFinite(req.prNumber) || req.prNumber <= 0) {
        throw new MergePortError(`invalid prNumber: ${String(req.prNumber)}`, "INVALID_REQUEST");
      }
      const tipSha = req.tipSha.trim();
      if (!tipSha) {
        throw new MergePortError("tipSha is required", "INVALID_REQUEST");
      }
      const args = ["pr", "merge", String(req.prNumber), methodFlag(req.method), ...extraArgs];
      const result = await exec("gh", args, req.cwd ? { cwd: req.cwd } : {});
      if (result.code !== 0) {
        throw new MergePortError(
          `gh pr merge failed (code=${result.code}): ${result.stderr || result.stdout || "unknown"}`,
          "FAILED",
        );
      }
      return {
        ok: true,
        method: req.method,
        prNumber: req.prNumber,
        tipSha,
        stdout: result.stdout || undefined,
        stderr: result.stderr || undefined,
      };
    },
  };
}

/** Test double: records calls; optionally fails. */
export function createRecordingMergePort(opts?: {
  failWith?: string;
}): MergePort & { calls: MergePortRequest[] } {
  const calls: MergePortRequest[] = [];
  return {
    calls,
    async merge(req: MergePortRequest): Promise<MergePortResult> {
      calls.push({ ...req });
      if (opts?.failWith) {
        throw new MergePortError(opts.failWith, "FAILED");
      }
      return {
        ok: true,
        method: req.method,
        prNumber: req.prNumber,
        tipSha: req.tipSha,
        stdout: `fake-merged:${req.prNumber}`,
      };
    },
  };
}

let defaultPort: MergePort | undefined;

/** Override default port (tests). Pass null to reset. */
export function setDefaultMergePortForTests(port: MergePort | null): void {
  defaultPort = port ?? undefined;
}

export function getDefaultMergePort(): MergePort {
  return defaultPort ?? createGhPrMergePort();
}
