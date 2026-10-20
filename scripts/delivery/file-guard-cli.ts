/**
 * `delivery:audit:files` — R8/R9 of the delivery-alignment-guard spec.
 *
 * Answers the question a commit-level ancestry check cannot: for every path that differs
 * between the deployed baseline and a candidate, does the candidate drop exports that are
 * still running? And when one of them has to be repaired, will the deployed version of
 * that file even resolve its own imports on the target?
 *
 * Baseline defaults to the resolved LIVE sha, not to a branch tip, because during the
 * audit that produced this spec the two were measured diverged and the tip would have
 * cleared files that drop still-running exports.
 */

import { pathToFileURL } from "node:url";
import { createGitRunner } from "./cli.ts";
import {
  auditFiles,
  canWriteBaselineOnto,
  type FileAuditSummary,
  type TreeReader,
} from "./file-forward-guard.ts";
import type { GitRunner } from "./forward-guard.ts";
import { createDefaultLiveShaReaders, resolveLiveSha } from "./resolve-live-sha.ts";

const EXIT_ALLOW = 0;
const EXIT_BLOCK = 20;
const EXIT_UNKNOWN_LIVE = 21;
const DEFAULT_PATH_SCOPE = ["src", "ui/src", "scripts"];

/** Tree view of a git ref. Caches reads because a moved-export search revisits files. */
export function createGitTreeReader(ref: string, git: GitRunner): TreeReader {
  const contents = new Map<string, string | null>();
  let paths: string[] | null = null;
  return {
    read(path) {
      const cached = contents.get(path);
      if (cached !== undefined) {
        return cached;
      }
      const result = git(["show", `${ref}:${path}`]);
      const value = result.code === 0 ? result.stdout : null;
      contents.set(path, value);
      return value;
    },
    list() {
      paths ??= splitLines(git(["ls-tree", "-r", "--name-only", ref]).stdout);
      return paths;
    },
    grep(token) {
      // Word-boundary match keeps `renderFoo` out of the results when looking for `Foo`.
      const result = git(["grep", "-l", "-w", "-e", token, ref, "--", ...DEFAULT_PATH_SCOPE]);
      if (result.code !== 0) {
        return [];
      }
      return splitLines(result.stdout).map((line) =>
        line.startsWith(`${ref}:`) ? line.slice(ref.length + 1) : line,
      );
    },
  };
}

function splitLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

type ParsedOptions = {
  candidate: string;
  liveSha?: string;
  allowUnknownLive: boolean;
  paths: string[];
  explainRepairs: boolean;
};

function parseOptions(args: string[]): ParsedOptions {
  const options: ParsedOptions = {
    candidate: "HEAD",
    allowUnknownLive: false,
    paths: [],
    explainRepairs: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => {
      const next = args[index + 1];
      if (!next) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--candidate":
        options.candidate = value();
        break;
      case "--live-sha":
        options.liveSha = value();
        break;
      case "--allow-unknown-live":
        options.allowUnknownLive = true;
        break;
      case "--path":
        options.paths.push(value());
        break;
      case "--explain-repairs":
        options.explainRepairs = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Paths that differ between the two refs, restricted to the code scope. */
export function changedPaths(baseline: string, candidate: string, git: GitRunner): string[] {
  const result = git(["diff", "--name-only", baseline, candidate, "--", ...DEFAULT_PATH_SCOPE]);
  return result.code === 0 ? splitLines(result.stdout).filter(isSourcePath) : [];
}

function isSourcePath(path: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(path) && !path.endsWith(".d.ts");
}

export type FileGuardResult = {
  code: 0 | 20 | 21;
  payload: Record<string, unknown>;
};

export function buildPayload(input: {
  baseline: string | null;
  candidate: string;
  summary: FileAuditSummary;
  repairs: ReturnType<typeof canWriteBaselineOnto>[];
}): Record<string, unknown> {
  const blocking = input.summary.regressions;
  return {
    command: "audit-files",
    verdict: blocking.length === 0 ? "allow" : "block",
    baseline: input.baseline,
    candidate: input.candidate,
    counts: input.summary.counts,
    regressions: blocking.map((finding) => ({
      path: finding.path,
      verdict: finding.verdict,
      lost: finding.lost.filter((entry) => entry.disposition === "gone").map((entry) => entry.name),
      starReexportWarning: finding.starReexportWarning,
    })),
    // Every file carrying `export * from` is a lower bound, not a cleared file.
    incompleteSurfaces: input.summary.findings
      .filter((finding) => finding.starReexportWarning.length > 0)
      .map((finding) => finding.path),
    repairs: input.repairs.map((repair) => ({
      path: repair.path,
      feasible: repair.feasible,
      unresolved: repair.unresolved,
    })),
    reasons:
      blocking.length === 0
        ? ["no changed file drops an export that is still deployed"]
        : [`${blocking.length} file(s) drop deployed exports with no other definition`],
  };
}

export async function runFileGuard(
  argv: string[],
  dependencies?: { git?: GitRunner },
): Promise<FileGuardResult> {
  const options = parseOptions(argv);
  const git = dependencies?.git ?? createGitRunner();
  const liveResolution = await resolveLiveSha({
    injectedSha: options.liveSha,
    readers: createDefaultLiveShaReaders(),
  });
  if (liveResolution.sha === null && !options.allowUnknownLive) {
    return {
      code: EXIT_UNKNOWN_LIVE,
      payload: {
        command: "audit-files",
        verdict: "block",
        baseline: null,
        reasons: ["LIVE is unknown; file-level verification fails closed"],
      },
    };
  }
  const baseline = liveResolution.sha;
  if (baseline === null) {
    return {
      code: EXIT_ALLOW,
      payload: {
        command: "audit-files",
        verdict: "allow",
        baseline: null,
        reasons: ["LIVE is unknown and explicitly allowed"],
      },
    };
  }
  const baselineTree = createGitTreeReader(baseline, git);
  const candidateTree = createGitTreeReader(options.candidate, git);
  const paths =
    options.paths.length > 0 ? options.paths : changedPaths(baseline, options.candidate, git);
  const summary = auditFiles(paths, baselineTree, candidateTree);
  const repairs = options.explainRepairs
    ? summary.regressions.map((finding) =>
        canWriteBaselineOnto(finding.path, baselineTree, candidateTree),
      )
    : [];
  const payload = buildPayload({ baseline, candidate: options.candidate, summary, repairs });
  return { code: summary.regressions.length === 0 ? EXIT_ALLOW : EXIT_BLOCK, payload };
}

async function main(): Promise<void> {
  try {
    const result = await runFileGuard(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
    process.exitCode = result.code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT_BLOCK;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
