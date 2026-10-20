import {
  BillingIngestClient,
  OpenAiCompatGatewayClient,
  OpenBotBackend,
  OpenBotGatewayRpcClient,
  OpenBotToolsInvokeClient,
  createOpenBotCapabilityRegistry,
  type GatewayRpcTransport,
  type OpenBotGatewayClient,
} from "@openbot/aor-backend-openbot";
import {
  type AorRunResult,
  BanditFeedbackStore,
  createPersistentBanditFeedbackStore,
  buildAuditRecord,
  type AorAuditRecord,
  type CapabilityRegistry,
  type Evaluator,
  type ExecutionBackend,
  type FeedbackStore,
  type ModelProfile,
  Orchestrator,
  type Planner,
  RuleBasedTaskParser,
  type SelectionStrategy,
  type Task,
  type TaskConstraints,
  type TaskParser,
  type TaskTypeRegistry,
  type TenantContext,
  type ToolInvoker,
  createBuiltinCapabilityRegistry,
  createBuiltinEvaluators,
  createBuiltinTaskTypeRegistry,
  defaultModelCatalog,
  traceToUsageIngest,
  type OptimizationReport,
} from "@openbot/aor-core";
import {
  type ObjectiveCodingEvaluatorOptions,
  createObjectiveCodingEvaluator,
} from "./coding-evaluator.js";

export interface AorClientConfig {
  backend: ExecutionBackend;
  modelCatalog?: ModelProfile[];
  defaultStrategy?: SelectionStrategy;
  parser?: TaskParser;
  taskTypes?: TaskTypeRegistry;
  capabilities?: CapabilityRegistry;
  evaluators?: Map<string, Evaluator>;
  feedback?: FeedbackStore;
  /** Task type used when the parser cannot classify a goal. */
  fallbackTaskType?: string;
  /** Task Graph planner; defaults to single-node. */
  planner?: Planner;
  /** When set, enables `usage-ingest.report` after runs with `reportBilling: true`. */
  billingTransport?: GatewayRpcTransport;
  /** Default runtime agent id for billing attribution (岗位汇报机器人明细). */
  defaultAgentId?: string;
  /** Lobster / plugin tool invoker for OpenBot tool skills. */
  toolInvoker?: ToolInvoker;
}

export interface AgentOptions {
  goal: string;
  constraints?: TaskConstraints;
  /** Pre-resolved task type (skips the parser). */
  type?: string;
  params?: Record<string, unknown>;
}

export interface AgentRunOptions {
  strategy?: SelectionStrategy;
  sessionKey?: string;
  signal?: AbortSignal;
  input?: unknown;
  referenceInput?: string;
  /** Correlation id for audit / billing (auto-generated when omitted). */
  runId?: string;
  /** Report trace to `usage-ingest.report` (requires `billingTransport` on the client). */
  reportBilling?: boolean;
  /** Dedup id for billing events (defaults to result.runId). */
  billingRunId?: string;
  /** Multi-tenant context for audit + billing userId. */
  tenant?: TenantContext;
  /** Runtime agent id for billing attribution (merged into tenant on ingest). */
  agentId?: string;
  /** Attach audit record to the returned result. */
  includeAudit?: boolean;
  /** Optimization savings for revenue-share billing ingest. */
  optimization?: OptimizationReport;
}

export interface AgentRunResult extends AorRunResult {
  audit?: AorAuditRecord;
}

/**
 * Developer-facing entry point. Describe a task; AOR does the rest:
 *   const client = createDefaultClient({ baseUrl });
 *   const agent = client.agent({ goal: "analyze this repo" });
 *   const result = await agent.run();
 */
export class AorClient {
  private readonly orchestrator: Orchestrator;
  private readonly billingTransport?: GatewayRpcTransport;
  private readonly defaultStrategy: SelectionStrategy;
  private readonly defaultAgentId?: string;

  constructor(config: AorClientConfig) {
    const taskTypes = config.taskTypes ?? createBuiltinTaskTypeRegistry();
    const fallback = config.fallbackTaskType ?? "coding.review";
    this.billingTransport = config.billingTransport;
    this.defaultStrategy = config.defaultStrategy ?? "balanced";
    this.defaultAgentId = config.defaultAgentId?.trim() || undefined;
    this.orchestrator = new Orchestrator({
      parser: config.parser ?? new RuleBasedTaskParser(taskTypes, fallback),
      taskTypes,
      capabilities: config.capabilities ?? createBuiltinCapabilityRegistry(),
      backend: config.backend,
      modelCatalog: config.modelCatalog ?? defaultModelCatalog(),
      evaluators: config.evaluators ?? createBuiltinEvaluators(),
      feedback: config.feedback,
      defaultStrategy: config.defaultStrategy ?? "balanced",
      planner: config.planner,
      toolInvoker: config.toolInvoker,
    });
  }

  agent(options: AgentOptions): Agent {
    return new Agent(
      this.orchestrator,
      options,
      this.billingTransport,
      this.defaultStrategy,
      this.defaultAgentId,
    );
  }
}

