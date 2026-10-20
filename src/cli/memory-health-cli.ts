import type { Command } from "commander";
import type { RunMemoryHealthRpcDeps } from "../gateway/server-methods/doctor-memory-health.js";
import { redactHealthReportForArchive } from "../memory/health-report-redact.js";
import type { HealthReport } from "../memory/health-report.js";
import { isValidHealthReport } from "../memory/health-report.schema.js";
import { defaultRuntime } from "../runtime.js";

export type MemoryHealthCliOptions = {
  json?: boolean;
  summary?: boolean;
  redact?: boolean;
  agent?: string;
};

export type RunMemoryHealthCliDeps = RunMemoryHealthRpcDeps & {
  runMemoryHealthRpc?: (typeof import("../gateway/server-methods/doctor-memory-health.js"))["runMemoryHealthRpc"];
  log?: (line: string) => void;
};

function formatHealthCliText(report: HealthReport): string {
  if (report.status === "denied" || report.status === "invalid") {
    return `memory health: ${report.status} (${report.reasonCode}) ${report.reason}`;
  }
  const agentCount = report.authorizedAgentIds?.length ?? report.agents.length;
  const integrity =
    report.reportKind === "ops"
      ? report.probeIntegrity.mutationsDetected
        ? "mutated"
        : "clean"
      : "n/a";
  return `memory health: ${report.status} (${report.reasonCode}) agents=${agentCount} integrity=${integrity}`;
}

export async function runMemoryHealthCli(
  opts: MemoryHealthCliOptions,
  deps: RunMemoryHealthCliDeps = {},
): Promise<HealthReport> {
  const execute =
    deps.runMemoryHealthRpc ??
    (await import("../gateway/server-methods/doctor-memory-health.js")).runMemoryHealthRpc;
  const report = await execute({
    mode: opts.summary ? "summary" : "platform",
    client: null,
    agentIds: opts.agent?.trim() ? [opts.agent.trim()] : undefined,
  });
  if (!isValidHealthReport(report)) {
    throw new Error("memory health report failed schema validation");
  }

  const output = opts.redact ? redactHealthReportForArchive(report) : report;
  if (opts.redact && !isValidHealthReport(output)) {
    throw new Error("redacted memory health report failed schema validation");
  }

  const log = deps.log ?? ((line: string) => defaultRuntime.log(line));
  if (opts.json || opts.redact) {
    log(JSON.stringify(output, null, 2));
  } else {
    log(formatHealthCliText(report));
  }

  if (report.status !== "ok") {
    process.exitCode = 1;
  }
  return output;
}

export function registerMemoryHealthCli(memory: Command): void {
  memory
    .command("health")
    .description("Read-only memory health probe (no sync, reindex, or watcher)")
    .option("--json", "Print HealthReport JSON", false)
    .option("--summary", "Emit summary report without absolute paths", false)
    .option("--redact", "Strip absolute paths before printing JSON (archive-safe)", false)
    .option("--agent <id>", "Limit probe to one configured agent id")
    .action(async (opts: MemoryHealthCliOptions) => {
      await runMemoryHealthCli(opts);
    });
}
