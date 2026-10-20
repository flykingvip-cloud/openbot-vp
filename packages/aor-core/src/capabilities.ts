import type { ExecutionBackend } from "./backend.js";
import type { ModelRef, NormalizedUsage, StepOutput, Task, TaskTypeId } from "./types.js";

/** Lightweight JSON Schema placeholder; kept dependency-free in core. */
export type JsonSchema = Record<string, unknown>;

/** Rough token expectation, used by the Selector to pre-estimate cost. */
export interface CostProfile {
  expectedInputTokens: number;
  expectedOutputTokens: number;
}

export interface SkillRunContext {
  task: Task;
  model: ModelRef;
  backend: ExecutionBackend;
  sessionKey?: string;
  signal?: AbortSignal;
  /** Optional structured input forwarded from the caller. */
  input?: unknown;
  /** Stable step id (graph node id); defaults to `${skillId}-0`. */
  stepId?: string;
  /** Ordered fallback models forwarded to the backend. */
  fallbackModels?: ModelRef[];
  /** OpenBot plugin/Lobster tool invoker (optional; required for tool-based skills). */
  toolInvoker?: import("./tool-invoker.js").ToolInvoker;
}

export interface SkillResult {
  output: StepOutput;
  usage: NormalizedUsage;
}

/**
 * A Skill is the unit a Task routes to. Users see the Skill (e.g.
 * "Code Analysis"); the implementation underneath can evolve from a single
 * model prompt to model + tools + sub-agent without breaking the contract.
 */
