import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PRODUCTION_OBSERVATION_PATHS,
  assertProductionIdentity,
  assertSourceContainedInHead,
  buildLogicalArtifact,
  gitBlobShaAt,
  gitPorcelain,
  isCommitAncestor,
  readHeadCommit,
  readSourceCommit,
  resolveRepoRoot,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/artifact.ts";
import {
  runAccept,
  runCollect,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/cli.ts";
import {
  SHADOW_GENERATOR_VERSION,
  SHADOW_SCHEMA,
} from "../../../../.kiro/specs/execution-router-phase0/shadow/ids.ts";
import type { ShadowSummary } from "../../../../.kiro/specs/execution-router-phase0/shadow/types.ts";

const repoRoot = resolveRepoRoot();

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "identity-test",
      GIT_AUTHOR_EMAIL: "identity-test@example.com",
      GIT_COMMITTER_NAME: "identity-test",
      GIT_COMMITTER_EMAIL: "identity-test@example.com",
    },
  }).trim();
}

function writeProductionFiles(root: string, marker: string): void {
  for (const relPath of PRODUCTION_OBSERVATION_PATHS) {
    mkdirSync(path.join(root, path.dirname(relPath)), { recursive: true });
    writeFileSync(path.join(root, relPath), `// ${relPath} ${marker}\n`);
  }
}

function initTempRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-shadow-identity-"));
  git(dir, "init -b main");
  return dir;
}

function commitAll(dir: string, message: string): string {
  git(dir, "add -A");
  git(dir, `commit -m ${JSON.stringify(message)}`);
  return git(dir, "rev-parse HEAD");
}