export class Agent {
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly options: AgentOptions,
    private readonly billingTransport?: GatewayRpcTransport,
    private readonly defaultStrategy: SelectionStrategy = "balanced",
    private readonly defaultAgentId?: string,
  ) {}

  async run(runOptions: AgentRunOptions = {}): Promise<AgentRunResult> {
    const task: Task = {
      goal: this.options.goal,
      type: this.options.type,
      params: this.options.params,
      constraints: this.options.constraints,
    };
    const strategy = runOptions.strategy ?? this.defaultStrategy;
    const billingTenant = enrichBillingTenant(
      runOptions.tenant,
      runOptions.agentId ?? this.defaultAgentId,
    );
    const result = await this.orchestrator.run(task, {
      ...runOptions,
      tenant: billingTenant,
    });
    if (runOptions.reportBilling && this.billingTransport) {
      await reportRunBilling({
        transport: this.billingTransport,
        result,
        runId: runOptions.billingRunId ?? result.runId,
        tenant: billingTenant,
        optimization: runOptions.optimization,
      });
    }
    const audit = runOptions.includeAudit
      ? buildAuditRecord({
          runId: result.runId,
          task,
          result,
          strategy,
          tenant: billingTenant,
        })
      : undefined;
    return audit ? { ...result, audit } : result;
  }
}

/** Merge per-run / client-default agentId into tenant for billing ingest. */
export function enrichBillingTenant(
  tenant: TenantContext | undefined,
  agentId: string | undefined,
): TenantContext | undefined {
  const resolvedAgentId = agentId?.trim() || tenant?.agentId?.trim();
  if (!tenant && !resolvedAgentId) {
    return undefined;
  }
  return {
    ...tenant,
    ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
  };
}

/** Map an AOR run trace onto `usage-ingest.report` (cost-budget data source). */
export async function reportRunBilling(params: {
  transport: GatewayRpcTransport;
  result: AorRunResult;
  runId: string;
  tenant?: TenantContext;
  optimization?: OptimizationReport;
}): Promise<void> {
  const payloads = traceToUsageIngest({
    trace: params.result.trace,
    runId: params.runId,
    tenant: params.tenant,
    optimization: params.optimization,
  });
  const ingest = new BillingIngestClient(params.transport);
  await ingest.reportAll(payloads);
}

export interface DefaultClientOptions {
  /**
   * OpenBot gateway HTTP URL (OpenAI compat + `/tools/invoke`).
   * When `transport` is set, agent runs over RPC; this URL still drives tool skills
   * unless `toolsBaseUrl` is set.
   */
  baseUrl?: string;
  apiKey?: string;
  defaultStrategy?: SelectionStrategy;
  modelCatalog?: ModelProfile[];
  feedback?: FeedbackStore;
  /** Inject a custom gateway client (defaults to OpenAI-compatible HTTP). */
  gatewayClient?: OpenBotGatewayClient;
  /**
   * Gateway RPC transport (non-HTTP). Uses OpenBot native `runWithModelFallback`
   * via public `agent.modelFallbacks`.
   */
  transport?: GatewayRpcTransport;
  /**
   * HTTP URL for `POST /tools/invoke` when agent traffic uses RPC `transport`.
   * Defaults to `baseUrl` (if HTTP(S)), else `AOR_GATEWAY_URL`, else `http://127.0.0.1:18789`.
   */
  toolsBaseUrl?: string;
  /** Override fetch used by {@link OpenBotToolsInvokeClient} (tests). */
  toolsFetchImpl?: typeof fetch;
  /**
   * Transport for `usage-ingest.report`. When set, pass `reportBilling: true`
   * on `agent.run()` to push trace metrics into cost-budget analytics.
   */
  billingTransport?: GatewayRpcTransport;
  /**
   * Default runtime agent id merged into billing `TenantContext.agentId`
   * when `reportBilling` is enabled.
   */
  agentId?: string;
  /**
   * Install the objective coding evaluator (build/test/coverage) for
   * `coding.review`, replacing the content-only default. Supply the workspace
   * and commands to score real task completion.
   */
  codingObjective?: ObjectiveCodingEvaluatorOptions;
  /** Fully override the evaluator map. */
  evaluators?: Map<string, Evaluator>;
  /** Task Graph planner; defaults to single-node. */
  planner?: Planner;
  /** Wire Lobster + plugin tool skills via `/tools/invoke` (default true). */
  enableOpenBotTools?: boolean;
  /** Use BanditFeedbackStore + default strategy `bandit`. */
  enableBandit?: boolean;
  /**
   * Persist bandit arms to this JSON path (implies `enableBandit` when feedback omitted).
   * Defaults to `AOR_BANDIT_STATE_PATH` when set.
   */
  banditStatePath?: string;
  capabilities?: CapabilityRegistry;
  taskTypes?: TaskTypeRegistry;
}

const DEFAULT_GATEWAY_HTTP_URL = "http://127.0.0.1:18789";

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/**
 * Resolve the HTTP gateway URL used for `/tools/invoke` (and OpenAI-compat when no RPC transport).
 */
