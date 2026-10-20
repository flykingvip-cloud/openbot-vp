import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { AdapterBundle } from "./adapters/factory.js";
import { createAdapterBundle } from "./adapters/factory.js";
import type { EngineConfig, EngineEnvironment, ScopeInput, ScopeVisibility } from "./models.js";
import {
  createCogniWeaveHttpServer,
  type CogniWeaveHttpServerOptions,
} from "./rest/node-server.js";
import { CogniWeaveRestService } from "./rest/service.js";
import { InMemoryCogniWeaveEngine } from "./runtime/in-memory-engine.js";

export type CliCommand =
  | "serve"
  | "bootstrap-schema"
  | "doctor"
  | "recover"
  | "compact"
  | "journal-stats"
  | "help";

export interface CogniWeaveCliOptions {
  command: CliCommand;
  helpRequested: boolean;
  versionRequested: boolean;
  outputJson: boolean;
  outputFile?: string;
  printConfig: boolean;
  dryRun: boolean;
  host: string;
  port: number;
  basePath: string;
  bootstrapSchemas: boolean;
  environment: EngineEnvironment;
  metadataBackend: string;
  metadataStorePath?: string;
  graphBackend: string;
  evidenceBackend: string;
  vectorBackend?: string;
  enableLlmTaskFraming: boolean;
  enableLlmDistillation: boolean;
  enableVectorSeedRetrieval: boolean;
  defaultScope?: ScopeInput;
  reasoningTimeoutMs: number;
  evidenceLazyLoading: boolean;
  /** COMPLETED journals to retain for `compact` (default 20). */
  keepCompleted: number;
}

export interface CogniWeaveCliBootstrapTargetResult {
  kind: "metadata" | "graph" | "vector";
  backend: string;
  status: "BOOTSTRAPPED" | "SKIPPED";
  statementsExecuted?: number;
  reason?: string;
}

export type CogniWeaveCliJsonAction =
  | "version"
  | "print-config"
  | "bootstrap-schema"
  | "bootstrap-schemas"
  | "dry-run"
  | "serve-started"
  | "doctor"
  | "recover"
  | "compact"
  | "journal-stats";

export type CogniWeaveCliJsonErrorAction = CogniWeaveCliJsonAction | CliCommand | "error";

export type CogniWeaveCliJsonCode =
  | "VERSION_OK"
  | "PRINT_CONFIG_OK"
  | "BOOTSTRAP_SCHEMA_OK"
  | "BOOTSTRAP_SCHEMA_PARTIAL"
  | "BOOTSTRAP_SCHEMAS_OK"
  | "BOOTSTRAP_SCHEMAS_PARTIAL"
  | "DRY_RUN_OK"
  | "SERVE_LISTENING"
  | "DOCTOR_OK"
  | "RECOVER_OK"
  | "COMPACT_OK"
  | "JOURNAL_STATS_OK";

export type CogniWeaveCliErrorCode =
  | "INVALID_ARGUMENT"
  | "BOOTSTRAP_FAILED"
  | "LISTEN_FAILED"
  | "INTERNAL_ERROR";

export interface CogniWeaveCliJsonEnvelope<T> {
  ok: true;
  action: CogniWeaveCliJsonAction;
  code: CogniWeaveCliJsonCode;
  timestamp: string;
  data: T;
}

export interface CogniWeaveCliJsonErrorEnvelope {
  ok: false;
  action: CogniWeaveCliJsonErrorAction;
  code: CogniWeaveCliErrorCode;
  timestamp: string;
  error: {
    message: string;
  };
}

interface ParsedCliValues {
  help?: boolean;
  host?: string;
  port?: string;
  basePath?: string;
  environment?: string;
  metadataBackend?: string;
  metadataStorePath?: string;
  graphBackend?: string;
  evidenceBackend?: string;
  vectorBackend?: string;
  enableLlmTaskFraming?: boolean;
  enableLlmDistillation?: boolean;
  enableVectorSeedRetrieval?: boolean;
  bootstrapSchemas?: boolean;
  outputJson?: boolean;
  outputFile?: string;
  printConfig?: boolean;
  dryRun?: boolean;
  version?: boolean;
  reasoningTimeoutMs?: string;
  defaultWorkspaceId?: string;
  defaultProjectId?: string;
  defaultAgentId?: string;
  defaultVisibility?: string;
  keepCompleted?: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_BASE_PATH = "/";
const VALID_ENVIRONMENTS: EngineEnvironment[] = ["local", "service", "cloud"];
const VALID_VISIBILITIES: ScopeVisibility[] = ["private", "shared"];

function parseBooleanOption(value: boolean | undefined, fallback: boolean): boolean {
  return value === undefined ? fallback : value;
}

function parsePort(value: string | undefined): number {
  const parsed = value ?? String(DEFAULT_PORT);
  const port = Number.parseInt(parsed, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${parsed}`);
  }
  return port;
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) {
    return 200;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid reasoning timeout: ${value}`);
  }
  return parsed;
}

