import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

async function main() {
  const reportPath = resolve(readArg("--report") ?? ".runtime/cogniweave-benchmark-longrun.json");
  const outputPath = resolve(
    readArg("--output") ?? "datasets/benchmark-longrun-baseline.candidate.json",
  );
  const packageRoot = resolve(readArg("--package-root") ?? ".");
  const keepOriginalGeneratedAt = hasFlag("--keep-generated-at");

  const reportRaw = await readFile(reportPath, "utf8");
  const report = JSON.parse(reportRaw);
  const metrics = asObject(report.metrics);
  if (!metrics) {
    throw new Error("Invalid benchmark report: missing metrics");
  }

  const normalizedDataset =
    typeof report.dataset === "string"
      ? relative(packageRoot, resolve(report.dataset))
      : "datasets/mvp-core-eval.json";

  const baseline = {
    profile: typeof report.profile === "string" ? report.profile : "longrun",
    dataset: normalizedDataset,
    generatedAt:
      keepOriginalGeneratedAt && typeof report.generatedAt === "string"
        ? report.generatedAt
        : new Date().toISOString(),
    warmupIterations: typeof report.warmupIterations === "number" ? report.warmupIterations : 30,
    measureIterations:
      typeof report.measureIterations === "number" ? report.measureIterations : 1000,
    totalReasonOps: typeof report.totalReasonOps === "number" ? report.totalReasonOps : 1000,
    totalDistillationOps:
      typeof report.totalDistillationOps === "number" ? report.totalDistillationOps : 1000,
    metrics: report.metrics,
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

  process.stdout.write(
    JSON.stringify(
      {
        status: "OK",
        reportPath,
        outputPath,
        profile: baseline.profile,
        dataset: baseline.dataset,
      },
      null,
      2,
    ) + "\n",
  );
}

await main();