export interface Skill {
  id: string;
  taskTypes: TaskTypeId[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  costProfile: CostProfile;
  /** Render the prompt sent to the selected model. */
  buildPrompt(task: Task): string;
  /** Execute through the chosen backend + model. */
  run(ctx: SkillRunContext): Promise<SkillResult>;
}

export class CapabilityRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): this {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill already registered: ${skill.id}`);
    }
    this.skills.set(skill.id, skill);
    return this;
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /** First skill that advertises support for the given task type. */
  resolveForTaskType(taskType: TaskTypeId): Skill | undefined {
    for (const skill of this.skills.values()) {
      if (skill.taskTypes.includes(taskType)) {
        return skill;
      }
    }
    return undefined;
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }
}

/**
 * Default Skill implementation: build a prompt from a template and run it
 * through the backend in a single step. Built-in skills configure this with
 * task-specific templates and schemas.
 */
export class PromptSkill implements Skill {
  readonly id: string;
  readonly taskTypes: TaskTypeId[];
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly costProfile: CostProfile;
  private readonly template: (task: Task) => string;

  constructor(params: {
    id: string;
    taskTypes: TaskTypeId[];
    template: (task: Task) => string;
    costProfile: CostProfile;
    inputSchema?: JsonSchema;
    outputSchema?: JsonSchema;
  }) {
    this.id = params.id;
    this.taskTypes = [...params.taskTypes];
    this.template = params.template;
    this.costProfile = params.costProfile;
    this.inputSchema = params.inputSchema ?? { type: "object" };
    this.outputSchema = params.outputSchema ?? { type: "object" };
  }

  buildPrompt(task: Task): string {
    return this.template(task);
  }

  async run(ctx: SkillRunContext): Promise<SkillResult> {
    const prompt = this.buildPrompt(ctx.task);
    const handle = await ctx.backend.run(
      {
        id: ctx.stepId ?? `${this.id}-0`,
        taskType: ctx.task.type ?? this.taskTypes[0],
        skillId: this.id,
        prompt,
        model: ctx.model,
        fallbackModels: ctx.fallbackModels,
      },
      { sessionKey: ctx.sessionKey, signal: ctx.signal, input: ctx.input },
    );
    const result = await ctx.backend.wait(handle);
    return { output: { text: result.text, raw: result.raw }, usage: result.usage };
  }
}

/** One stage of a {@link PipelineSkill}. */
export interface PipelineStage {
  name: string;
  /** Build this stage's prompt from the task and the previous stage's output. */
  template: (task: Task, priorOutput: string) => string;
}

/**
 * A composite capability: a deterministic, ordered pipeline of model calls
 * (Lobster-style) implemented purely through the ExecutionBackend. Users see
 * one Skill; underneath it may be several stages. Each stage's output feeds the
 * next, and usage is summed across stages.
 */
export class PipelineSkill implements Skill {
  readonly id: string;
  readonly taskTypes: TaskTypeId[];
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly costProfile: CostProfile;
  private readonly stages: PipelineStage[];

  constructor(params: {
    id: string;
    taskTypes: TaskTypeId[];
    stages: PipelineStage[];
    costProfile: CostProfile;
    inputSchema?: JsonSchema;
    outputSchema?: JsonSchema;
  }) {
    if (params.stages.length === 0) {
      throw new Error(`PipelineSkill "${params.id}" needs at least one stage`);
    }
    this.id = params.id;
    this.taskTypes = [...params.taskTypes];
    this.stages = [...params.stages];
    this.costProfile = params.costProfile;
    this.inputSchema = params.inputSchema ?? { type: "object" };
    this.outputSchema = params.outputSchema ?? { type: "object" };
  }

  buildPrompt(task: Task): string {
    return this.stages[0].template(task, "");
  }

  async run(ctx: SkillRunContext): Promise<SkillResult> {
    let prior = "";
    let lastOutput: StepOutput = { text: "" };
    let usage: NormalizedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const baseStepId = ctx.stepId ?? this.id;

    for (const stage of this.stages) {
      const prompt = stage.template(ctx.task, prior);
      const handle = await ctx.backend.run(
        {
          id: `${baseStepId}:${stage.name}`,
          taskType: ctx.task.type ?? this.taskTypes[0],
          skillId: this.id,
          prompt,
          model: ctx.model,
          fallbackModels: ctx.fallbackModels,
        },
        { sessionKey: ctx.sessionKey, signal: ctx.signal, input: ctx.input },
      );
      const result = await ctx.backend.wait(handle);
      prior = result.text;
      lastOutput = { text: result.text, raw: result.raw };
      const hasCost = usage.costUsd !== undefined || result.usage.costUsd !== undefined;
      usage = {
        inputTokens: usage.inputTokens + result.usage.inputTokens,
        outputTokens: usage.outputTokens + result.usage.outputTokens,
        totalTokens: usage.totalTokens + result.usage.totalTokens,
        costUsd: hasCost ? (usage.costUsd ?? 0) + (result.usage.costUsd ?? 0) : undefined,
      };
    }

    return { output: lastOutput, usage };
  }
}

function asSourceText(task: Task, fallback: string): string {
  const source = task.params?.["sourceText"];
  return typeof source === "string" && source.length > 0 ? source : fallback;
}

/** Stage 1 built-in skills. */
export function createBuiltinSkills(): Skill[] {
  return [
    new PromptSkill({
      id: "coding.review",
      taskTypes: ["coding.review"],
      costProfile: { expectedInputTokens: 6000, expectedOutputTokens: 1500 },
      outputSchema: {
        type: "object",
        properties: { findings: { type: "array" } },
      },
      template: (task) =>
        [
          "You are a senior engineer performing a focused code review.",
          "Return concrete, actionable findings as a markdown list.",
          "For each finding include: the file/area, the issue, and a suggested fix.",
          "",
          `Goal: ${task.goal}`,
        ].join("\n"),
    }),
    new PromptSkill({
      id: "summarization",
      taskTypes: ["summarization"],
      costProfile: { expectedInputTokens: 3000, expectedOutputTokens: 400 },
      outputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
      },
      template: (task) => {
        const source = asSourceText(task, task.goal);
        return [
          "Summarize the following content faithfully and concisely.",
          "Preserve key facts; do not add information that is not present.",
          "",
          "Content:",
          source,
        ].join("\n");
      },
    }),
    new PromptSkill({
      id: "coding.refactor",
      taskTypes: ["coding.refactor"],
      costProfile: { expectedInputTokens: 7000, expectedOutputTokens: 2000 },
      template: (task) =>
        [
          "You are refactoring code for clarity and maintainability.",
          "Propose concrete refactor steps with file/function targets.",
          "",
          `Goal: ${task.goal}`,
        ].join("\n"),
    }),
    new PromptSkill({
      id: "coding.security",
      taskTypes: ["coding.security"],
      costProfile: { expectedInputTokens: 6500, expectedOutputTokens: 1800 },
      template: (task) =>
        [
          "Perform a security-focused review.",
          "List vulnerabilities, severity, and remediation steps.",
          "",
          `Goal: ${task.goal}`,
        ].join("\n"),
    }),
    new PromptSkill({
      id: "research.summary",
      taskTypes: ["research.summary"],
      costProfile: { expectedInputTokens: 5000, expectedOutputTokens: 1200 },
      template: (task) =>
        [
          "Research the topic and return a structured summary with key findings.",
          "",
          `Topic: ${task.goal}`,
        ].join("\n"),
    }),
    new PromptSkill({
      id: "ops.deploy",
      taskTypes: ["ops.deploy"],
      costProfile: { expectedInputTokens: 3000, expectedOutputTokens: 800 },
      template: (task) =>
        [
          "Produce a deploy/release checklist with ordered steps and rollback notes.",
          "",
          `Goal: ${task.goal}`,
        ].join("\n"),
    }),
  ];
}

/** Build a registry preloaded with the Stage 1 built-in skills. */
export function createBuiltinCapabilityRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const skill of createBuiltinSkills()) {
    registry.register(skill);
  }
  return registry;
}