function parseKeepCompleted(value: string | undefined): number {
  if (value === undefined) {
    return 20;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid keep-completed: ${value}`);
  }
  return parsed;
}

function parseEnvironment(value: string | undefined): EngineEnvironment {
  const normalized = value ?? "local";
  if (VALID_ENVIRONMENTS.includes(normalized as EngineEnvironment)) {
    return normalized as EngineEnvironment;
  }
  throw new Error(`Invalid environment: ${normalized}`);
}

function parseVisibility(value: string | undefined): ScopeVisibility | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (VALID_VISIBILITIES.includes(value as ScopeVisibility)) {
    return value as ScopeVisibility;
  }
  throw new Error(`Invalid default visibility: ${value}`);
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") {
    return "/";
  }
  const trimmed = basePath.trim();
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function formatServerUrl(host: string, port: number, basePath: string): string {
  const normalized = normalizeBasePath(basePath);
  return `http://${host}:${port}${normalized === "/" ? "" : normalized}`;
}

function buildJsonEnvelope<T>(
  action: CogniWeaveCliJsonAction,
  data: T,
): CogniWeaveCliJsonEnvelope<T> {
  const code = resolveJsonCode(action, data);
  return {
    ok: true,
    action,
    code,
    timestamp: new Date().toISOString(),
    data,
  };
}

function buildJsonErrorEnvelope(
  action: CogniWeaveCliJsonErrorAction,
  code: CogniWeaveCliErrorCode,
  message: string,
): CogniWeaveCliJsonErrorEnvelope {
  return {
    ok: false,
    action,
    code,
    timestamp: new Date().toISOString(),
    error: {
      message,
    },
  };
}

function resolveOutputPreferences(argv: string[]): { outputJson: boolean; outputFile?: string } {
  const outputJson = argv.includes("--json");
  let outputFile: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      const value = argv[index + 1];
      if (value && !value.startsWith("-")) {
        outputFile = value;
      }
      break;
    }
  }
  return {
    outputJson,
    outputFile,
  };
}

function resolveJsonCode(action: CogniWeaveCliJsonAction, data: unknown): CogniWeaveCliJsonCode {
  if (action === "version") {
    return "VERSION_OK";
  }
  if (action === "print-config") {
    return "PRINT_CONFIG_OK";
  }
  if (action === "dry-run") {
    return "DRY_RUN_OK";
  }
  if (action === "serve-started") {
    return "SERVE_LISTENING";
  }
  if (action === "doctor") {
    return "DOCTOR_OK";
  }
  if (action === "recover") {
    return "RECOVER_OK";
  }
  if (action === "compact") {
    return "COMPACT_OK";
  }
  if (action === "journal-stats") {
    return "JOURNAL_STATS_OK";
  }
  const bootstrapResults = Array.isArray(data) ? data : [];
  const allBootstrapped = bootstrapResults.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as { status?: string }).status === "BOOTSTRAPPED",
  );
  if (action === "bootstrap-schema") {
    return allBootstrapped ? "BOOTSTRAP_SCHEMA_OK" : "BOOTSTRAP_SCHEMA_PARTIAL";
  }
  return allBootstrapped ? "BOOTSTRAP_SCHEMAS_OK" : "BOOTSTRAP_SCHEMAS_PARTIAL";
}

function hasBootstrapSchema(
  store: unknown,
): store is { bootstrapSchema: () => Promise<{ statementsExecuted?: number }> } {
  return (
    typeof (store as { bootstrapSchema?: unknown } | undefined)?.bootstrapSchema === "function"
  );
}

