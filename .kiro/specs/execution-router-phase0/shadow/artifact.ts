import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "./ids.ts";

export const PRODUCTION_OBSERVATION_PATHS = [
  "src/gateway/execution-router-observation.ts",
  "src/gateway/chat-inbound-stage-events.ts",
  "src/agents/pi-embedded-runner/run/attempt.ts",
  "src/agents/pi-embedded-runner/run/execution-router-baselines.ts",
] as const;

export const COLLECTOR_SOURCE_PATHS = [
  ".kiro/specs/execution-router-phase0/shadow/ids.ts",
  ".kiro/specs/execution-router-phase0/shadow/types.ts",
  ".kiro/specs/execution-router-phase0/shadow/summarize.ts",
  ".kiro/specs/execution-router-phase0/shadow/validate.ts",
  ".kiro/specs/execution-router-phase0/shadow/artifact.ts",
  ".kiro/specs/execution-router-phase0/shadow/cli.ts",
  "src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts",
  "src/agents/pi-embedded-runner/run/execution-router-shadow-cli.test.ts",
  "src/agents/pi-embedded-runner/run/execution-router-shadow-identity.test.ts",
  "src/agents/pi-embedded-runner/run/execution-router-shadow-revalidate.test.ts",
  "src/auto-reply/reply/execution-router-mainchain.test.ts",
] as const;

export const TRACKED_SUMMARY_RELPATH = ".kiro/specs/execution-router-phase0/shadow/summary.json";
export const TRACKED_SUMMARY_SHA_RELPATH =
  ".kiro/specs/execution-router-phase0/shadow/summary.sha256";

export type ProductionFileIdentity = {
  path: string;
  sourceBlobSha: string;
  headBlobSha: string;
  worktreeBlobSha: string;
};

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));
}

function requireNonEmpty(name: string, value: string): string {
  if (value === "") {
    throw new Error(`${name} must be a non-empty Git argument`);
  }
  return value;
}

function isGitNotAncestorError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status?: number }).status === 1,
  );
}

export function resolveRepoRoot(fromDir = process.cwd()): string {
  return execSync("git rev-parse --show-toplevel", {
    cwd: fromDir,
    encoding: "utf8",
  }).trim();
}

export function readSourceCommit(repoRoot: string): string {
  return execSync("git rev-parse origin/main", { cwd: repoRoot, encoding: "utf8" }).trim();
}

export function readHeadCommit(repoRoot: string): string {
  return execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
}

export function isCommitAncestor(repoRoot: string, ancestor: string, descendant: string): boolean {
  requireNonEmpty("ancestor", ancestor);
  requireNonEmpty("descendant", descendant);
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return true;
  } catch (error) {
    if (isGitNotAncestorError(error)) {
      return false;
    }
    throw error;
  }
}

