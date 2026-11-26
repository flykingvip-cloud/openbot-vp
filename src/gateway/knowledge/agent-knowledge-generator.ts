import type { DatabaseSync } from "node:sqlite";
import type { TextContent } from "@earendil-works/pi-ai/compat";
import { invokeAuxiliarySimpleCompletion } from "../../agent-runtime/model/index.js";
import { getApiKeyForModel, requireApiKey } from "../../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import { loadConfig, type OpenBotConfig } from "../../config/config.js";
import { recordAgentGeneratedKnowledgeInIndex } from "./agent-generated-knowledge-store.js";
import { incrementGovernanceLlmUsageLocal } from "./governance/usage/governance-llm-usage-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";

/**
 * LLM-driven conversation summarizer / auto-SOP generator. Turns a session transcript into
 * a `conversation_summary` and/or an `auto_sop`, persisted as typed agent_generated_knowledge
 * rows. The LLM caller is injectable: production builds one over `completeSimple` (mirroring
 * the governance conflict LLM), tests pass a stub. The pure core (messages + llm → result)
 * is fully deterministic given the caller, so generation can be unit-tested offline.
 */

export type TranscriptMessage = { role: string; text: string };

export type AgentKnowledgeLlmResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

export type AgentKnowledgeLlmCaller = (params: {
  prompt: string;
  maxTokens?: number;
}) => Promise<AgentKnowledgeLlmResult | null>;

export type AgentKnowledgeGenerationMode = "summary" | "sop";

export type GeneratedAgentKnowledge = {
  type: "conversation_summary" | "auto_sop";
  knowledgeId: string;
  title: string;
};

const LLM_TIMEOUT_MS = 20_000;
const MAX_TRANSCRIPT_CHARS = 6_000;
const MAX_TRANSCRIPT_MESSAGES = 40;

function isTextBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const typed = part as { type?: unknown; text?: unknown };
      return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Map raw session transcript entries (pi message objects) to {role, text} user/assistant turns. */
export function extractTranscriptMessages(raw: readonly unknown[]): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const message = entry as { role?: unknown; content?: unknown };
    const role = typeof message.role === "string" ? message.role : "";
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractText(message.content).trim();
    if (!text || text.startsWith("/")) {
      continue;
    }
    messages.push({ role, text });
  }
  return messages;
}

function roleLabel(role: string): string {
  return role === "assistant" ? "助手" : "用户";
}

/** Build a bounded transcript string (most recent turns, capped length) for the prompt. */
export function buildTranscriptText(messages: readonly TranscriptMessage[]): string {
  const recent = messages.slice(-MAX_TRANSCRIPT_MESSAGES);
  const lines = recent.map((m) => `${roleLabel(m.role)}: ${m.text.replace(/\s+/g, " ").trim()}`);
  let text = lines.join("\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    // Keep the tail (most recent context) when over budget.
    text = text.slice(text.length - MAX_TRANSCRIPT_CHARS);
  }
  return text;
}

function buildConversationSummaryPrompt(transcript: string): string {
  return [
    "你是一个知识沉淀助手。请阅读下面的对话记录，输出一个简洁、客观的会话总结。",
    "要求：抓住关键结论、决策与待办；忽略寒暄；使用与对话相同的语言。",
    '仅返回 JSON：{"title": "不超过30字的标题", "summary": "150字以内的总结"}。',
    "",
    "对话记录：",
    transcript,
  ].join("\n");
}

function buildSopPrompt(transcript: string): string {
  return [
    "你是一个流程沉淀助手。请从下面的对话中提炼出一份可复用的标准操作流程（SOP）。",
    "要求：只在对话确实包含可复用步骤时才提炼；步骤要可执行、有顺序；使用与对话相同的语言。",
    '仅返回 JSON：{"title": "SOP标题", "steps": ["步骤1", "步骤2", ...]}。',
    '若对话不包含可复用流程，返回 {"title": "", "steps": []}。',
    "",
    "对话记录：",
    transcript,
  ].join("\n");
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstLineTitle(text: string, max = 30): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) ?? text;
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function parseSummaryResult(text: string): { title: string; summary: string } | null {
  const obj = extractJsonObject(text);
  if (obj) {
    const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
    if (summary) {
      const title =
        typeof obj.title === "string" && obj.title.trim()
          ? obj.title.trim().slice(0, 60)
          : firstLineTitle(summary);
      return { title, summary };
    }
  }
  // Fallback: treat the raw text as the summary.
  const summary = text.trim();
  if (!summary) {
    return null;
  }
  return { title: firstLineTitle(summary), summary: summary.slice(0, 600) };
}

export function parseSopResult(
  text: string,
): { title: string; steps: string[]; summary: string } | null {
  const obj = extractJsonObject(text);
  if (!obj) {
    return null;
  }
  const stepsRaw = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = stepsRaw
    .map((step) => (typeof step === "string" ? step.trim() : ""))
    .filter((step): step is string => step.length > 0);
  if (steps.length === 0) {
    return null;
  }
  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim().slice(0, 60)
      : firstLineTitle(steps[0]);
  const summary = steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  return { title, steps, summary };
}

