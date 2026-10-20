import { isLifecycleBindingSkillName } from "../skill-execution-binding/index.js";
import {
  extractSelectedSkillIdFromToolArgs,
  recordLifecycleSkillToolResult,
  recordLifecycleSkillToolStart,
} from "./record.js";

export type AgentToolEvent = {
  stream: string;
  data: Record<string, unknown>;
};

export type LifecycleSkillToolAttributionParams = {
  agentId: string;
  runId: string;
  sessionKey?: string | null;
  loadedSkillNames: string[];
};

/** Skill binding names loaded for this run (for unique-owner attribution). */
export function resolveLifecycleSkillNamesLoaded(skillNames: string[]): string[] {
  return skillNames.filter((name) => isLifecycleBindingSkillName(name));
}

/**
 * Wrap an agent event callback to record lifecycle skill tool start/result events.
 * Wired from pi-embedded `run/attempt.ts` (covers CLI `openbot agent`, auto-reply, gateway runs).
 * Compaction (`compact.ts`) does not execute tools — only LLM summarization; no hook here.
 */
export function createLifecycleSkillToolAttributionHandler(
  params: LifecycleSkillToolAttributionParams,
  options?: { onAgentEvent?: (evt: AgentToolEvent) => void },
): (evt: AgentToolEvent) => void {
  const openLifecycleToolCalls = new Map<
    string,
    { toolName: string; startedAt: number; toolArgs?: unknown }
  >();

  return (evt: AgentToolEvent) => {
    try {
      const agentId = params.agentId.trim();
      if (agentId && evt.stream === "tool") {
        const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
        const toolName = typeof evt.data.name === "string" ? evt.data.name : "";
        const toolCallId = typeof evt.data.toolCallId === "string" ? evt.data.toolCallId : "";
        const selectedFromEvent =
          typeof evt.data.selectedSkillId === "string" ? evt.data.selectedSkillId : null;
        if (phase === "start" && toolName && toolCallId) {
          const toolArgs = evt.data.args;
          const startedAt =
            typeof evt.data.startedAt === "number" ? evt.data.startedAt : Date.now();
          openLifecycleToolCalls.set(toolCallId, { toolName, startedAt, toolArgs });
          recordLifecycleSkillToolStart({
            agentId,
            runId: params.runId,
            toolName,
            toolCallId,
            loadedSkillNames: params.loadedSkillNames,
            selectedSkillId: selectedFromEvent ?? extractSelectedSkillIdFromToolArgs(toolArgs),
            toolArgs,
            sessionKey: params.sessionKey ?? null,
            startedAt,
          });
        } else if (phase === "result" && toolName && toolCallId) {
          const open = openLifecycleToolCalls.get(toolCallId);
          openLifecycleToolCalls.delete(toolCallId);
          const isError = evt.data.isError === true;
          recordLifecycleSkillToolResult({
            agentId,
            runId: params.runId,
            toolName,
            toolCallId,
            success: !isError,
            loadedSkillNames: params.loadedSkillNames,
            selectedSkillId:
              selectedFromEvent ?? extractSelectedSkillIdFromToolArgs(open?.toolArgs),
            toolArgs: open?.toolArgs,
            sessionKey: params.sessionKey ?? null,
            startedAt: open?.startedAt,
          });
        }
      }
    } catch {
      // never break tool pipeline
    }
    options?.onAgentEvent?.(evt);
  };
}
