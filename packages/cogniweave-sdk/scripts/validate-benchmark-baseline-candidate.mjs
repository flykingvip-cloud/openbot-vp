import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

async function loadJson(path) {
  const raw = await readFile(resolve(path), "utf8");
  return JSON.parse(raw);
}

function getMetric(report, path) {
  const segments = path.split(".");
  let current = report;
  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = current[segment];
  }
  return isFiniteNumber(current) ? current : null;
}

async function main() {
  const candidatePath =
    readArg("--candidate") ?? ".runtime/benchmark-longrun-baseline.candidate.json";
  const diffPath = readArg("--diff") ?? ".runtime/cogniweave-benchmark-longrun-diff.json";

  const minWarmup = readNumberArg("--min-warmup", 30);
  const minIterations = readNumberArg("--min-iterations", 1000);
  const minReasonOps = readNumberArg("--min-reason-ops", 1000);
  const minDistillationOps = readNumberArg("--min-distill-ops", 1000);
  const minThroughput = readNumberArg("--min-throughput", 10000);
  const maxReasonP95 = readNumberArg("--max-reason-p95", 2);
  const maxDistillationP95 = readNumberArg("--max-distillation-p95", 0.25);

  const candidate = await loadJson(candidatePath);
  const diff = await loadJson(diffPath);

  const checks = [];
  const addCheck = (name, passed, details) => {
    checks.push({ name, passed, details });
  };

  addCheck("profile_longrun", candidate.profile === "longrun", {
    current: candidate.profile,
    expected: "longrun",
  });
  addCheck("warmup_minimum", (candidate.warmupIterations ?? 0) >= minWarmup, {
    current: candidate.warmupIterations,
    min: minWarmup,
  });
  addCheck("iterations_minimum", (candidate.measureIterations ?? 0) >= minIterations, {
    current: candidate.measureIterations,
    min: minIterations,
  });
  addCheck("reason_ops_minimum", (candidate.totalReasonOps ?? 0) >= minReasonOps, {
    current: candidate.totalReasonOps,
    min: minReasonOps,
  });
  addCheck(
    "distillation_ops_minimum",
    (candidate.totalDistillationOps ?? 0) >= minDistillationOps,
    {
      current: candidate.totalDistillationOps,
      min: minDistillationOps,
    },
  );

  const throughput = getMetric(candidate, "metrics.distillationThroughputOpsPerSec");
  const reasonP95 = getMetric(candidate, "metrics.reasonLatencyMs.p95");
  const distillationP95 = getMetric(candidate, "metrics.distillationLatencyMs.p95");

  addCheck("throughput_minimum", throughput !== null && throughput >= minThroughput, {
    current: throughput,
    min: minThroughput,
  });
  addCheck("reason_p95_maximum", reasonP95 !== null && reasonP95 <= maxReasonP95, {
    current: reasonP95,
    max: maxReasonP95,
  });
  addCheck(
    "distillation_p95_maximum",
    distillationP95 !== null && distillationP95 <= maxDistillationP95,
    {
      current: distillationP95,
      max: maxDistillationP95,
    },
  );
  addCheck("diff_gate_pass", diff.status === "PASS", {
    current: diff.status,
    expected: "PASS",
  });

  const failedChecks = checks.filter((check) => !check.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    candidatePath: resolve(candidatePath),
    diffPath: resolve(diffPath),
    thresholds: {
      minWarmup,
      minIterations,
      minReasonOps,
      minDistillationOps,
      minThroughput,
      maxReasonP95,
      maxDistillationP95,
    },
    checks,
    status: failedChecks.length === 0 ? "PASS" : "FAIL",
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (failedChecks.length > 0) {
    process.stderr.write(
      `Baseline candidate validation failed:\n- ${failedChecks
        .map((check) => check.name)
        .join("\n- ")}\n`,
    );
    process.exitCode = 1;
  }
}

await main();