describe("Phase 0 shadow Git identity", () => {
  const tempPaths: string[] = [];
  let porcelainBaseline = "";

  beforeAll(() => {
    porcelainBaseline = gitPorcelain(repoRoot);
  });

  afterEach(() => {
    while (tempPaths.length > 0) {
      const target = tempPaths.pop();
      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
    expect(gitPorcelain(repoRoot)).toBe(porcelainBaseline);
  });

  it("refuses collect when HEAD does not contain sourceCommit", () => {
    const dir = initTempRepo();
    tempPaths.push(dir);
    writeProductionFiles(dir, "first");
    const first = commitAll(dir, "first");
    writeProductionFiles(dir, "second");
    const second = commitAll(dir, "second");
    git(dir, `-c advice.detachedHead=false checkout ${first}`);
    const output = path.join(dir, "candidate.json");
    expect(() => runCollect({ repoRoot: dir, output, sourceCommit: second })).toThrow(
      /HEAD does not contain sourceCommit/,
    );
  });

  it("refuses when sourceCommit:path and HEAD:path disagree", () => {
    const dir = initTempRepo();
    tempPaths.push(dir);
    writeProductionFiles(dir, "first");
    const first = commitAll(dir, "first");
    writeProductionFiles(dir, "second");
    commitAll(dir, "second");
    expect(() => assertSourceContainedInHead(dir, first)).not.toThrow();
    expect(() => assertProductionIdentity(dir, first)).toThrow(/production file identity mismatch/);
    expect(() =>
      runCollect({
        repoRoot: dir,
        output: path.join(dir, "candidate.json"),
        sourceCommit: first,
      }),
    ).toThrow(/production file identity mismatch/);
  });

  it("refuses when a production worktree file is modified", () => {
    const dir = initTempRepo();
    tempPaths.push(dir);
    writeProductionFiles(dir, "clean");
    const source = commitAll(dir, "clean");
    writeFileSync(
      path.join(dir, PRODUCTION_OBSERVATION_PATHS[0]),
      "// dirty production worktree\n",
    );
    expect(() =>
      runCollect({
        repoRoot: dir,
        output: path.join(dir, "candidate.json"),
        sourceCommit: source,
      }),
    ).toThrow(/worktree=/);
  });

  it("ignores collector and docs WIP when production files stay identical", () => {
    const dir = initTempRepo();
    tempPaths.push(dir);
    writeProductionFiles(dir, "stable");
    const source = commitAll(dir, "stable");
    mkdirSync(path.join(dir, ".kiro/specs/execution-router-phase0/shadow"), { recursive: true });
    writeFileSync(
      path.join(dir, ".kiro/specs/execution-router-phase0/shadow/README.md"),
      "collector/docs wip must not fail production identity\n",
    );
    expect(() => assertProductionIdentity(dir, source)).not.toThrow();
    expect(() => buildLogicalArtifact(dir, source)).not.toThrow();
  });

  it("after rebase, sourceCommit, HEAD ancestry, and production blobs agree", () => {
    const source = readSourceCommit(repoRoot);
    const head = readHeadCommit(repoRoot);
    expect(isCommitAncestor(repoRoot, source, head)).toBe(true);
    const rows = assertProductionIdentity(repoRoot, source);
    expect(rows).toHaveLength(PRODUCTION_OBSERVATION_PATHS.length);
    for (const row of rows) {
      expect(row.sourceBlobSha).toBe(row.headBlobSha);
      expect(row.headBlobSha).toBe(row.worktreeBlobSha);
    }
    const logical = buildLogicalArtifact(repoRoot, source);
    expect(logical.sourceCommit).toBe(source);
    expect(Object.keys(logical.productionBlobShas)).toEqual([...PRODUCTION_OBSERVATION_PATHS]);
  });

  it("accept refuses a mixed Git identity candidate", () => {
    const logical = buildLogicalArtifact(repoRoot);
    const dir = mkdtempSync(path.join(os.tmpdir(), "openbot-shadow-mixed-"));
    tempPaths.push(dir);
    const input = path.join(dir, "candidate.json");
    const summary: ShadowSummary = {
      schema: SHADOW_SCHEMA,
      version: "1.0.0",
      generatorVersion: SHADOW_GENERATOR_VERSION,
      sourceCommit: logical.sourceCommit,
      observationFlag: "OPENBOT_EXECUTION_ROUTER_OBSERVATION=1",
      artifactSha256: logical.artifactSha256,
      productionBlobShas: Object.fromEntries(
        Object.keys(logical.productionBlobShas).map((relPath) => [relPath, "0".repeat(40)]),
      ),
      collectedAt: "2026-09-06T00:00:00.000Z",
      metricsKind: "harness_calculation",
      sampleCount: 0,
      completeCount: 0,
      errorTtlCount: 0,
      memoryFinalSize: 0,
      metrics: {
        requiredSkillRecall: null,
        requiredToolRecall: null,
        ttftMsAvg: null,
        promptTokensAvg: null,
        firstToolSuccessRate: null,
      },
      samples: [],
    };
    writeFileSync(input, `${JSON.stringify(summary, null, 2)}\n`);
    expect(() => runAccept({ repoRoot, input })).toThrow(/mixed Git identity/);
  });

  it("treats malicious sourceCommit characters as Git ref errors, not shell", () => {
    const canary = path.join(os.tmpdir(), `phase02a-pwned-${Date.now()}`);
    const payloads = [
      `; touch ${canary}`,
      `$(touch ${canary})`,
      `\`touch ${canary}\``,
      `HEAD ; touch ${canary}`,
    ];
    const gitRefError =
      /fatal:|bad revision|invalid object name|unknown revision|ambiguous argument|needed a single revision/i;
    for (const sourceCommit of payloads) {
      expect(() => gitBlobShaAt(repoRoot, sourceCommit, PRODUCTION_OBSERVATION_PATHS[0])).toThrow(
        gitRefError,
      );
      expect(() =>
        runCollect({
          repoRoot,
          output: path.join(os.tmpdir(), "phase02a-should-not-write.json"),
          sourceCommit,
        }),
      ).toThrow(gitRefError);
      expect(existsSync(canary)).toBe(false);
    }
  });
});
