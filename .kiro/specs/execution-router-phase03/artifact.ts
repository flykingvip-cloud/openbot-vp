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
  ".kiro/specs/execution-router-phase03/ids.ts",
  ".kiro/specs/execution-router-phase03/types.ts",
  ".kiro/specs/execution-router-phase03/usage.ts",
  ".kiro/specs/execution-router-phase03/metrics.ts",
  ".kiro/specs/execution-router-phase03/artifact.ts",
  ".kiro/specs/execution-router-phase03/collect-performance.ts",
  ".kiro/specs/execution-router-phase03/validate-performance.ts",
  ".kiro/specs/execution-router-phase03/collect-performance.test.ts",
  ".kiro/specs/execution-router-phase03/vitest.config.ts",
] as const;

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
      `HEAD does not contain sourceCommit ${sourceCommit}; collect/validate refuse mixed Git identity`,
    );
  }
}

export function assertProductionIdentity(repoRoot: string, sourceCommit: string): void {
  const mismatches: string[] = [];
  for (const relPath of PRODUCTION_OBSERVATION_PATHS) {
    const sourceBlobSha = gitBlobShaAt(repoRoot, sourceCommit, relPath);
    const headBlobSha = gitBlobShaAt(repoRoot, "HEAD", relPath);
    const worktreeBlobSha = gitWorktreeBlobSha(repoRoot, relPath);
    if (sourceBlobSha !== headBlobSha || headBlobSha !== worktreeBlobSha) {
      mismatches.push(
        `${relPath}: source=${sourceBlobSha} HEAD=${headBlobSha} worktree=${worktreeBlobSha}`,
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `source/HEAD/worktree identity mismatch; collect/validate refuse mixed Git identity\n${mismatches.join("\n")}`,
    );
  }
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
    COLLECTOR_SOURCE_PATHS.map((relPath) => [
      relPath,
      readFileSync(path.join(repoRoot, relPath), "utf8"),
    ]),
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

export function buildLogicalArtifact(
  repoRoot: string,
  sourceCommit?: string,
): {
  sourceCommit: string;
  artifactSha256: string;
  productionBlobShas: Record<string, string>;
} {
  const resolved = requireNonEmpty("sourceCommit", sourceCommit ?? readSourceCommit(repoRoot));
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

export function gitPorcelain(repoRoot: string): string {
  return execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" });
}
