/**
 * LLM-backed intent extractor for Digital Employee Creation.
 *
 * Replaces the regex/keyword D1 stage with a single structured LLM call.
 * Gracefully degrades: any failure returns null so callers fall back to the
 * offline rule engine.
 */

import { completeSimple, type TextContent } from "@earendil-works/pi-ai/compat";
import { getApiKeyForModel, requireApiKey } from "../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";
import { loadConfig } from "../config/config.js";
import type { EmployeeDesignIntent } from "./types.js";

const LLM_TIMEOUT_MS = 15_000;

/** Minimal config surface needed by the LLM call. */
export type LlmCompilerConfig = {
  cfg?: ReturnType<typeof loadConfig>;
};

/**
 * Raw structure returned by the LLM (parsed from JSON fence).
 * All fields optional — merge with rule-based result for safety.
 */
export type LlmDesignExtraction = {
  roleName?: string;
  roleFamily?: string;
  desiredOutcomes?: string[];
  responsibilities?: string[];
  constraints?: string[];
  policyRequirements?: string[];
  schedule?: string;
  delivery?: string;
  skills?: string[];
};

function isTextBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

function buildPrompt(rawRequest: string): string {
  return `你是企业数字员工设计系统的智能解析器。用户用自然语言描述了一个数字员工（机器人助手）的需求，请你把它拆解成结构化 JSON。

用户需求：
"""
${rawRequest}
"""

请输出一个 JSON 对象（用 \`\`\`json 包裹），字段说明：
- roleName: string — 这个数字员工最合适的中文角色名（如"销售助理"、"客户体验官"、"合同审查员"），简短精炼
- roleFamily: string — 角色所属领域，从以下选择：general_office / sales_customer / contract_legal / finance / hr / customer_service / content_marketing / tech_operations
- desiredOutcomes: string[] — 用户希望机器人完成的具体目标（每条≤20字）
- responsibilities: string[] — 日常职责清单（每条≤20字）
- constraints: string[] — 明确的限制或禁止事项
- policyRequirements: string[] — 涉及权限/数据访问的要求（如"可读取 CRM"、"禁止修改合同"）
- schedule?: string — 定时任务描述（如"每周一早9点"），无则省略
- delivery?: string — 输出物格式（如"销售周报"、"PDF 报告"），无则省略
- skills?: string[] — 需要用到的能力关键词（如"email"、"wechat-official"、"crm"），无把握时留空

只输出 JSON，不要解释。字段值用中文。`;
}

export function parseLlmDesignExtraction(raw: string): LlmDesignExtraction | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? raw.trim();
  const jsonStart = candidate.indexOf("{");
  const jsonEnd = candidate.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
    const result: LlmDesignExtraction = {};
    if (typeof parsed.roleName === "string" && parsed.roleName.trim()) {
      result.roleName = parsed.roleName.trim();
    }
    if (typeof parsed.roleFamily === "string" && parsed.roleFamily.trim()) {
      result.roleFamily = parsed.roleFamily.trim();
    }
    if (Array.isArray(parsed.desiredOutcomes)) {
      result.desiredOutcomes = (parsed.desiredOutcomes as unknown[])
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (Array.isArray(parsed.responsibilities)) {
      result.responsibilities = (parsed.responsibilities as unknown[])
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (Array.isArray(parsed.constraints)) {
      result.constraints = (parsed.constraints as unknown[])
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (Array.isArray(parsed.policyRequirements)) {
      result.policyRequirements = (parsed.policyRequirements as unknown[])
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (typeof parsed.schedule === "string" && parsed.schedule.trim()) {
      result.schedule = parsed.schedule.trim();
    }
    if (typeof parsed.delivery === "string" && parsed.delivery.trim()) {
      result.delivery = parsed.delivery.trim();
    }
    if (Array.isArray(parsed.skills)) {
      result.skills = (parsed.skills as unknown[])
        .filter((v): v is string => typeof v === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Convert the LLM extraction into the canonical EmployeeDesignIntent shape.
 * Always merges with a regex-based base so no fields are ever fully empty.
 */
export function mergeWithRuleIntent(
  base: EmployeeDesignIntent,
  llm: LlmDesignExtraction,
): EmployeeDesignIntent {
  const dedup = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];

  // Encode skill hints from LLM into desiredOutcomes so compose-draft picks them up.
  const skillOutcomes = (llm.skills ?? []).map((s) => `skill:${s}`);

  return {
    rawRequest: base.rawRequest,
    desiredOutcomes: dedup(llm.desiredOutcomes ?? [], [...base.desiredOutcomes, ...skillOutcomes]),
    responsibilities: dedup(llm.responsibilities ?? [], base.responsibilities),
    constraints: dedup(llm.constraints ?? [], base.constraints),
    policyRequirements: dedup(llm.policyRequirements ?? [], base.policyRequirements),
    ...((llm.schedule ?? base.schedule) ? { schedule: llm.schedule ?? base.schedule } : {}),
    ...((llm.delivery ?? base.delivery) ? { delivery: llm.delivery ?? base.delivery } : {}),
  };
}

/**
 * Call the default gateway model to extract structured design intent.
 * Returns null on any error (caller should fall back to rule engine).
 */
export async function extractDesignIntentWithLlm(
  rawRequest: string,
  options?: LlmCompilerConfig,
): Promise<LlmDesignExtraction | null> {
  const cfg = options?.cfg ?? loadConfig();
  const modelRef = resolveDefaultModelForAgent({ cfg });

  let resolved: Awaited<ReturnType<typeof resolveModel>>;
  try {
    resolved = await resolveModel(modelRef.provider, modelRef.model, undefined, cfg);
  } catch {
    return null;
  }
  if (!resolved.model) {
    return null;
  }

  let apiKey: string;
  try {
    apiKey = requireApiKey(
      await getApiKeyForModel({ model: resolved.model, cfg }),
      modelRef.provider,
    );
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await completeSimple(
      resolved.model,
      {
        messages: [
          {
            role: "user",
            content: buildPrompt(rawRequest),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        maxTokens: 600,
        temperature: 0.2,
        signal: controller.signal,
      },
    );
    const text = response.content
      .filter(isTextBlock)
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) {
      return null;
    }
    return parseLlmDesignExtraction(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
