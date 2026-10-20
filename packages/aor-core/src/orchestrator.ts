import { randomUUID } from "node:crypto";
import { resolveRunSessionKey, type TenantContext } from "./audit.js";
import type { ExecutionBackend } from "./backend.js";
import type { CapabilityRegistry, Skill } from "./capabilities.js";
import type { EvalResult, Evaluator } from "./evaluator.js";
import type { FeedbackStore } from "./feedback.js";
import type { TaskParser } from "./parser.js";
import {
  type PlanNode,
  type Planner,
  SingleNodePlanner,
  type TaskGraph,
  executionLevels,
} from "./planner.js";
import { type SelectionResult, type SelectionStrategy, rankModels } from "./selector.js";
import type { TaskTypeRegistry } from "./task-types.js";
import type { ExecutionPlan, ModelProfile, NormalizedUsage, StepOutput, Task } from "./types.js";

export interface OrchestratorDeps {
  parser: TaskParser;
  taskTypes: TaskTypeRegistry;
  capabilities: CapabilityRegistry;
  backend: ExecutionBackend;
  modelCatalog: ModelProfile[];
  evaluators?: Map<string, Evaluator>;
  feedback?: FeedbackStore;
  defaultStrategy?: SelectionStrategy;
  /** Task Graph planner; defaults to single-node (Stage 1 behaviour). */
  planner?: Planner;
  /** For Lobster / plugin tool skills (`/tools/invoke`). */
  toolInvoker?: import("./tool-invoker.js").ToolInvoker;
}

export interface RunOptions {
  strategy?: SelectionStrategy;
  sessionKey?: string;
  signal?: AbortSignal;
  input?: unknown;
  /** Source text used by the Evaluator (e.g. for summarization). */
  referenceInput?: string;
  /** Correlation id for audit / billing (auto-generated when omitted). */
  runId?: string;
  /** Multi-tenant context for audit and billing ingest. */
  tenant?: TenantContext;
}

export interface AorRunResult {
  /** Unique id for this run (audit / billing dedup). */
  runId: string;
  taskType: string;
  plan: ExecutionPlan;
  output: StepOutput;
  usage: NormalizedUsage;
  selection: SelectionResult;
  evaluation?: EvalResult;
  latencyMs: number;
  /** Per-step trace across the whole graph (1 entry in the single-node case). */
  trace: StepTrace[];
}

/** Per-node execution record for cost observability. */
export interface StepTrace {
  nodeId: string;
  taskType: string;
  skillId: string;
  model: string;
  estimatedCostUsd: number;
  usage: NormalizedUsage;
  latencyMs: number;
  evaluation?: EvalResult;
}

interface NodeRunResult {
  node: PlanNode;
  skill: Skill;
  selection: SelectionResult;
  output: StepOutput;
  usage: NormalizedUsage;
  latencyMs: number;
  evaluation?: EvalResult;
}

function emptyUsage(): NormalizedUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  const costA = a.costUsd ?? 0;
  const costB = b.costUsd ?? 0;
  const hasCost = a.costUsd !== undefined || b.costUsd !== undefined;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: hasCost ? costA + costB : undefined,
  };
}

/**
 * Orchestrator (Stage 2): parse -> plan (DAG) -> for each dependency level run
 * nodes in parallel { resolve skill -> select model -> execute -> evaluate ->
 * learn }, passing upstream outputs downstream. Single-node graphs reproduce
 * Stage 1 exactly, so the public `run` contract is unchanged.
 */
export class Orchestrator {
  private readonly planner: Planner;

  constructor(private readonly deps: OrchestratorDeps) {
    this.planner = deps.planner ?? new SingleNodePlanner();
  }

  async run(task: Task, opts: RunOptions = {}): Promise<AorRunResult> {
    const runId = opts.runId ?? randomUUID();
    const runOpts: RunOptions = {
      ...opts,
      runId,
      sessionKey: resolveRunSessionKey({
        sessionKey: opts.sessionKey,
        tenant: opts.tenant,
        runId,
      }),
    };

    const parsed = task.type
      ? { type: task.type, params: task.params ?? {}, confidence: 1 }
      : await this.deps.parser.parse(task.goal, task.constraints);

    const rootTask: Task = {
      ...task,
      type: parsed.type,
      params: { ...parsed.params, ...task.params },
    };

    const graph = await this.planner.plan(rootTask);
    const levels = executionLevels(graph);
    const strategy = runOpts.strategy ?? this.deps.defaultStrategy ?? "balanced";

    const outputs = new Map<string, StepOutput>();
    const runResults = new Map<string, NodeRunResult>();
    const startedAt = Date.now();

    for (const level of levels) {
      const settled = await Promise.all(
        level.map((node) => this.runNode(node, rootTask, graph, strategy, runOpts, outputs)),
      );
      for (const result of settled) {
        outputs.set(result.node.id, result.output);
        runResults.set(result.node.id, result);
      }
    }
    const latencyMs = Date.now() - startedAt;

    const terminalId = graph.terminalId ?? this.inferTerminal(graph);
    const terminal = runResults.get(terminalId);
    if (!terminal) {
      throw new Error(`Terminal node "${terminalId}" produced no result`);
    }

    let aggregateUsage = emptyUsage();
    const trace: StepTrace[] = [];
    const steps = [];
    for (const node of graph.nodes) {
      const r = runResults.get(node.id);
      if (!r) {
        continue;
      }
      aggregateUsage = addUsage(aggregateUsage, r.usage);
      trace.push({
        nodeId: node.id,
        taskType: r.node.taskType,
        skillId: r.skill.id,
        model: `${r.selection.model.provider}/${r.selection.model.id}`,
        estimatedCostUsd: r.selection.estimatedCostUsd,
        usage: r.usage,
        latencyMs: r.latencyMs,
        evaluation: r.evaluation,
      });
      steps.push({
        id: node.id,
        taskType: r.node.taskType,
        skillId: r.skill.id,
        prompt: r.skill.buildPrompt(this.buildNodeTask(node, rootTask, graph, outputs)),
        model: r.selection.model,
      });
    }

    const plan: ExecutionPlan = {
      taskType: parsed.type,
      steps,
      edges: graph.nodes.flatMap((node) => node.dependsOn.map((from) => ({ from, to: node.id }))),
    };

    return {
      runId,
      taskType: parsed.type,
      plan,
      output: terminal.output,
      usage: aggregateUsage,
      selection: terminal.selection,
      evaluation: terminal.evaluation,
      latencyMs,
      trace,
    };
  }

