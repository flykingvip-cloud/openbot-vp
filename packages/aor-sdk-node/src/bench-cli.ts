#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { type BenchPolicyResult, type DemoBenchmarkOptions, runDemoBenchmark } from "./bench.js";
import { runLiveCodingArchive, writeLiveCodingArchive } from "./live-coding.js";

function findPolicy(results: BenchPolicyResult[], name: string): BenchPolicyResult | undefined {
  return results.find((r) => r.policy === name);
}

export interface BenchCliOptions extends DemoBenchmarkOptions {
  writeBanditState?: boolean;
  codingArchivePath?: string;
  goal?: string;
}

export function parseBenchCliArgs(argv: string[]): BenchCliOptions {
  const opts: BenchCliOptions = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bandit-state" && argv[i + 1]) {
      opts.banditStatePath = argv[i + 1];
      i += 1;
    } else if (arg === "--bandit-rounds" && argv[i + 1]) {
      opts.banditRounds = Number.parseInt(argv[i + 1] ?? "3", 10);
      i += 1;
    } else if (arg === "--live") {
      opts.live = true;
    } else if (arg === "--coding") {
      opts.coding = true;
    } else if (arg === "--gateway-url" && argv[i + 1]) {
      opts.gatewayUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--workspace" && argv[i + 1]) {
      opts.codingWorkspace = argv[i + 1];
      i += 1;
    } else if (arg === "--coding-archive" && argv[i + 1]) {
      opts.codingArchivePath = argv[i + 1];
      i += 1;
    } else if (arg === "--goal" && argv[i + 1]) {
      opts.goal = argv[i + 1];
      i += 1;
    } else if (arg === "--write-bandit-state") {
      opts.writeBanditState = true;
    }
  }
  if (opts.writeBanditState && !opts.banditStatePath) {
    opts.banditStatePath = ".aor-bandit-state.json";
  }
  if (opts.codingArchivePath) {
    opts.coding = true;
    opts.live = opts.live ?? true;
  }
  return opts;
}

async function main(): Promise<number> {
  const cliOpts = parseBenchCliArgs(process.argv);

  if (cliOpts.codingArchivePath) {
    const record = await runLiveCodingArchive({
      goal: cliOpts.goal,
      workspace: cliOpts.codingWorkspace,
      gatewayUrl: cliOpts.gatewayUrl,
      banditStatePath: cliOpts.banditStatePath,
    });
    writeLiveCodingArchive(cliOpts.codingArchivePath, record);
    process.stdout.write(
      [
        `Live coding archive written: ${cliOpts.codingArchivePath}`,
        `Mode: ${record.mode}`,
        `Model: ${record.result.model}`,
        `Eval score: ${record.result.evaluationScore?.toFixed(3) ?? "n/a"}`,
        `Run id: ${record.result.runId}`,
      ].join("\n") + "\n",
    );
    return 0;
  }

  const { results, table, optimizationMarkdown, learningCurveText } =
    await runDemoBenchmark(cliOpts);
  const mode = cliOpts.live
    ? cliOpts.coding
      ? "live gateway + objective coding"
      : "live gateway"
    : cliOpts.coding
      ? "offline panel + objective coding"
      : "offline panel";
  process.stdout.write(`AOR benchmark (${mode}): single fixed model vs task-aware routing\n\n`);
  process.stdout.write(`${table}\n\n`);

  const aor = findPolicy(results, "aor:auto");
  const bandit = findPolicy(results, "aor:bandit");
  const strong = findPolicy(results, "single:claude");
  const cheap = findPolicy(results, "single:mini");
  if (aor && strong && cheap) {
    const costSaveVsStrong = strong.totalCostUsd
      ? (1 - aor.totalCostUsd / strong.totalCostUsd) * 100
      : 0;
    const completionGainVsCheap = (aor.avgCompletion - cheap.avgCompletion) * 100;
    const meetsCost = costSaveVsStrong >= 30;
    const meetsCompletion = completionGainVsCheap >= 20;
    process.stdout.write(
      [
        `AOR vs single:claude (strong): completion ${(aor.avgCompletion * 100).toFixed(0)}% vs ${(
          strong.avgCompletion * 100
        ).toFixed(0)}%, cost $${aor.totalCostUsd.toFixed(4)} vs $${strong.totalCostUsd.toFixed(
          4,
        )} (-${costSaveVsStrong.toFixed(0)}%)`,
        `AOR vs single:mini (cheap):    completion ${(aor.avgCompletion * 100).toFixed(0)}% vs ${(
          cheap.avgCompletion * 100
        ).toFixed(0)}% (+${completionGainVsCheap.toFixed(0)} pts), cost $${aor.totalCostUsd.toFixed(
          4,
        )} vs $${cheap.totalCostUsd.toFixed(4)}`,
        "",
        `Plan thresholds: cost -30% vs strong = ${meetsCost ? "MET" : "NOT MET"}; ` +
          `completion +20 pts vs cheap = ${meetsCompletion ? "MET" : "NOT MET"}`,
      ].join("\n") + "\n",
    );
  }

  if (bandit && aor) {
    const banditCostSave = strong?.totalCostUsd
      ? (1 - bandit.totalCostUsd / strong.totalCostUsd) * 100
      : 0;
    process.stdout.write(
      [
        "",
        `Bandit (aor:bandit): completion ${(bandit.avgCompletion * 100).toFixed(0)}%, ` +
          `cost $${bandit.totalCostUsd.toFixed(4)} (-${banditCostSave.toFixed(0)}% vs strong)`,
        bandit.avgCompletion >= (aor?.avgCompletion ?? 0)
          ? "Bandit vs aor:auto: completion NOT WORSE"
          : "Bandit vs aor:auto: completion lower (check learning rounds)",
      ].join("\n") + "\n",
    );
  }

  if (learningCurveText && learningCurveText !== "(no bandit learning snapshots)") {
    process.stdout.write(`\n--- Bandit learning curve ---\n${learningCurveText}\n`);
  }

  if (cliOpts.banditStatePath) {
    process.stdout.write(`\nBandit state: ${cliOpts.banditStatePath}\n`);
  }

  process.stdout.write(`\n--- Optimization report ---\n${optimizationMarkdown}\n`);

  if (cliOpts.banditStatePath && cliOpts.writeBanditState) {
    writeFileSync(
      `${cliOpts.banditStatePath}.learning.json`,
      JSON.stringify({ learningCurve: learningCurveText }, null, 2),
    );
  }

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`aor-bench: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