export function gitBlobShaAt(repoRoot: string, commitish: string, relPath: string): string {
  requireNonEmpty("commitish", commitish);
  requireNonEmpty("relPath", relPath);
  return execFileSync("git", ["rev-parse", `${commitish}:${relPath}`], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

export function gitWorktreeBlobSha(repoRoot: string, relPath: string): string {
  requireNonEmpty("relPath", relPath);
  return execFileSync("git", ["hash-object", "--", relPath], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

export function assertSourceContainedInHead(repoRoot: string, sourceCommit: string): void {
  if (!isCommitAncestor(repoRoot, sourceCommit, "HEAD")) {
    throw new Error(
      `HEAD does not contain sourceCommit ${sourceCommit}; collect/accept refuse mixed Git identity`,
    );
  }
}

export function inspectProductionFileIdentity(
  repoRoot: string,
  sourceCommit: string,
  relPath: string,
): ProductionFileIdentity {
  return {
    path: relPath,
    sourceBlobSha: gitBlobShaAt(repoRoot, sourceCommit, relPath),
    headBlobSha: gitBlobShaAt(repoRoot, "HEAD", relPath),
    worktreeBlobSha: gitWorktreeBlobSha(repoRoot, relPath),
  };
}

export function assertProductionIdentity(
  repoRoot: string,
  sourceCommit: string,
): ProductionFileIdentity[] {
  const rows = PRODUCTION_OBSERVATION_PATHS.map((relPath) =>
    inspectProductionFileIdentity(repoRoot, sourceCommit, relPath),
  );
  const mismatches = rows.filter(
    (row) => row.sourceBlobSha !== row.headBlobSha || row.headBlobSha !== row.worktreeBlobSha,
  );
  if (mismatches.length > 0) {
    const details = mismatches
      .map(
        (row) =>
          `${row.path}: source=${row.sourceBlobSha} HEAD=${row.headBlobSha} worktree=${row.worktreeBlobSha}`,
      )
      .join("\n");
    throw new Error(
      `production file identity mismatch; collect/accept refuse mixed Git identity\n${details}`,
    );
  }
  return rows;
}

export function collectProductionBlobShas(
  repoRoot: string,
  sourceCommit: string,
): Record<string, string> {
  return Object.fromEntries(
    PRODUCTION_OBSERVATION_PATHS.map((relPath) => [
      relPath,
      gitBlobShaAt(repoRoot, sourceCommit, relPath),
    ]),
  );
}

export function collectCollectorTexts(repoRoot: string): Record<string, string> {
  return Object.fromEntries(
    COLLECTOR_SOURCE_PATHS.map((relPath) => {
      try {
        return [relPath, readFileSync(path.join(repoRoot, relPath), "utf8")];
      } catch {
        return [relPath, ""];
      }
    }),
  );
}

export function computeLogicalArtifactDigest(input: {
  sourceCommit: string;
  collectorTexts: Record<string, string>;
  productionBlobShas: Record<string, string>;
}): string {
  return sha256Hex(
    JSON.stringify({
      sourceCommit: input.sourceCommit,
      collectorTexts: sortRecord(input.collectorTexts),
      productionBlobShas: sortRecord(input.productionBlobShas),
    }),
  );
}

export function resolveSourceCommit(repoRoot: string, sourceCommit?: string): string {
  return requireNonEmpty("sourceCommit", sourceCommit ?? readSourceCommit(repoRoot));
}

export function buildLogicalArtifact(
  repoRoot: string,
  sourceCommit?: string,
): {
  sourceCommit: string;
  artifactSha256: string;
  productionBlobShas: Record<string, string>;
} {
  const resolved = resolveSourceCommit(repoRoot, sourceCommit);
  assertSourceContainedInHead(repoRoot, resolved);
  assertProductionIdentity(repoRoot, resolved);
  const productionBlobShas = collectProductionBlobShas(repoRoot, resolved);
  return {
    sourceCommit: resolved,
    productionBlobShas,
    artifactSha256: computeLogicalArtifactDigest({
      sourceCommit: resolved,
      collectorTexts: collectCollectorTexts(repoRoot),
      productionBlobShas,
    }),
  };
}

export function assertCandidateIdentity(
  summary: {
    sourceCommit: string;
    productionBlobShas?: Record<string, string>;
  },
  logical: {
    sourceCommit: string;
    productionBlobShas: Record<string, string>;
  },
): void {
  if (summary.sourceCommit !== logical.sourceCommit) {
    throw new Error(
      `accept refuses mixed Git identity: sourceCommit ${summary.sourceCommit} != ${logical.sourceCommit}`,
    );
  }
  const actual = JSON.stringify(sortRecord(summary.productionBlobShas ?? {}));
  const expected = JSON.stringify(sortRecord(logical.productionBlobShas));
  if (actual !== expected) {
    throw new Error(
      "accept refuses mixed Git identity: productionBlobShas were not derived from sourceCommit",
    );
  }
}

export function isTrackedSummaryPath(repoRoot: string, candidate: string): boolean {
  return path.resolve(candidate) === path.resolve(repoRoot, TRACKED_SUMMARY_RELPATH);
}

export function gitPorcelain(repoRoot: string): string {
  return execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" });
}