export function resolveToolsHttpBaseUrl(
  options: Pick<DefaultClientOptions, "baseUrl" | "toolsBaseUrl">,
): string {
  const explicit = options.toolsBaseUrl?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const base = options.baseUrl?.trim() ?? "";
  if (base && isHttpUrl(base)) {
    return base.replace(/\/$/, "");
  }
  const fromEnv = process.env.AOR_GATEWAY_URL?.trim();
  if (fromEnv && isHttpUrl(fromEnv)) {
    return fromEnv.replace(/\/$/, "");
  }
  return DEFAULT_GATEWAY_HTTP_URL;
}

function resolveGatewayClient(options: DefaultClientOptions): OpenBotGatewayClient {
  if (options.gatewayClient) {
    return options.gatewayClient;
  }
  if (options.transport) {
    return new OpenBotGatewayRpcClient({ transport: options.transport });
  }
  const httpBase = resolveToolsHttpBaseUrl(options);
  return new OpenAiCompatGatewayClient({ baseUrl: httpBase, apiKey: options.apiKey });
}

/** Wire AOR to a running OpenBot gateway with sensible defaults. */
export function createDefaultClient(options: DefaultClientOptions): AorClient {
  const catalog = options.modelCatalog ?? defaultModelCatalog();
  const client = resolveGatewayClient(options);
  const backend = new OpenBotBackend({ client, knownModels: catalog.map((m) => m.ref) });
  const enableTools = options.enableOpenBotTools ?? true;
  const toolsHttpBaseUrl = resolveToolsHttpBaseUrl(options);
  const toolInvoker = enableTools
    ? new OpenBotToolsInvokeClient({
        baseUrl: toolsHttpBaseUrl,
        apiKey: options.apiKey,
        fetchImpl: options.toolsFetchImpl,
      })
    : undefined;
  const capabilities =
    options.capabilities ??
    (toolInvoker
      ? createOpenBotCapabilityRegistry(toolInvoker)
      : createBuiltinCapabilityRegistry());

  let evaluators = options.evaluators;
  if (!evaluators && options.codingObjective) {
    evaluators = createBuiltinEvaluators();
    evaluators.set(
      options.codingObjective.taskType ?? "coding.review",
      createObjectiveCodingEvaluator(options.codingObjective),
    );
  }

  const banditStatePath =
    options.banditStatePath?.trim() || process.env.AOR_BANDIT_STATE_PATH?.trim() || undefined;
  const banditEnabled = options.enableBandit ?? Boolean(banditStatePath);
  const feedback =
    options.feedback ??
    (banditStatePath
      ? createPersistentBanditFeedbackStore(banditStatePath)
      : banditEnabled
        ? new BanditFeedbackStore()
        : undefined);
  const defaultStrategy = options.defaultStrategy ?? (banditEnabled ? "bandit" : "balanced");

  return new AorClient({
    backend,
    modelCatalog: catalog,
    defaultStrategy,
    feedback,
    evaluators,
    planner: options.planner,
    billingTransport: options.billingTransport ?? options.transport,
    defaultAgentId: options.agentId,
    capabilities,
    taskTypes: options.taskTypes,
    toolInvoker,
  });
}

/** Gateway-RPC client: agent over RPC; Lobster/plugin tools over HTTP `/tools/invoke`. */
export function createGatewayRpcClient(
  transport: GatewayRpcTransport,
  options: Omit<DefaultClientOptions, "transport" | "gatewayClient"> = {},
): AorClient {
  return createDefaultClient({
    ...options,
    transport,
    toolsBaseUrl: options.toolsBaseUrl ?? resolveToolsHttpBaseUrl(options),
  });
}

export interface CodingClientOptions extends DefaultClientOptions {
  /** Workspace the build/test/coverage commands run in. */
  workspace?: string;
  build?: ObjectiveCodingEvaluatorOptions["build"];
  test?: ObjectiveCodingEvaluatorOptions["test"];
  coverage?: ObjectiveCodingEvaluatorOptions["coverage"];
}

/**
 * Coding-oriented client: makes the objective build/test/coverage evaluator the
 * default for `coding.review`, so coding runs are scored by real task
 * completion rather than content heuristics.
 */
export function createCodingClient(options: CodingClientOptions): AorClient {
  return createDefaultClient({
    ...options,
    codingObjective: {
      taskType: "coding.review",
      cwd: options.workspace,
      build: options.build,
      test: options.test ?? { command: "pnpm", args: ["test"] },
      coverage: options.coverage,
    },
  });
}

/** Bandit-learning client: Thompson sampling feedback + `bandit` selection strategy. */
export function createBanditClient(
  options: Omit<DefaultClientOptions, "enableBandit" | "defaultStrategy"> &
    Partial<Pick<DefaultClientOptions, "feedback" | "banditStatePath">>,
): AorClient {
  return createDefaultClient({
    ...options,
    enableBandit: true,
  });
}