function parseValues(values: ParsedCliValues): CogniWeaveCliOptions {
  const defaultWorkspaceId = values.defaultWorkspaceId;
  const defaultProjectId = values.defaultProjectId;
  const defaultAgentId = values.defaultAgentId;
  const hasPartialScope =
    [defaultWorkspaceId, defaultProjectId, defaultAgentId].some((value) => value !== undefined) &&
    [defaultWorkspaceId, defaultProjectId, defaultAgentId].some((value) => value === undefined);

  if (hasPartialScope) {
    throw new Error("default scope requires workspace, project, and agent IDs");
  }

  const defaultVisibility = parseVisibility(values.defaultVisibility);
  const defaultScope =
    defaultWorkspaceId && defaultProjectId && defaultAgentId
      ? {
          workspaceId: defaultWorkspaceId,
          projectId: defaultProjectId,
          agentId: defaultAgentId,
          visibility: defaultVisibility ?? "private",
        }
      : undefined;

  return {
    command: "serve",
    helpRequested: false,
    versionRequested: false,
    outputJson: parseBooleanOption(values.outputJson, false),
    outputFile: values.outputFile,
    printConfig: parseBooleanOption(values.printConfig, false),
    dryRun: parseBooleanOption(values.dryRun, false),
    host: values.host ?? DEFAULT_HOST,
    port: parsePort(values.port),
    basePath: normalizeBasePath(values.basePath ?? DEFAULT_BASE_PATH),
    bootstrapSchemas: parseBooleanOption(values.bootstrapSchemas, false),
    environment: parseEnvironment(values.environment),
    metadataBackend: values.metadataBackend ?? "memory",
    metadataStorePath: values.metadataStorePath,
    graphBackend: values.graphBackend ?? "memory",
    evidenceBackend: values.evidenceBackend ?? "memory",
    vectorBackend: values.vectorBackend,
    enableLlmTaskFraming: parseBooleanOption(values.enableLlmTaskFraming, true),
    enableLlmDistillation: parseBooleanOption(values.enableLlmDistillation, true),
    enableVectorSeedRetrieval: parseBooleanOption(values.enableVectorSeedRetrieval, true),
    defaultScope,
    reasoningTimeoutMs: parseTimeout(values.reasoningTimeoutMs),
    evidenceLazyLoading: true,
    keepCompleted: parseKeepCompleted(values.keepCompleted),
  };
}

export function parseCogniWeaveCliArgs(argv: string[]): CogniWeaveCliOptions {
  const positionals: string[] = [];
  const values: ParsedCliValues = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "-h" || current === "--help") {
      values.help = true;
      continue;
    }
    if (!current.startsWith("-")) {
      positionals.push(current);
      continue;
    }

    const next = argv[index + 1];
    const readString = (): string => {
      if (next === undefined || next.startsWith("-")) {
        throw new Error(`Missing value for ${current}`);
      }
      index += 1;
      return next;
    };

    switch (current) {
      case "--host":
        values.host = readString();
        break;
      case "--port":
        values.port = readString();
        break;
      case "--base-path":
        values.basePath = readString();
        break;
      case "--environment":
        values.environment = readString();
        break;
      case "--metadata-backend":
        values.metadataBackend = readString();
        break;
      case "--metadata-store-path":
        values.metadataStorePath = readString();
        break;
      case "--graph-backend":
        values.graphBackend = readString();
        break;
      case "--evidence-backend":
        values.evidenceBackend = readString();
        break;
      case "--vector-backend":
        values.vectorBackend = readString();
        break;
      case "--enable-llm-task-framing":
        values.enableLlmTaskFraming = true;
        break;
      case "--no-enable-llm-task-framing":
        values.enableLlmTaskFraming = false;
        break;
      case "--enable-llm-distillation":
        values.enableLlmDistillation = true;
        break;
      case "--no-enable-llm-distillation":
        values.enableLlmDistillation = false;
        break;
      case "--enable-vector-seed-retrieval":
        values.enableVectorSeedRetrieval = true;
        break;
      case "--no-enable-vector-seed-retrieval":
        values.enableVectorSeedRetrieval = false;
        break;
      case "--bootstrap-schemas":
        values.bootstrapSchemas = true;
        break;
      case "--no-bootstrap-schemas":
        values.bootstrapSchemas = false;
        break;
      case "--json":
        values.outputJson = true;
        break;
      case "--output":
        values.outputFile = readString();
        break;
      case "--print-config":
        values.printConfig = true;
        break;
      case "--dry-run":
        values.dryRun = true;
        break;
      case "--version":
        values.version = true;
        break;
      case "--reasoning-timeout-ms":
        values.reasoningTimeoutMs = readString();
        break;
      case "--default-workspace-id":
        values.defaultWorkspaceId = readString();
        break;
      case "--default-project-id":
        values.defaultProjectId = readString();
        break;
      case "--default-agent-id":
        values.defaultAgentId = readString();
        break;
      case "--default-visibility":
        values.defaultVisibility = readString();
        break;
      case "--keep-completed":
        values.keepCompleted = readString();
        break;
      default:
        throw new Error(`Unknown option: ${current}`);
    }
  }

  const parsed = parseValues(values);

  if (values.help) {
    return { ...parsed, command: "help", helpRequested: true };
  }

  if (values.version) {
    return { ...parsed, command: "help", versionRequested: true };
  }

  if (positionals.length === 0) {
    return parsed;
  }

  const [command, ...rest] = positionals;
  const knownCommands: CliCommand[] = [
    "serve",
    "bootstrap-schema",
    "doctor",
    "recover",
    "compact",
    "journal-stats",
  ];
  if (knownCommands.includes(command as CliCommand)) {
    if (rest.length > 0) {
      throw new Error(`Unexpected positional arguments: ${rest.join(" ")}`);
    }
    return { ...parsed, command: command as CliCommand };
  }

  throw new Error(`Unknown command: ${command}`);
}