export async function generateConversationSummary(params: {
  messages: readonly TranscriptMessage[];
  llm: AgentKnowledgeLlmCaller;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}): Promise<{ title: string; summary: string } | null> {
  if (params.messages.length === 0) {
    return null;
  }
  const result = await params.llm({
    prompt: buildConversationSummaryPrompt(buildTranscriptText(params.messages)),
    maxTokens: 512,
  });
  if (!result) {
    return null;
  }
  params.onUsage?.({ inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  return parseSummaryResult(result.text);
}

export async function generateSop(params: {
  messages: readonly TranscriptMessage[];
  llm: AgentKnowledgeLlmCaller;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}): Promise<{ title: string; steps: string[]; summary: string } | null> {
  if (params.messages.length === 0) {
    return null;
  }
  const result = await params.llm({
    prompt: buildSopPrompt(buildTranscriptText(params.messages)),
    maxTokens: 700,
  });
  if (!result) {
    return null;
  }
  params.onUsage?.({ inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  return parseSopResult(result.text);
}

/**
 * Generate and persist agent knowledge from a transcript into the given knowledge index db.
 * Deterministic ids (`gen:summary:<sessionKey>` / `gen:sop:<sessionKey>`) make re-generation
 * idempotent. Generated knowledge starts as `pending` (AI output awaiting confirmation).
 * LLM token usage is tallied locally per kb (governance_llm_usage). Returns what was created.
 */
export async function generateAndRecordAgentKnowledge(params: {
  db: DatabaseSync;
  kbId: string;
  sessionKey: string;
  agentId?: string | null;
  messages: readonly TranscriptMessage[];
  llm: AgentKnowledgeLlmCaller;
  modes?: AgentKnowledgeGenerationMode[];
  nowMs?: number;
}): Promise<GeneratedAgentKnowledge[]> {
  const modes = params.modes ?? ["summary", "sop"];
  const nowMs = params.nowMs ?? Date.now();
  const sessionKey = params.sessionKey.trim() || "session";
  const sourceLineageId = `session:${sessionKey}`;
  const onUsage = (usage: { inputTokens: number; outputTokens: number }) => {
    incrementGovernanceLlmUsageLocal({
      db: params.db,
      kbId: params.kbId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      now: nowMs,
    });
  };
  const generated: GeneratedAgentKnowledge[] = [];

  if (modes.includes("summary")) {
    const summary = await generateConversationSummary({
      messages: params.messages,
      llm: params.llm,
      onUsage,
    });
    if (summary) {
      const knowledgeId = `gen:summary:${sessionKey}`;
      recordAgentGeneratedKnowledgeInIndex(params.db, {
        knowledgeId,
        kbId: params.kbId,
        type: "conversation_summary",
        agentId: params.agentId ?? null,
        title: summary.title,
        summary: summary.summary,
        sourceLineageId,
        status: "pending",
        nowMs,
      });
      generated.push({ type: "conversation_summary", knowledgeId, title: summary.title });
    }
  }

  if (modes.includes("sop")) {
    const sop = await generateSop({ messages: params.messages, llm: params.llm, onUsage });
    if (sop) {
      const knowledgeId = `gen:sop:${sessionKey}`;
      recordAgentGeneratedKnowledgeInIndex(params.db, {
        knowledgeId,
        kbId: params.kbId,
        type: "auto_sop",
        agentId: params.agentId ?? null,
        title: sop.title || "自动 SOP",
        summary: sop.summary,
        sourceLineageId,
        status: "pending",
        nowMs,
      });
      generated.push({ type: "auto_sop", knowledgeId, title: sop.title || "自动 SOP" });
    }
  }

  return generated;
}

/** Open the base's knowledge index and run generation against it. */
export async function generateAndRecordAgentKnowledgeForKnowledgeBase(params: {
  knowledgeBase: KnowledgeBase;
  sessionKey: string;
  agentId?: string | null;
  messages: readonly TranscriptMessage[];
  llm: AgentKnowledgeLlmCaller;
  modes?: AgentKnowledgeGenerationMode[];
  indexRoot?: string;
  nowMs?: number;
}): Promise<GeneratedAgentKnowledge[]> {
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return await generateAndRecordAgentKnowledge({
      db: index.db,
      kbId: params.knowledgeBase.id,
      sessionKey: params.sessionKey,
      agentId: params.agentId ?? null,
      messages: params.messages,
      llm: params.llm,
      ...(params.modes ? { modes: params.modes } : {}),
      ...(params.nowMs != null ? { nowMs: params.nowMs } : {}),
    });
  } finally {
    index.close();
  }
}

/**
 * Build the production LLM caller over `completeSimple`, resolving the configured default
 * model + credentials (mirrors the governance conflict LLM client). Returns null when no
 * model is configured; all call failures resolve to null so generation never throws.
 */
export function createAgentKnowledgeLlmCaller(params?: {
  cfg?: OpenBotConfig;
  agentId?: string;
}): AgentKnowledgeLlmCaller | null {
  const cfg = params?.cfg ?? loadConfig();
  const modelRef = resolveDefaultModelForAgent({
    cfg,
    ...(params?.agentId ? { agentId: params.agentId } : {}),
  });
  if (!modelRef?.provider || !modelRef?.model) {
    return null;
  }
  return async ({ prompt, maxTokens }) => {
    const resolved = await resolveModel(modelRef.provider, modelRef.model, undefined, cfg);
    if (!resolved.model) {
      return null;
    }
    const model = resolved.model;
    let apiKey: string;
    try {
      apiKey = requireApiKey(await getApiKeyForModel({ model, cfg }), modelRef.provider);
    } catch {
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const response = await invokeAuxiliarySimpleCompletion(
        model,
        { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
        { apiKey, maxTokens: maxTokens ?? 512, temperature: 0.2, signal: controller.signal },
      );
      const text = response.content
        .filter(isTextBlock)
        .map((block) => block.text)
        .join("")
        .trim();
      if (!text) {
        return null;
      }
      const usage = response.usage;
      return {
        text,
        inputTokens: Math.max(0, Math.floor(usage?.input ?? 0)),
        outputTokens: Math.max(0, Math.floor(usage?.output ?? 0)),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  };
}
