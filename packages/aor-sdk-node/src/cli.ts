#!/usr/bin/env node
import { FakeGatewayRpcTransport, USAGE_INGEST_REPORT_METHOD } from "@openbot/aor-backend-openbot";
import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  LatencyClass,
  PlannedStep,
  RunHandle,
  SelectionStrategy,
} from "@openbot/aor-core";
import {
  type Planner,
  StaticGraphPlanner,
  type TaskGraph,
  defaultModelCatalog,
  formatCostReportMarkdown,
} from "@openbot/aor-core";
import { AorClient, createCodingClient, createDefaultClient } from "./client.js";
import { resolveWorkspaceObjectiveCommands } from "./workspace-objective.js";

interface CliArgs {
  goal?: string;
  strategy: SelectionStrategy;
  budget?: number;
  latency?: LatencyClass;
  baseUrl: string;
  apiKey?: string;
  type?: string;
  referenceText?: string;
  json: boolean;
  dryRun: boolean;
  costReport: boolean;
  decompose: boolean;
  rpc: boolean;
  coding: boolean;
  reportBilling: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    strategy: "balanced",
    baseUrl: process.env.AOR_GATEWAY_URL ?? "http://127.0.0.1:18789",
    apiKey: process.env.AOR_GATEWAY_TOKEN,
    json: false,
    dryRun: false,
    costReport: false,
    decompose: false,
    rpc: false,
    coding: false,
    reportBilling: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--cost-report":
        args.costReport = true;
        break;
      case "--decompose":
        args.decompose = true;
        break;
      case "--rpc":
        args.rpc = true;
        break;
      case "--coding":
        args.coding = true;
        break;
      case "--report-billing":
        args.reportBilling = true;
        break;
      case "--strategy":
        args.strategy = next() as SelectionStrategy;
        break;
      case "--budget":
        args.budget = Number.parseFloat(next());
        break;
      case "--latency":
        args.latency = next() as LatencyClass;
        break;
      case "--base-url":
        args.baseUrl = next();
        break;
      case "--api-key":
        args.apiKey = next();
        break;
      case "--type":
        args.type = next();
        break;
      case "--reference":
        args.referenceText = next();
        break;
      default:
        if (!arg.startsWith("-") && args.goal === undefined) {
          args.goal = arg;
        }
        break;
    }
  }
  return args;
}

const HELP = `aor - Agent Orchestration Runtime (Stage 2 demo)

Usage:
  aor "<goal>" [options]

Options:
  --strategy <cheapest|best_quality|balanced>   selection strategy (default: balanced)
  --budget <usd>                                hard cap on estimated cost
  --latency <low|medium|high>                   latency preference
  --type <taskTypeId>                           skip the parser
  --reference <text>                            source text for evaluation (summarization)
  --base-url <url>                              OpenBot gateway URL (env AOR_GATEWAY_URL)
  --api-key <token>                             gateway bearer token (env AOR_GATEWAY_TOKEN)
  --decompose                                   plan coding.review as a scan->review->summarize DAG
  --cost-report                                 print a per-step cost/observability table
  --rpc                                         use Gateway RPC path (requires --dry-run or inject transport in SDK)
  --coding                                      use createCodingClient (objective build/test evaluator)
  --report-billing                              push trace to usage-ingest.report (requires --rpc --dry-run or live transport)
  --json                                        print machine-readable JSON
  --dry-run                                     use a stub backend (no gateway needed)
  -h, --help                                    show this help

Examples:
  aor "review this codebase" --strategy best_quality --decompose --cost-report --dry-run
  aor "review this repo" --rpc --report-billing --dry-run
  aor "summarize this article" --strategy cheapest --dry-run
`;

const STUB_ASSISTANT = [
  "- finding: example issue detected in module A (stub output)",
  "- suggest: add input validation and a regression test",
  "- refactor: extract shared helper to reduce duplication",
].join("\n");

/** Fake Gateway RPC for offline demos: agent path + optional billing ingest. */
function createDemoRpcTransport(): FakeGatewayRpcTransport {
  return new FakeGatewayRpcTransport({
    "sessions.patch": () => ({}),
    agent: () => ({ runId: "demo-run" }),
    "agent.wait": () => ({ status: "ok" }),
    "chat.history": () => ({
      messages: [{ role: "assistant", content: STUB_ASSISTANT }],
    }),
    [USAGE_INGEST_REPORT_METHOD]: () => ({ recorded: true }),
  });
}