export function buildCogniWeaveEngineConfig(options: CogniWeaveCliOptions): EngineConfig {
  return {
    environment: options.environment,
    metadataBackend: options.metadataBackend,
    metadataStorePath: options.metadataStorePath,
    graphBackend: options.graphBackend,
    evidenceBackend: options.evidenceBackend,
    vectorBackend: options.vectorBackend,
    enableLlmTaskFraming: options.enableLlmTaskFraming,
    enableLlmDistillation: options.enableLlmDistillation,
    enableVectorSeedRetrieval: options.enableVectorSeedRetrieval,
    defaultScope: options.defaultScope,
    reasoningTimeoutMs: options.reasoningTimeoutMs,
    evidenceLazyLoading: options.evidenceLazyLoading,
  };
}

export function buildCogniWeaveHttpServerOptions(
  options: CogniWeaveCliOptions,
): CogniWeaveHttpServerOptions {
  return {
    basePath: options.basePath,
  };
}

export interface CogniWeaveCliConfigSnapshot {
  version: string;
  command: CliCommand;
  host: string;
  port: number;
  basePath: string;
  runtime: EngineConfig;
  http: CogniWeaveHttpServerOptions;
  adapterResolutions: AdapterBundle["resolutions"];
  dryRun: boolean;
}

export interface CogniWeaveServePlan {
  options: CogniWeaveCliOptions;
  config: EngineConfig;
  bundle: AdapterBundle;
  snapshot: CogniWeaveCliConfigSnapshot;
}

export async function bootstrapAdapterBundle(
  bundle: AdapterBundle,
): Promise<CogniWeaveCliBootstrapTargetResult[]> {
  const targets = [
    {
      kind: "metadata" as const,
      backend:
        bundle.resolutions.find((resolution) => resolution.descriptor.kind === "metadata")
          ?.descriptor.backend ?? "unknown",
      store: bundle.metadataStore,
    },
    {
      kind: "graph" as const,
      backend:
        bundle.resolutions.find((resolution) => resolution.descriptor.kind === "graph")?.descriptor
          .backend ?? "unknown",
      store: bundle.graphStore,
    },
    {
      kind: "vector" as const,
      backend:
        bundle.resolutions.find((resolution) => resolution.descriptor.kind === "vector")?.descriptor
          .backend ?? "unknown",
      store: bundle.vectorStore,
    },
  ];

  const results: CogniWeaveCliBootstrapTargetResult[] = [];
  for (const target of targets) {
    if (!hasBootstrapSchema(target.store)) {
      results.push({
        kind: target.kind,
        backend: target.backend,
        status: "SKIPPED",
        reason: "adapter does not expose bootstrapSchema()",
      });
      continue;
    }

    const result = await target.store.bootstrapSchema();
    results.push({
      kind: target.kind,
      backend: target.backend,
      status: "BOOTSTRAPPED",
      statementsExecuted: result.statementsExecuted,
    });
  }

  return results;
}