  private async runNode(
    node: PlanNode,
    rootTask: Task,
    graph: TaskGraph,
    strategy: SelectionStrategy,
    opts: RunOptions,
    outputs: Map<string, StepOutput>,
  ): Promise<NodeRunResult> {
    const nodeTask = this.buildNodeTask(node, rootTask, graph, outputs);
    const skill = this.resolveSkill(node.taskType, node.skillId);

    const candidates = this.deps.feedback
      ? this.deps.feedback.apply(this.deps.modelCatalog)
      : this.deps.modelCatalog;

    const ranked = rankModels({
      taskType: node.taskType,
      strategy,
      candidates,
      costProfile: skill.costProfile,
      constraints: rootTask.constraints,
    });
    const selection = ranked[0];
    const fallbackModels = ranked.slice(1).map((r) => r.model);

    const startedAt = Date.now();
    const { output, usage } = await skill.run({
      task: nodeTask,
      model: selection.model,
      backend: this.deps.backend,
      sessionKey: opts.sessionKey,
      signal: opts.signal,
      input: opts.input,
      stepId: node.id,
      fallbackModels,
      toolInvoker: this.deps.toolInvoker,
    });
    const latencyMs = Date.now() - startedAt;

    const evaluator = this.deps.evaluators?.get(node.taskType);
    let evaluation: EvalResult | undefined;
    if (evaluator) {
      const upstreamText = this.collectUpstreamText(node, outputs);
      evaluation = await evaluator.evaluate({
        task: nodeTask,
        output,
        usage,
        latencyMs,
        referenceInput: opts.referenceInput ?? upstreamText,
      });
      this.deps.feedback?.record(selection.model, node.taskType, evaluation);
    }

    return { node, skill, selection, output, usage, latencyMs, evaluation };
  }

  private buildNodeTask(
    node: PlanNode,
    rootTask: Task,
    _graph: TaskGraph,
    outputs: Map<string, StepOutput>,
  ): Task {
    const upstreamText = this.collectUpstreamText(node, outputs);
    const params: Record<string, unknown> = { ...rootTask.params };
    if (upstreamText) {
      params.sourceText = upstreamText;
      params.context = upstreamText;
    }
    return {
      goal: node.goal,
      type: node.taskType,
      params,
      constraints: rootTask.constraints,
    };
  }

  private collectUpstreamText(
    node: PlanNode,
    outputs: Map<string, StepOutput>,
  ): string | undefined {
    if (node.dependsOn.length === 0) {
      return undefined;
    }
    const parts = node.dependsOn
      .map((dep) => outputs.get(dep)?.text)
      .filter((text): text is string => typeof text === "string" && text.length > 0);
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  private inferTerminal(graph: TaskGraph): string {
    const hasDependents = new Set<string>();
    for (const node of graph.nodes) {
      for (const dep of node.dependsOn) {
        hasDependents.add(dep);
      }
    }
    const terminals = graph.nodes.filter((node) => !hasDependents.has(node.id));
    return (terminals.at(-1) ?? graph.nodes.at(-1))?.id ?? "n0";
  }

  private resolveSkill(taskType: string, skillId?: string): Skill {
    if (skillId) {
      const explicit = this.deps.capabilities.get(skillId);
      if (explicit) {
        return explicit;
      }
    }
    const def = this.deps.taskTypes.get(taskType);
    if (def) {
      const bySkillId = this.deps.capabilities.get(def.defaultSkillId);
      if (bySkillId) {
        return bySkillId;
      }
    }
    const byTaskType = this.deps.capabilities.resolveForTaskType(taskType);
    if (byTaskType) {
      return byTaskType;
    }
    throw new Error(`No skill registered for task type "${taskType}"`);
  }
}
