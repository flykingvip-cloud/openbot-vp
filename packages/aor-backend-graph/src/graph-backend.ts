import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  PlannedStep,
  RunContext,
  RunHandle,
} from "@openbot/aor-core";

/** Mutable state passed between graph nodes (LangGraph-style reducer pipeline). */
export interface GraphState {
  text: string;
  metadata: Record<string, unknown>;
}

export type GraphNodeFn = (
  state: GraphState,
  step: PlannedStep,
  ctx: RunContext,
) => GraphState | Promise<GraphState>;

export interface GraphNode {
  id: string;
  run: GraphNodeFn;
}

/** Linear graph pipeline keyed by task type. */
export interface GraphPipeline {
  nodes: GraphNode[];
}

/**
 * Graph-style ExecutionBackend: runs a registered node pipeline per task type.
 * Zero OpenBot coupling — validates that AOR can target graph orchestrators
 * (LangGraph-compatible shape) without forking the Orchestrator.
 */
export class GraphExecutionBackend implements ExecutionBackend {
  readonly id = "graph";
  private counter = 0;
  private readonly pending = new Map<string, Promise<BackendRunResult>>();

  constructor(
    private readonly pipelines: Map<string, GraphPipeline>,
    private readonly fallback: GraphPipeline,
  ) {}

  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: [] });
  }

  run(step: PlannedStep, ctx: RunContext): Promise<RunHandle> {
    const runId = `graph-${++this.counter}`;
    const pipeline = this.pipelines.get(step.taskType) ?? this.fallback;
    const promise = this.executePipeline(pipeline, step, ctx);
    this.pending.set(runId, promise);
    return Promise.resolve({ runId });
  }

  private async executePipeline(
    pipeline: GraphPipeline,
    step: PlannedStep,
    ctx: RunContext,
  ): Promise<BackendRunResult> {
    if (ctx.signal?.aborted) {
      throw new Error("aborted");
    }
    let state: GraphState = {
      text: step.prompt,
      metadata: { taskType: step.taskType, skillId: step.skillId },
    };
    for (const node of pipeline.nodes) {
      state = await node.run(state, step, ctx);
    }
    const text = state.text;
    return {
      text,
      usage: {
        inputTokens: Math.max(1, Math.floor(step.prompt.length / 4)),
        outputTokens: Math.max(1, Math.floor(text.length / 4)),
        totalTokens: Math.max(2, Math.floor((step.prompt.length + text.length) / 4)),
        costUsd: pipeline.nodes.length * 0.002,
      },
      raw: { backend: "graph", nodes: pipeline.nodes.map((n) => n.id), metadata: state.metadata },
    };
  }

  async *stream(handle: RunHandle): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "start" };
    const entry = this.pending.get(handle.runId);
    if (!entry) {
      yield { kind: "lifecycle", phase: "error", detail: "unknown run" };
      return;
    }
    try {
      const result = await entry;
      if (result.text) {
        yield { kind: "assistant", delta: result.text };
      }
      yield { kind: "lifecycle", phase: "end" };
    } catch (err) {
      yield { kind: "lifecycle", phase: "error", detail: String(err) };
    }
  }

  async wait(handle: RunHandle): Promise<BackendRunResult> {
    const entry = this.pending.get(handle.runId);
    if (!entry) {
      throw new Error(`Unknown run: ${handle.runId}`);
    }
    try {
      return await entry;
    } finally {
      this.pending.delete(handle.runId);
    }
  }

  abort(handle: RunHandle): Promise<void> {
    this.pending.delete(handle.runId);
    return Promise.resolve();
  }
}

/** Default coding.review pipeline: analyze → format findings. */
export function createDefaultGraphPipelines(): Map<string, GraphPipeline> {
  const analyze: GraphNode = {
    id: "analyze",
    run: (state) => ({
      ...state,
      text: state.text,
      metadata: { ...state.metadata, phase: "analyze" },
    }),
  };
  const format: GraphNode = {
    id: "format",
    run: (state) => ({
      ...state,
      text: `- finding: ${state.text.slice(0, 80)}\n- suggest: add tests`,
      metadata: { ...state.metadata, phase: "format" },
    }),
  };
  const summarize: GraphNode = {
    id: "compress",
    run: (state) => ({
      ...state,
      text: `SUMMARY: ${state.text.slice(0, 120)}`,
      metadata: { ...state.metadata, phase: "compress" },
    }),
  };
  return new Map<string, GraphPipeline>([
    ["coding.review", { nodes: [analyze, format] }],
    ["summarization", { nodes: [analyze, summarize] }],
  ]);
}

export function createGraphExecutionBackend(
  pipelines = createDefaultGraphPipelines(),
): GraphExecutionBackend {
  const fallback: GraphPipeline = {
    nodes: [
      {
        id: "echo",
        run: (state) => state,
      },
    ],
  };
  return new GraphExecutionBackend(pipelines, fallback);
}