export function formatBootstrapSummary(results: CogniWeaveCliBootstrapTargetResult[]): string {
  return results
    .map((result) => {
      if (result.status === "BOOTSTRAPPED") {
        return `${result.kind}:${result.backend} bootstrapped (${result.statementsExecuted ?? 0} statements)`;
      }
      return `${result.kind}:${result.backend} skipped${result.reason ? ` (${result.reason})` : ""}`;
    })
    .join("\n");
}

function printHelp(): string {
  return [
    "CogniWeave SDK CLI",
    "",
    "Usage:",
    "  cogniweave serve [options]",
    "  cogniweave bootstrap-schema [options]",
    "  cogniweave doctor [options]",
    "  cogniweave recover [options]",
    "  cogniweave compact [options]",
    "  cogniweave journal-stats [options]",
    "",
    "Options:",
    "  --host <host>",
    "  --port <port>",
    "  --base-path <path>",
    "  --environment <local|service|cloud>",
    "  --metadata-backend <backend>",
    "  --metadata-store-path <path>",
    "  --graph-backend <backend>",
    "  --vector-backend <backend>",
    "  --evidence-backend <backend>",
    "  --bootstrap-schemas / --no-bootstrap-schemas",
    "  --keep-completed <n>   (compact: retain newest COMPLETED journals; default 20)",
    "  --json",
    "  --output <file>",
    "  --default-workspace-id <id>",
    "  --default-project-id <id>",
    "  --default-agent-id <id>",
    "  --default-visibility <private|shared>",
    "  --reasoning-timeout-ms <ms>",
    "  --print-config",
    "  --dry-run              (serve: no listen; compact: no delete)",
    "  --version",
    "  -h, --help",
    "",
    "Examples:",
    "  cogniweave serve --metadata-backend memory --graph-backend memory --vector-backend memory",
    "  cogniweave serve --metadata-backend local --metadata-store-path ./cogniweave.sqlite",
    "  cogniweave doctor --metadata-backend local --metadata-store-path ./cogniweave.sqlite --json",
    "  cogniweave recover --metadata-backend local --metadata-store-path ./cogniweave.sqlite",
    "  cogniweave compact --metadata-backend local --metadata-store-path ./cogniweave.sqlite --dry-run",
    "  cogniweave journal-stats --metadata-backend local --metadata-store-path ./cogniweave.sqlite --json",
    "  cogniweave bootstrap-schema --metadata-backend postgres --graph-backend neo4j --vector-backend pgvector",
  ].join("\n");
}

function createEngineFromPlan(plan: CogniWeaveServePlan): InMemoryCogniWeaveEngine {
  return new InMemoryCogniWeaveEngine(plan.config, {
    metadataStore: plan.bundle.metadataStore,
    graphStore: plan.bundle.graphStore,
    vectorStore: plan.bundle.vectorStore,
  });
}

export async function collectJournalStats(metadataStore: AdapterBundle["metadataStore"]): Promise<{
  total: number;
  byStatus: Record<string, number>;
  writeOperationCount: number;
}> {
  const journals = await metadataStore.listJournals();
  const byStatus: Record<string, number> = {};
  for (const journal of journals) {
    byStatus[journal.status] = (byStatus[journal.status] ?? 0) + 1;
  }
  const writeOperationCount =
    typeof metadataStore.listWriteOperations === "function"
      ? (await metadataStore.listWriteOperations()).length
      : 0;
  return { total: journals.length, byStatus, writeOperationCount };
}

export async function collectDoctorReport(metadataStore: AdapterBundle["metadataStore"]): Promise<{
  dataPlaneId?: string;
  journalStats: Awaited<ReturnType<typeof collectJournalStats>>;
  sourceBindingCount: number;
  liveSourceObjectLinkCount: number;
  orphanSourceBindingIds: string[];
}> {
  const journalStats = await collectJournalStats(metadataStore);
  const dataPlaneId =
    typeof metadataStore.getDataPlaneId === "function"
      ? await metadataStore.getDataPlaneId()
      : undefined;
  const bindings =
    typeof metadataStore.listSourceBindings === "function"
      ? await metadataStore.listSourceBindings()
      : [];
  const liveLinks =
    typeof metadataStore.listSourceObjectLinks === "function"
      ? await metadataStore.listSourceObjectLinks({ liveOnly: true })
      : [];
  const liveBindingIds = new Set(liveLinks.map((link) => link.sourceBindingId));
  const orphanSourceBindingIds = bindings
    .filter((binding) => !liveBindingIds.has(binding.id))
    .map((binding) => binding.id);
  return {
    dataPlaneId,
    journalStats,
    sourceBindingCount: bindings.length,
    liveSourceObjectLinkCount: liveLinks.length,
    orphanSourceBindingIds,
  };
}

