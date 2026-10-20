import type {
  CostProfile,
  JsonSchema,
  Skill,
  SkillResult,
  SkillRunContext,
} from "./capabilities.js";
import type { ToolInvoker } from "./tool-invoker.js";
import type { NormalizedUsage, StepOutput, Task } from "./types.js";

function emptyUsage(): NormalizedUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function serializeToolOutput(result: unknown): StepOutput {
  if (typeof result === "string") {
    return { text: result };
  }
  return { text: JSON.stringify(result, null, 2), raw: result };
}

function requireInvoker(ctx: SkillRunContext): ToolInvoker {
  if (!ctx.toolInvoker) {
    throw new Error("ToolInvoker required for OpenBot plugin/Lobster skills");
  }
  return ctx.toolInvoker;
}

function readStringParam(task: Task, key: string): string | undefined {
  const value = task.params?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Runs a Lobster pipeline through OpenBot's public `lobster` plugin tool
 * (`POST /tools/invoke`). Task params: `pipeline` (path or inline spec),
 * optional `argsJson`, optional `lobsterPath`.
 */
export class LobsterPipelineSkill implements Skill {
  readonly id = "lobster.pipeline";
  readonly taskTypes = ["lobster.pipeline"];
  readonly inputSchema: JsonSchema = {
    type: "object",
    properties: {
      pipeline: { type: "string", description: "Lobster pipeline path or inline spec" },
      argsJson: { type: "string" },
    },
    required: ["pipeline"],
  };
  readonly outputSchema: JsonSchema = { type: "object" };
  readonly costProfile: CostProfile = {
    expectedInputTokens: 0,
    expectedOutputTokens: 0,
  };

  buildPrompt(task: Task): string {
    const pipeline = readStringParam(task, "pipeline") ?? task.goal;
    return `lobster pipeline: ${pipeline}`;
  }

  async run(ctx: SkillRunContext): Promise<SkillResult> {
    const invoker = requireInvoker(ctx);
    const pipeline = readStringParam(ctx.task, "pipeline") ?? ctx.task.goal;
    const argsJson = readStringParam(ctx.task, "argsJson");
    const lobsterPath = readStringParam(ctx.task, "lobsterPath");
    const args: Record<string, unknown> = { action: "run", pipeline };
    if (argsJson) {
      args.argsJson = argsJson;
    }
    if (lobsterPath) {
      args.lobsterPath = lobsterPath;
    }
    const res = await invoker.invoke({
      tool: "lobster",
      args,
      sessionKey: ctx.sessionKey,
    });
    if (!res.ok) {
      throw new Error(res.error ?? "lobster tool invoke failed");
    }
    return { output: serializeToolOutput(res.result), usage: emptyUsage() };
  }
}

/**
 * Invokes any OpenBot plugin/core tool by name via `/tools/invoke`.
 * Task params: `toolName`, optional `toolArgs`, optional `toolAction`.
 */
export class PluginToolSkill implements Skill {
  readonly id = "plugin.tool";
  readonly taskTypes = ["plugin.tool"];
  readonly inputSchema: JsonSchema = {
    type: "object",
    properties: {
      toolName: { type: "string" },
      toolArgs: { type: "object" },
      toolAction: { type: "string" },
    },
    required: ["toolName"],
  };
  readonly outputSchema: JsonSchema = { type: "object" };
  readonly costProfile: CostProfile = {
    expectedInputTokens: 0,
    expectedOutputTokens: 0,
  };

  buildPrompt(task: Task): string {
    const tool = readStringParam(task, "toolName") ?? "unknown";
    return `plugin tool: ${tool}`;
  }

  async run(ctx: SkillRunContext): Promise<SkillResult> {
    const invoker = requireInvoker(ctx);
    const tool = readStringParam(ctx.task, "toolName");
    if (!tool) {
      throw new Error("plugin.tool requires task.params.toolName");
    }
    const toolArgs = ctx.task.params?.toolArgs;
    const args =
      toolArgs && typeof toolArgs === "object" && !Array.isArray(toolArgs)
        ? (toolArgs as Record<string, unknown>)
        : {};
    const action = readStringParam(ctx.task, "toolAction");
    const res = await invoker.invoke({
      tool,
      args,
      action,
      sessionKey: ctx.sessionKey,
    });
    if (!res.ok) {
      throw new Error(res.error ?? `tool "${tool}" invoke failed`);
    }
    return { output: serializeToolOutput(res.result), usage: emptyUsage() };
  }
}