/** Stub backend: echoes a canned, task-shaped response for offline demos. */
class StubBackend implements ExecutionBackend {
  readonly id = "stub";
  private prompts = new Map<string, string>();

  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: defaultModelCatalog().map((m) => m.ref) });
  }
  run(step: PlannedStep): Promise<RunHandle> {
    this.prompts.set("last", step.prompt);
    return Promise.resolve({ runId: "stub-1" });
  }
  async *stream(): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "start" };
    yield { kind: "lifecycle", phase: "end" };
  }
  wait(): Promise<BackendRunResult> {
    const text = [
      "- finding: example issue detected in module A (stub output)",
      "- suggest: add input validation and a regression test",
      "- refactor: extract shared helper to reduce duplication",
    ].join("\n");
    return Promise.resolve({
      text,
      usage: { inputTokens: 1200, outputTokens: 280, totalTokens: 1480, costUsd: 0.012 },
    });
  }
  abort(): Promise<void> {
    return Promise.resolve();
  }
}

/** Demo planner: decompose a coding review into scan -> review -> summarize. */
function decompositionPlanner(): Planner {
  const template = (goal: string): TaskGraph => ({
    rootTaskType: "coding.review",
    nodes: [
      { id: "scan", taskType: "coding.review", goal: `scan: ${goal}`, dependsOn: [] },
      { id: "review", taskType: "coding.review", goal: `review: ${goal}`, dependsOn: ["scan"] },
      {
        id: "summary",
        taskType: "summarization",
        goal: `summarize findings for: ${goal}`,
        dependsOn: ["review"],
      },
    ],
    terminalId: "summary",
  });
  return new StaticGraphPlanner((task) =>
    task.type === "coding.review" ? template(task.goal) : undefined,
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.goal) {
    process.stderr.write("error: missing goal\n\n" + HELP);
    return 2;
  }

  if (args.rpc && !args.dryRun) {
    process.stderr.write(
      "error: --rpc requires a Gateway transport; use --dry-run for the offline demo or inject transport via createGatewayRpcClient() in the SDK\n",
    );
    return 2;
  }
  if (args.reportBilling && !args.rpc) {
    process.stderr.write(
      "error: --report-billing requires --rpc (usage-ingest.report is a Gateway RPC)\n",
    );
    return 2;
  }

  const planner = args.decompose ? decompositionPlanner() : undefined;
  const rpcTransport = args.rpc ? createDemoRpcTransport() : undefined;

  const client = args.dryRun
    ? args.rpc
      ? createDefaultClient({
          baseUrl: args.baseUrl,
          transport: rpcTransport,
          billingTransport: args.reportBilling ? rpcTransport : undefined,
          defaultStrategy: args.strategy,
          planner,
        })
      : new AorClient({ backend: new StubBackend(), defaultStrategy: args.strategy, planner })
    : args.coding
      ? (() => {
          const workspace = process.cwd();
          const objective = resolveWorkspaceObjectiveCommands(workspace);
          return createCodingClient({
            baseUrl: args.baseUrl,
            apiKey: args.apiKey,
            defaultStrategy: args.strategy,
            planner,
            workspace,
            build: objective.build,
            test: objective.test,
            coverage: objective.coverage,
          });
        })()
      : createDefaultClient({
          baseUrl: args.baseUrl,
          apiKey: args.apiKey,
          defaultStrategy: args.strategy,
          planner,
        });

  const agent = client.agent({
    goal: args.goal,
    type: args.type,
    constraints: {
      budgetUsd: args.budget,
      latency: args.latency,
    },
  });

  const result = await agent.run({
    strategy: args.strategy,
    referenceInput: args.referenceText,
    reportBilling: args.reportBilling,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  const lines = [
    `Task type : ${result.taskType}`,
    `Model     : ${result.selection.model.provider}/${result.selection.model.id}`,
    `Reason    : ${result.selection.reason} (score ${result.selection.score.toFixed(3)})`,
    `Est. cost : $${result.selection.estimatedCostUsd.toFixed(4)}`,
    `Usage     : ${result.usage.totalTokens} tokens` +
      (result.usage.costUsd !== undefined ? ` ($${result.usage.costUsd.toFixed(4)})` : ""),
    `Latency   : ${result.latencyMs} ms`,
    result.evaluation
      ? `Eval score: ${result.evaluation.score.toFixed(3)} ${JSON.stringify(result.evaluation.signals)}`
      : "Eval score: (no evaluator)",
    `Steps     : ${result.trace.length}`,
  ];
  if (args.costReport) {
    lines.push("", formatCostReportMarkdown(result));
  }
  if (args.reportBilling && rpcTransport) {
    const billingCalls = rpcTransport.calls.filter((c) => c.method === USAGE_INGEST_REPORT_METHOD);
    lines.push("", `Billing ingest: ${billingCalls.length} usage-ingest.report call(s)`);
  }
  lines.push("", "Output:", result.output.text);
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`aor: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
