/**
 * skill-asset-curate-llm.ts — LLM-driven curation of a captured deliverable into a high-quality,
 * reusable skill-asset profile.
 *
 * The legacy My-Assets path built the asset profile by raw-copying the deliverable body and
 * applying regex heuristics (see skill-asset-context-extract.ts `buildProfileFromDeliverable`),
 * which produced low-quality assets (file names as titles, directory trees as summaries, canned
 * placeholders, spurious tags). This module instead asks an LLM to genuinely organize the
 * deliverable into structured fields. The caller is injectable (production builds one over
 * `completeSimple` via `createAgentKnowledgeLlmCaller`; tests pass a stub), so the pure core
 * (deliverable + llm → profile patch) is fully unit-testable offline. Callers MUST fall back to
 * the heuristic profile when this returns null (no model configured, LLM failure, or unusable
 * output).
 */

import type { AgentKnowledgeLlmCaller } from "./knowledge/agent-knowledge-generator.js";
import { exactMember, stringValue } from "./records.js";
import type {
  ResolvedSkillContextDeliverable,
  SkillContextProfilePatch,
} from "./skill-asset-context-extract.js";

/** Cap the deliverable body fed to the model to keep token cost bounded. */
const MAX_BODY_CHARS = 6_000;
const CURATE_MAX_TOKENS = 900;

const ASSET_TYPES = ["prompt", "template", "workflow", "knowledge", "agent", "capability"] as const;

type CuratedAssetType = SkillContextProfilePatch["assetType"];

function buildCuratePrompt(title: string, body: string): string {
  return [
    "你是一个能力资产整理专家。下面是用户在一次对话中产出的「交付物」。",
    "请把它整理成一个可复用、结构清晰、高质量的「能力资产」，而不是把原文照搬。",
    "整理要求：",
    "- name：简洁、有意义的能力名（动宾或名词短语）；禁止用文件名、路径或目录树片段当名字。",
    "- summary：不超过 120 字的一句话摘要，说明这个资产能做什么、产出什么；不要照抄正文或目录树。",
    `- assetType：从 [${ASSET_TYPES.join(", ")}] 中选最贴切的一个。`,
    "- inputDescription：使用该资产时需要提供哪些输入/素材/上下文。",
    "- outputDescription：清晰、结构化地描述该资产的产出；若正文是模板/SOP/文档，保留其有效的结构化内容（可用 markdown），但删除无意义的目录树、构建脚手架以及与复用无关的噪音。",
    "- usageExamples：2-4 条真实的复用场景（每条一句话）。",
    "- tags：3-6 个与内容真正相关的标签；不要给出无关标签。",
    "- category：一个合适的分类（如「工作汇报」「客户服务」「研发提效」「会议协作」等）；不确定就留空字符串。",
    "- 使用与交付物相同的语言输出。",
    '仅返回 JSON（不要额外解释）：{"name": "", "summary": "", "assetType": "", "inputDescription": "", "outputDescription": "", "usageExamples": [], "tags": [], "category": ""}。',
    "若交付物不足以形成可复用资产，仍尽量给出 name 与 summary，其余字段可留空。",
    "",
    `交付物标题：${title || "(无标题)"}`,
    "交付物正文：",
    body,
  ].join("\n");
}

/** Extract the first balanced JSON object from raw LLM text (tolerates ```json fences / prose). */
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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const text = asString(entry);
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function asAssetType(value: unknown): CuratedAssetType | undefined {
  return exactMember(stringValue(value), ASSET_TYPES) ?? undefined;
}

/** Turn a parsed JSON object into a validated profile patch, or null when unusable. */
export function parseCuratedProfile(obj: Record<string, unknown>): SkillContextProfilePatch | null {
  const name = asString(obj.name);
  const summary = asString(obj.summary);
  const outputDescription = asString(obj.outputDescription);
  // Require at least some real signal; otherwise let the caller fall back to heuristics.
  if (!name && !summary && !outputDescription) {
    return null;
  }
  const patch: SkillContextProfilePatch = {};
  if (name) {
    patch.name = name.slice(0, 80);
  }
  if (summary) {
    patch.summary = summary.slice(0, 200);
  }
  const assetType = asAssetType(obj.assetType);
  if (assetType) {
    patch.assetType = assetType;
  }
  const inputDescription = asString(obj.inputDescription);
  if (inputDescription) {
    patch.inputDescription = inputDescription;
  }
  if (outputDescription) {
    patch.outputDescription = outputDescription;
  }
  const usageExamples = asStringArray(obj.usageExamples, 4);
  if (usageExamples.length > 0) {
    patch.usageExamples = usageExamples;
  }
  const tags = asStringArray(obj.tags, 6);
  if (tags.length > 0) {
    patch.tags = tags;
  }
  const category = asString(obj.category);
  if (category) {
    patch.category = category.slice(0, 40);
  }
  return patch;
}

/**
 * Curate a captured deliverable into a structured, high-quality skill-asset profile patch using
 * the injected LLM caller. Returns null when the model produces nothing usable so callers fall
 * back to the heuristic profile. Never throws — the caller's own failures resolve to null.
 */
export async function curateSkillAssetProfile(params: {
  deliverable: Pick<ResolvedSkillContextDeliverable, "title" | "body">;
  llm: AgentKnowledgeLlmCaller;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}): Promise<SkillContextProfilePatch | null> {
  const body = params.deliverable.body.slice(0, MAX_BODY_CHARS).trim();
  if (!body) {
    return null;
  }
  const prompt = buildCuratePrompt(params.deliverable.title.trim(), body);
  let result: Awaited<ReturnType<AgentKnowledgeLlmCaller>>;
  try {
    result = await params.llm({ prompt, maxTokens: CURATE_MAX_TOKENS });
  } catch {
    return null;
  }
  if (!result) {
    return null;
  }
  params.onUsage?.({ inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  const obj = extractJsonObject(result.text);
  if (!obj) {
    return null;
  }
  return parseCuratedProfile(obj);
}
