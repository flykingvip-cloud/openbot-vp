import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function readNumberArg(flag, fallback) {
  const raw = readArg(flag);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

function getMetric(report, path) {
  const parts = path.split(".");
  let current = report;
  for (const part of parts) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return null;
    }
    current = current[part];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function buildCheckResult(name, baseline, current, allowed, direction) {
  const delta = current - baseline;
  const deltaRatio = baseline === 0 ? null : delta / baseline;
  const passed = direction === "increase_limited" ? current <= allowed : current >= allowed;
  return {
    name,
    baseline,
    current,
    allowed,
    delta,
    deltaRatio,
    passed,
    direction,
  };
}

async function loadJson(path) {
  const raw = await readFile(resolve(path), "utf8");
  return JSON.parse(raw);
}

async function main() {
  const reportPath = readArg("--report");
  const baselinePath = readArg("--baseline");
  const outputPath = readArg("--output");
  const enforceThresholds = hasFlag("--enforce-thresholds");

  if (!reportPath || !baselinePath) {
    throw new Error(
      "Usage: node scripts/benchmark-diff.mjs --report <report.json> --baseline <baseline.json> [--output <file>] [--enforce-thresholds]",
    );
  }

  const maxReasonP95RegressionRatio = readNumberArg("--max-reason-p95-regression-ratio", 1.5);
  const maxGraphP95RegressionRatio = readNumberArg("--max-graph-p95-regression-ratio", 5);
  const maxDistillP95RegressionRatio = readNumberArg("--max-distill-p95-regression-ratio", 0.75);
  const maxThroughputDropRatio = readNumberArg("--max-throughput-drop-ratio", 0.4);

  const report = await loadJson(reportPath);
  const baseline = await loadJson(baselinePath);

  const baselineReasonP95 = getMetric(baseline, "metrics.reasonLatencyMs.p95");
  const currentReasonP95 = getMetric(report, "metrics.reasonLatencyMs.p95");
  const baselineGraphP95 = getMetric(baseline, "metrics.graphQueryLatencyMs.p95");
  const currentGraphP95 = getMetric(report, "metrics.graphQueryLatencyMs.p95");
  const baselineDistillP95 = getMetric(baseline, "metrics.distillationLatencyMs.p95");
  const currentDistillP95 = getMetric(report, "metrics.distillationLatencyMs.p95");
  const baselineThroughput = getMetric(baseline, "metrics.distillationThroughputOpsPerSec");
  const currentThroughput = getMetric(report, "metrics.distillationThroughputOpsPerSec");

  const missing = [
    ["metrics.reasonLatencyMs.p95", baselineReasonP95, currentReasonP95],
    ["metrics.graphQueryLatencyMs.p95", baselineGraphP95, currentGraphP95],
    ["metrics.distillationLatencyMs.p95", baselineDistillP95, currentDistillP95],
    ["metrics.distillationThroughputOpsPerSec", baselineThroughput, currentThroughput],
  ].filter(([, base, cur]) => base === null || cur === null);

  if (missing.length > 0) {
    throw new Error(`Missing metric(s): ${missing.map(([name]) => name).join(", ")}`);
  }

  const reasonAllowed = Math.max(
    baselineReasonP95,
    baselineReasonP95 * (1 + maxReasonP95RegressionRatio),
  );
  const graphBaselineEffective = Math.max(baselineGraphP95, 0.01);
  const graphAllowed = graphBaselineEffective * (1 + maxGraphP95RegressionRatio);
  const distillAllowed = Math.max(
    baselineDistillP95,
    baselineDistillP95 * (1 + maxDistillP95RegressionRatio),
  );
  const throughputAllowed = baselineThroughput * (1 - maxThroughputDropRatio);

  const checks = [
    buildCheckResult(
      "reason_latency_p95",
      baselineReasonP95,
      currentReasonP95,
      reasonAllowed,
      "increase_limited",
    ),
    buildCheckResult(
      "graph_query_latency_p95",
      baselineGraphP95,
      currentGraphP95,
      graphAllowed,
      "increase_limited",
    ),
    buildCheckResult(
      "distillation_latency_p95",
      baselineDistillP95,
      currentDistillP95,
      distillAllowed,
      "increase_limited",
    ),
    buildCheckResult(
      "distillation_throughput",
      baselineThroughput,
      currentThroughput,
      throughputAllowed,
      "decrease_limited",
    ),
  ];

  const failedChecks = checks.filter((check) => !check.passed);
  const result = {
    generatedAt: new Date().toISOString(),
    reportPath: resolve(reportPath),
    baselinePath: resolve(baselinePath),
    thresholds: {
      maxReasonP95RegressionRatio,
      maxGraphP95RegressionRatio,
      maxDistillP95RegressionRatio,
      maxThroughputDropRatio,
    },
    checks,
    status: failedChecks.length === 0 ? "PASS" : "FAIL",
  };

  const json = JSON.stringify(result, null, 2);
  if (outputPath) {
    const resolved = resolve(outputPath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${json}\n`, "utf8");
  }
  process.stdout.write(`${json}\n`);

  if (enforceThresholds && failedChecks.length > 0) {
    process.stderr.write(
      `Benchmark diff gate failed:\n- ${failedChecks
        .map(
          (check) =>
            `${check.name}: current=${check.current.toFixed(6)}, allowed=${check.allowed.toFixed(6)}`,
        )
        .join("\n- ")}\n`,
    );
    process.exitCode = 1;
  }
}

await main();
