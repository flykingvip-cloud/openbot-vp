import { labelForDesignTag, resolveTagDraft } from "./workbench-design-catalog.ts";
import type {
  WorkbenchAgentCreatorRoleSource,
  WorkbenchAgentCreatorState,
  WorkbenchAgentCreatorStep,
  WorkbenchAgentDesignMappingView,
  WorkbenchAgentDesignState,
} from "./workbench-types.ts";

export const DESIGN_ROLE_LABELS: Record<string, string> = {
  sales_assistant: "销售助理",
  general_office_assistant: "通用办公助理",
  office_assistant: "办公助理",
  sales_operations_analyst: "销售运营分析师",
  contract_reviewer: "合同审查员",
  finance_assistant: "财务助理",
  market_analyst: "市场运营分析师",
  personal_mail_assistant: "邮件助手",
  hr_assistant: "人事助理",
  customer_service_assistant: "客服助理",
  tech_operations_assistant: "技术运营助理",
  custom_draft: "自定义草稿",
};

export const DESIGN_SKILL_LABELS: Record<string, string> = {
  "sales-coach": "销售辅导",
  summarize: "摘要整理",
  "nano-pdf": "PDF 阅读",
  defuddle: "网页内容提炼",
  "personal-mail-assistant": "个人邮件助手",
};

export const DESIGN_POLICY_LABELS: Record<string, string> = {
  "crm.read": "读取客户资料",
  "crm.write": "改写客户资料",
  "email.send": "发送邮件",
  "internal.read": "读取内部资料",
  "document.read": "读取文档",
  "finance.read": "读取财务数据",
  "finance.write": "改写财务数据",
  "web.read": "浏览公开网页",
  "public.publish": "对外发布内容",
};

export const DESIGN_POLICY_EFFECT_LABELS: Record<string, string> = {
  recommended: "建议开启",
  confirmation_required: "操作前需确认",
  disabled: "禁止",
};

export const DESIGN_ROLE_EMOJI: Record<string, string> = {
  sales_assistant: "💼",
  sales_operations_analyst: "📈",
  contract_reviewer: "📄",
  general_office_assistant: "🤖",
  office_assistant: "🤖",
  finance_assistant: "💰",
  market_analyst: "📊",
  personal_mail_assistant: "✉️",
  hr_assistant: "👥",
  customer_service_assistant: "🎧",
  tech_operations_assistant: "🛠️",
};

const CJK_RE = /[\u4e00-\u9fff]/;

export function labelForRole(idOrDisplay: string | undefined): string {
  const key = idOrDisplay?.trim() ?? "";
  if (!key) {
    return "待匹配角色";
  }
  return DESIGN_ROLE_LABELS[key] ?? (CJK_RE.test(key) ? key : key);
}

export function labelForSkill(skillKey: string | undefined, fallback?: string): string {
  const key = skillKey?.trim() || fallback?.trim() || "";
  if (!key) {
    return "未命名能力";
  }
  return DESIGN_SKILL_LABELS[key] ?? (CJK_RE.test(key) ? key : key);
}

export function labelForPolicy(id: string): string {
  return DESIGN_POLICY_LABELS[id] ?? id;
}

export function labelForPolicyEffect(effect: string): string {
  return DESIGN_POLICY_EFFECT_LABELS[effect] ?? effect;
}

export function resolveAgentCreatorStep(
  state: Pick<WorkbenchAgentCreatorState, "step" | "roleSource" | "design">,
): WorkbenchAgentCreatorStep {
  const declared = state.step;
  if (declared === "review" && !state.design.mapping) {
    return "intent";
  }
  if (
    declared === "identity" &&
    (state.roleSource ?? "ai") === "ai" &&
    state.design.mapping &&
    !state.design.confirmed
  ) {
    return "review";
  }
  if (declared === "intent" || declared === "review" || declared === "identity") {
    return declared;
  }
  if (state.roleSource === "template" || state.design.confirmed) {
    return "identity";
  }
  if (state.design.mapping) {
    return "review";
  }
  return "intent";
}

export function resolveAgentCreatorRoleSource(
  state: Pick<WorkbenchAgentCreatorState, "roleSource" | "design">,
): WorkbenchAgentCreatorRoleSource {
  if (state.roleSource === "template" || state.roleSource === "ai") {
    return state.roleSource;
  }
  return state.design.mapping ? "ai" : "ai";
}

export function suggestAgentNameFromDesign(
  mapping: WorkbenchAgentDesignMappingView | null,
  intentText: string,
  templates: Array<{ templateId: string; displayName: string }>,
): string {
  const roleId = mapping?.role.blueprintId ?? "";
  const localized = DESIGN_ROLE_LABELS[roleId];
  if (localized) {
    return localized;
  }
  const display = mapping?.role.display?.trim() ?? "";
  if (display && CJK_RE.test(display) && display !== "自定义草稿") {
    return display;
  }
  const template = templates.find(
    (entry) => entry.templateId === roleId || entry.displayName === display,
  );
  if (template?.displayName.trim()) {
    return template.displayName.trim();
  }
  if (display && display !== "custom_draft") {
    return labelForRole(display);
  }
  const intent = intentText.trim();
  if (intent && intent.length <= 16 && !/[，,]/.test(intent)) {
    return intent;
  }
  return "";
}

export function suggestAgentEmojiFromDesign(
  mapping: WorkbenchAgentDesignMappingView | null,
): string {
  const roleId = mapping?.role.blueprintId ?? mapping?.role.display ?? "";
  return DESIGN_ROLE_EMOJI[roleId] ?? "🤖";
}

export function summarizeDesignCapabilities(
  mapping: WorkbenchAgentDesignMappingView | null,
  design?: WorkbenchAgentDesignState | null,
): string {
  if (design) {
    const labels = resolveTagDraft(design)
      .capabilities.map((id) => labelForDesignTag(id, "capability", design.tagDraft))
      .filter(Boolean);
    if (labels.length > 0) {
      return labels.join("、");
    }
  }
  const labels = (mapping?.capabilities ?? [])
    .map((entry) => labelForSkill(entry.skillKey, entry.need))
    .filter(Boolean);
  if (labels.length === 0) {
    return "暂无匹配能力";
  }
  return labels.join("、");
}

export function splitQuestionOptions(text: string): string[] {
  const trimmed = text.replace(/[？?]+$/u, "").trim();
  if (!trimmed) {
    return [];
  }
  if (!/还是|或/.test(trimmed)) {
    return [];
  }
  const body = trimmed.replace(/^主要负责/, "").replace(/^是/, "");
  return body
    .split(/还是|或|、|，|,/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 16);
}

export function hasBlockingDesignGaps(design: WorkbenchAgentDesignState): boolean {
  const missing = design.mapping?.gaps.missing ?? [];
  return missing.length > 0 && !design.canConfirm;
}
