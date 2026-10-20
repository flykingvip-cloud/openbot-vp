import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRACKED_SUMMARY_RELPATH,
  TRACKED_SUMMARY_SHA_RELPATH,
  assertCandidateIdentity,
  buildLogicalArtifact,
  collectCollectorTexts,
  isTrackedSummaryPath,
  resolveRepoRoot,
} from "./artifact.ts";
import { sha256Hex } from "./ids.ts";
import type { ShadowSummary } from "./types.ts";
import { recomputeShadowMetrics, validateShadowSummary } from "./validate.ts";

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export function usageMessage(): string {
  return `Usage:
  pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts collect --output <path>
  pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts accept --input <path>
  pnpm exec tsx .kiro/specs/execution-router-phase0/shadow/cli.ts collect-perf --output <path>`;
}

export function runCollect(params: {
  repoRoot: string;
  output: string;
  force?: boolean;
  sourceCommit?: string;
}): void {
  const resolved = path.resolve(params.output);
  if (isTrackedSummaryPath(params.repoRoot, resolved)) {
    throw new Error("collect refuses to write the tracked summary.json; use accept after review");
  }
  if (existsSync(resolved) && !params.force) {
    throw new Error(`refusing to overwrite existing file: ${resolved}`);
  }
  buildLogicalArtifact(params.repoRoot, params.sourceCommit);
  mkdirSync(path.dirname(resolved), { recursive: true });
  execSync(
    "pnpm exec vitest run src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts",
    {
      cwd: params.repoRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        OPENBOT_TEST_PROFILE: process.env.OPENBOT_TEST_PROFILE ?? "low",
        OPENBOT_SHADOW_CANDIDATE: resolved,
      },
    },
  );
}

export function runAccept(params: { repoRoot: string; input: string }): void {
  const resolved = path.resolve(params.input);
  if (!existsSync(resolved)) {
    throw new Error(`missing candidate: ${resolved}`);
  }
  const serialized = readFileSync(resolved, "utf8");
  const summary = JSON.parse(serialized) as ShadowSummary;
  const logical = buildLogicalArtifact(params.repoRoot);
  assertCandidateIdentity(summary, logical);
  const validation = validateShadowSummary({
    summary,
    expectedSourceCommit: logical.sourceCommit,
    expectedArtifactSha256: logical.artifactSha256,
    collectorTexts: collectCollectorTexts(params.repoRoot),
  });
  if (!validation.ok) {
    throw new Error(`candidate failed validation:\n${validation.errors.join("\n")}`);
  }
  if (JSON.stringify(recomputeShadowMetrics(summary)) !== JSON.stringify(summary.metrics)) {
    throw new Error("candidate metrics are not reproducible");
  }
  if (summary.metricsKind !== "harness_calculation") {
    throw new Error("this accept path is for harness_calculation evidence only");
  }
  const dest = path.join(params.repoRoot, TRACKED_SUMMARY_RELPATH);
  const destSha = path.join(params.repoRoot, TRACKED_SUMMARY_SHA_RELPATH);
  copyFileSync(resolved, dest);
  writeFileSync(destSha, `${sha256Hex(readFileSync(dest, "utf8"))}\n`);
}

export function runCollectPerf(params: { output: string; force?: boolean }): void {
  const resolved = path.resolve(params.output);
  if (existsSync(resolved) && !params.force) {
    throw new Error(`refusing to overwrite existing file: ${resolved}`);
  }
  throw new Error(
    [
      "real operational performance collection is not accepted yet.",
      `candidate path would be ${resolved}.`,
      "This command refuses to write harness TTFT/token numbers as a production baseline.",
      "Provide an isolated gateway, official model selection, and live usage first.",
    ].join(" "),
  );
}

export function main(argv = process.argv, repoRoot = resolveRepoRoot()): void {
  const command = argv[2];
  if (command === "collect") {
    const output = argValue(argv, "--output");
    if (!output) {
      throw new Error(usageMessage());
    }
    runCollect({ repoRoot, output, force: hasFlag(argv, "--force") });
    return;
  }
  if (command === "accept") {
    const input = argValue(argv, "--input");
    if (!input) {
      throw new Error(usageMessage());
    }
    runAccept({ repoRoot, input });
    return;
  }
  if (command === "collect-perf") {
    const output = argValue(argv, "--output");
    if (!output) {
      throw new Error(usageMessage());
    }
    runCollectPerf({ output, force: hasFlag(argv, "--force") });
    return;
  }
  throw new Error(usageMessage());
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry || process.env.VITEST) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