async function readPackageVersion(): Promise<string> {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const raw = await readFile(packageJsonUrl, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}

export async function buildCogniWeaveCliConfigSnapshot(
  options: CogniWeaveCliOptions,
): Promise<CogniWeaveCliConfigSnapshot> {
  const runtime = buildCogniWeaveEngineConfig(options);
  const bundle = createAdapterBundle(runtime);
  const version = await readPackageVersion();
  return {
    version,
    command: options.command,
    host: options.host,
    port: options.port,
    basePath: options.basePath,
    runtime,
    http: buildCogniWeaveHttpServerOptions(options),
    adapterResolutions: bundle.resolutions,
    dryRun: options.dryRun,
  };
}

export async function buildCogniWeaveServePlan(
  options: CogniWeaveCliOptions,
): Promise<CogniWeaveServePlan> {
  const config = buildCogniWeaveEngineConfig(options);
  const bundle = createAdapterBundle(config);
  const snapshot = await buildCogniWeaveCliConfigSnapshot(options);
  return {
    options,
    config,
    bundle,
    snapshot,
  };
}

async function listen(
  server: ReturnType<typeof createCogniWeaveHttpServer>,
  host: string,
  port: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function closeServer(server: ReturnType<typeof createCogniWeaveHttpServer>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }
  return pathToFileURL(entryPoint).href === import.meta.url;
}

export async function runCogniWeaveCli(
  argv: string[] = process.argv.slice(2),
  io: Pick<Console, "log" | "error"> = console,
): Promise<number> {
  const fallbackPreferences = resolveOutputPreferences(argv);
  let options: CogniWeaveCliOptions | undefined;
  let currentAction: CogniWeaveCliJsonErrorAction = "error";

  const emitSuccess = async (
    action: CogniWeaveCliJsonAction,
    structured: unknown,
    plainText?: string,
  ): Promise<void> => {
    const outputJson = options?.outputJson ?? fallbackPreferences.outputJson;
    const outputFile = options?.outputFile ?? fallbackPreferences.outputFile;
    let outputText: string;
    if (outputJson) {
      outputText = JSON.stringify(buildJsonEnvelope(action, structured));
    } else if (plainText !== undefined) {
      outputText = plainText;
    } else {
      outputText = JSON.stringify(structured, null, 2);
    }
    if (outputFile) {
      await writeFile(outputFile, `${outputText}\n`, "utf8");
    }
    io.log(outputText);
  };

  const emitFailure = async (
    action: CogniWeaveCliJsonErrorAction,
    code: CogniWeaveCliErrorCode,
    message: string,
  ): Promise<void> => {
    const outputJson = options?.outputJson ?? fallbackPreferences.outputJson;
    const outputFile = options?.outputFile ?? fallbackPreferences.outputFile;
    const outputText = outputJson
      ? JSON.stringify(buildJsonErrorEnvelope(action, code, message))
      : message;
    if (outputFile) {
      await writeFile(outputFile, `${outputText}\n`, "utf8");
    }
    io.error(outputText);
  };

  try {
    options = parseCogniWeaveCliArgs(argv);
    currentAction = options.command;

    if (options.versionRequested) {
      const version = await readPackageVersion();
      await emitSuccess("version", { version }, version);
      return 0;
    }

    if (options.helpRequested || options.command === "help") {
      io.log(printHelp());
      return 0;
    }

    if (options.printConfig) {
      const plan = await buildCogniWeaveServePlan(options);
      await emitSuccess("print-config", plan.snapshot);
      return 0;
    }

    const plan = await buildCogniWeaveServePlan(options);

    if (options.command === "bootstrap-schema") {
      currentAction = "bootstrap-schema";
      let results: CogniWeaveCliBootstrapTargetResult[];
      try {
        results = await bootstrapAdapterBundle(plan.bundle);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await emitFailure(currentAction, "BOOTSTRAP_FAILED", message);
        return 1;
      }
      await emitSuccess("bootstrap-schema", results, formatBootstrapSummary(results));
      return 0;
    }

    if (options.command === "doctor") {
      currentAction = "doctor";
      const report = await collectDoctorReport(plan.bundle.metadataStore);
      const summary = [
        `dataPlaneId=${report.dataPlaneId ?? "n/a"}`,
        `journals=${report.journalStats.total}`,
        `writeOps=${report.journalStats.writeOperationCount}`,
        `bindings=${report.sourceBindingCount}`,
        `liveLinks=${report.liveSourceObjectLinkCount}`,
        `orphans=${report.orphanSourceBindingIds.length}`,
      ].join(" ");
      await emitSuccess("doctor", report, summary);
      return 0;
    }

    if (options.command === "journal-stats") {
      currentAction = "journal-stats";
      const stats = await collectJournalStats(plan.bundle.metadataStore);
      const summary = `journals=${stats.total} writeOps=${stats.writeOperationCount} byStatus=${JSON.stringify(stats.byStatus)}`;
      await emitSuccess("journal-stats", stats, summary);
      return 0;
    }

    if (options.command === "recover") {
      currentAction = "recover";
      const engine = createEngineFromPlan(plan);
      const scopeIn = options.defaultScope;
      const recoverScope =
        scopeIn?.workspaceId && scopeIn.projectId && scopeIn.agentId
          ? {
              workspaceId: scopeIn.workspaceId,
              projectId: scopeIn.projectId,
              agentId: scopeIn.agentId,
              visibility: scopeIn.visibility ?? ("private" as const),
            }
          : undefined;
      const recovered = await engine.recoverFromCanonical(
        recoverScope ? { scope: recoverScope } : undefined,
      );
      const summary = `recovered journalsRebuilt=${recovered.journalsRebuilt} writeOps=${recovered.writeOperationCount} orphans=${recovered.orphanSourceBindingIds.length}`;
      await emitSuccess("recover", recovered, summary);
      return 0;
    }

    if (options.command === "compact") {
      currentAction = "compact";
      const engine = createEngineFromPlan(plan);
      const compacted = await engine.compactJournals({
        keepCompleted: options.keepCompleted,
        dryRun: options.dryRun,
      });
      const summary = `${compacted.status} deleted=${compacted.deletedJournalIds.length} retained=${compacted.retainedJournalIds.length}`;
      await emitSuccess("compact", compacted, summary);
      return 0;
    }

    if (options.bootstrapSchemas) {
      currentAction = "bootstrap-schemas";
      let results: CogniWeaveCliBootstrapTargetResult[];
      try {
        results = await bootstrapAdapterBundle(plan.bundle);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await emitFailure(currentAction, "BOOTSTRAP_FAILED", message);
        return 1;
      }
      await emitSuccess("bootstrap-schemas", results, formatBootstrapSummary(results));
    }

    if (options.dryRun) {
      const url = formatServerUrl(options.host, options.port, options.basePath);
      await emitSuccess("dry-run", { status: "DRY_RUN_OK", url }, `Dry run ok: ${url}`);
      return 0;
    }

    const engine = new InMemoryCogniWeaveEngine(plan.config, {
      metadataStore: plan.bundle.metadataStore,
      graphStore: plan.bundle.graphStore,
      vectorStore: plan.bundle.vectorStore,
    });
    const service = new CogniWeaveRestService(engine);
    const server = createCogniWeaveHttpServer(service, buildCogniWeaveHttpServerOptions(options));

    try {
      await listen(server, options.host, options.port);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitFailure(currentAction, "LISTEN_FAILED", message);
      return 1;
    }

    const url = formatServerUrl(options.host, options.port, options.basePath);
    await emitSuccess(
      "serve-started",
      { status: "SERVE_LISTENING", url },
      `CogniWeave listening on ${url}`,
    );

    const shutdown = async (): Promise<void> => {
      await closeServer(server);
    };
    process.once("SIGINT", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown();
    });

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code: CogniWeaveCliErrorCode = options ? "INTERNAL_ERROR" : "INVALID_ARGUMENT";
    await emitFailure(currentAction, code, message);
    return 1;
  }
}

if (isMainModule()) {
  void runCogniWeaveCli().then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  });
}
