import type { AssetType } from "./skill-lifecycle-store.js";

/**
 * 资产准入与规范内容填充（Asset Admission & Standardized Content Filling）
 *
 * 这是"什么才算资产、资产要填哪些规范内容、什么时候才能进入孵化通道"的唯一事实源。
 * 员工/机器人产生的原始碎片（上传文档、自动识别的片段）只是 **候选（candidate）**，
 * 只有通过下面定义的规范内容填充后，才被 **纳入（admit）** 为可流转的资产，才允许：
 *   - 共享到协作小组（进入小组孵化）
 *   - 提交企业（进入企业孵化/标准化）
 *   - 被标记为"组织级候选"
 *
 * 分两级：
 *   1. admissible（硬门槛）：缺失/占位的价值身份内容会被硬拦截（如 顾氏医案.pdf 这类
 *      只有文件名、正文未解析的上传件）。
 *   2. ready（规范完成）：按类型补齐全部规范字段后才算内容规范填充完成，用于驱动详情页
 *      的填充清单与"组织级候选"徽章。
 */

/** 已识别的一级资产类型。知识文档仍可入库，但不进入「我的资产」。 */
export const RECOGNIZED_ASSET_TYPES: readonly AssetType[] = [
  "prompt",
  "template",
  "workflow",
  "knowledge",
  "agent",
  "capability",
  "tool",
  "mcp",
] as const;

/**
 * 可进入孵化通道的资产类型。识别类型均可进入孵化通道，但都必须先完成规范内容填充
 * （见 evaluateAssetContentReadiness）。类型本身不是准入依据，"规范内容 + 证据"才是。
 */
export const INCUBATION_ELIGIBLE_ASSET_TYPES: readonly AssetType[] = RECOGNIZED_ASSET_TYPES;

export function isIncubationEligibleType(assetType: AssetType): boolean {
  return INCUBATION_ELIGIBLE_ASSET_TYPES.includes(assetType);
}

export type AssetContentFieldKey =
  | "summary"
  | "usageExamples"
  | "inputDescription"
  | "outputDescription";

/** 规范字段的严重级别：block = 硬门槛（缺失即无法纳入）；recommend = 规范完成所需。 */
export type AssetContentSeverity = "block" | "recommend";

export type AssetContentRequirement = {
  field: AssetContentFieldKey;
  label: string;
  severity: AssetContentSeverity;
};

/** 结构化内容输入（对齐 EmployeeSkillProfile 的业务字段，结构化取用避免耦合）。 */
export type AssetContentInput = {
  assetType: AssetType;
  name?: string;
  summary?: string;
  usageExamples?: string[];
  inputDescription?: string;
  outputDescription?: string;
  category?: string;
  tags?: string[];
};

const FIELD_LABELS: Record<AssetContentFieldKey, Record<AssetType, string>> = {
  summary: {
    prompt: "一句话价值说明",
    template: "一句话价值说明",
    workflow: "一句话价值说明",
    knowledge: "一句话价值说明（这份知识解决什么问题）",
    agent: "角色定位与价值说明",
    capability: "一句话价值说明",
    tool: "一句话价值说明（这个工具帮机器人做什么）",
    mcp: "一句话价值说明（这个 MCP 服务提供什么能力）",
  },
  usageExamples: {
    prompt: "适用场景",
    template: "适用场景",
    workflow: "步骤 / 适用场景",
    knowledge: "适用范围",
    agent: "目标任务",
    capability: "适用场景",
    tool: "适用场景",
    mcp: "适用场景",
  },
  inputDescription: {
    prompt: "输入指令 / 约束",
    template: "变量槽位说明",
    workflow: "输入与依赖",
    knowledge: "来源说明",
    agent: "工作边界",
    capability: "输入说明",
    tool: "调用参数",
    mcp: "连接方式 / 启动命令",
  },
  outputDescription: {
    prompt: "输出预期",
    template: "模板正文",
    workflow: "输出与衔接",
    knowledge: "知识正文 / 内容",
    agent: "输出与协作方式",
    capability: "运行载体 / 输出说明",
    tool: "返回结果",
    mcp: "可调用的工具",
  },
};

/**
 * 各类型的规范内容要求（规范内容填充 schema）。
 * severity=block 的字段缺失/占位会硬拦截纳入；recommend 的字段用于"规范完成"判定。
 */
export const ASSET_CONTENT_REQUIREMENTS: Record<AssetType, AssetContentRequirement[]> = {
  knowledge: [
    { field: "summary", label: labelOf("summary", "knowledge"), severity: "block" },
    {
      field: "outputDescription",
      label: labelOf("outputDescription", "knowledge"),
      severity: "block",
    },
    { field: "usageExamples", label: labelOf("usageExamples", "knowledge"), severity: "recommend" },
    {
      field: "inputDescription",
      label: labelOf("inputDescription", "knowledge"),
      severity: "recommend",
    },
  ],
  prompt: [
    { field: "summary", label: labelOf("summary", "prompt"), severity: "block" },
    { field: "usageExamples", label: labelOf("usageExamples", "prompt"), severity: "recommend" },
    {
      field: "inputDescription",
      label: labelOf("inputDescription", "prompt"),
      severity: "recommend",
    },
    {
      field: "outputDescription",
      label: labelOf("outputDescription", "prompt"),
      severity: "recommend",
    },
  ],
  template: [
    { field: "summary", label: labelOf("summary", "template"), severity: "block" },
    {
      field: "outputDescription",
      label: labelOf("outputDescription", "template"),
      severity: "block",
    },
    { field: "usageExamples", label: labelOf("usageExamples", "template"), severity: "recommend" },
  ],
  workflow: [
    { field: "summary", label: labelOf("summary", "workflow"), severity: "block" },
    { field: "usageExamples", label: labelOf("usageExamples", "workflow"), severity: "recommend" },
    {
      field: "inputDescription",
      label: labelOf("inputDescription", "workflow"),
      severity: "recommend",
    },
    {
      field: "outputDescription",
      label: labelOf("outputDescription", "workflow"),
      severity: "recommend",
    },
  ],
  agent: [
    { field: "summary", label: labelOf("summary", "agent"), severity: "block" },
    { field: "usageExamples", label: labelOf("usageExamples", "agent"), severity: "recommend" },
    {
      field: "outputDescription",
      label: labelOf("outputDescription", "agent"),
      severity: "recommend",
    },
  ],
  capability: [
    { field: "summary", label: labelOf("summary", "capability"), severity: "block" },
    {
      field: "usageExamples",
      label: labelOf("usageExamples", "capability"),
      severity: "recommend",
    },
    {
      field: "inputDescription",
      label: labelOf("inputDescription", "capability"),
      severity: "recommend",
    },
    {
      field: "outputDescription",
      label: labelOf("outputDescription", "capability"),
      severity: "recommend",
    },
  ],
  tool: [
    { field: "summary", label: labelOf("summary", "tool"), severity: "block" },
    { field: "usageExamples", label: labelOf("usageExamples", "tool"), severity: "recommend" },
    {
      field: "inputDescription",
      label: labelOf("inputDescription", "tool"),
      severity: "recommend",
    },
  ],
  mcp: [
    { field: "summary", label: labelOf("summary", "mcp"), severity: "block" },
    { field: "usageExamples", label: labelOf("usageExamples", "mcp"), severity: "recommend" },
    {
      field: "inputDescription",
      label: labelOf("inputDescription", "mcp"),
      severity: "recommend",
    },
  ],
};

function labelOf(field: AssetContentFieldKey, assetType: AssetType): string {
  return FIELD_LABELS[field][assetType];
}

/**
 * 系统自动生成的占位/兜底文本，代表"内容其实没被人真正填写"。
 * 来源：src/gateway/knowledge/personal-document-upload.ts 与 personal-mutations.ts。
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /^上传文档\s+/, // derivePersonalDocumentSummary 的文件名兜底
  /全文解析将在后续版本提供/, // buildPersonalDocumentUploadDescription 的未解析占位
  /^知识宇宙文档上传[:：]/, // 上传文档自动生成的 inputDescription
  /^知识宇宙一键收录$/, // 一键收录自动生成的 inputDescription
] as const;

/** 判断一段文本是否只是系统占位/兜底，而非人工填写的真实内容。 */
export function isPlaceholderContent(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text) {
    return false;
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function fieldHasRealContent(input: AssetContentInput, field: AssetContentFieldKey): boolean {
  if (field === "usageExamples") {
    return (input.usageExamples ?? []).some((entry) => (entry ?? "").trim().length > 0);
  }
  const value = String(input[field] ?? "").trim();
  if (!value) {
    return false;
  }
  return !isPlaceholderContent(value);
}

export type AssetContentGap = {
  field: AssetContentFieldKey;
  label: string;
  severity: AssetContentSeverity;
};

export type AssetContentReadiness = {
  assetType: AssetType;
  /** 是否通过硬门槛（可被纳入资产、进入孵化通道）。 */
  admissible: boolean;
  /** 是否已按类型规范完成全部内容填充。 */
  ready: boolean;
  /** 缺失/占位的规范字段。 */
  gaps: AssetContentGap[];
  /** 面向用户的原因说明（用于 RPC 报错与 UI 提示）。 */
  reasons: string[];
};

/** 评估某个对象是否完成规范内容填充、是否可被纳入孵化通道。 */
export function evaluateAssetContentReadiness(input: AssetContentInput): AssetContentReadiness {
  const requirements =
    ASSET_CONTENT_REQUIREMENTS[input.assetType] ?? ASSET_CONTENT_REQUIREMENTS.capability;
  const gaps: AssetContentGap[] = requirements
    .filter((requirement) => !fieldHasRealContent(input, requirement.field))
    .map((requirement) => ({
      field: requirement.field,
      label: requirement.label,
      severity: requirement.severity,
    }));

  const blocking = gaps.filter((gap) => gap.severity === "block");
  const reasons: string[] = [];
  if (isPlaceholderContent(input.summary)) {
    reasons.push("价值说明仍是系统占位文本，请补充这份资产解决什么问题");
  }
  for (const gap of gaps) {
    reasons.push(`缺少${gap.label}`);
  }

  return {
    assetType: input.assetType,
    admissible: blocking.length === 0,
    ready: gaps.length === 0,
    gaps,
    reasons: [...new Set(reasons)],
  };
}

/** 生成一句可读的规范内容填充提示。 */
export function assetContentReadinessMessage(readiness: AssetContentReadiness): string {
  if (readiness.ready) {
    return "内容已按规范填充完成";
  }
  const labels = readiness.gaps.map((gap) => gap.label);
  return labels.length > 0
    ? `请先完成规范内容填充：${[...new Set(labels)].join("、")}`
    : "请先完成规范内容填充";
}

export class AssetAdmissionError extends Error {
  readonly readiness: AssetContentReadiness;
  constructor(readiness: AssetContentReadiness, action: string) {
    const blockingLabels = readiness.gaps
      .filter((gap) => gap.severity === "block")
      .map((gap) => gap.label);
    const detail =
      blockingLabels.length > 0
        ? `缺少${[...new Set(blockingLabels)].join("、")}`
        : (readiness.reasons[0] ?? "内容不完整");
    super(`${action}前需完成规范内容填充：${detail}`);
    this.name = "AssetAdmissionError";
    this.readiness = readiness;
  }
}

/**
 * 硬门槛断言：仅当对象缺失/占位价值身份内容（block 级）时抛错。
 * 用于共享/提交入口，阻止 顾氏医案.pdf 这类未填充的原始上传件直接进入孵化通道。
 */
export function assertAssetAdmissible(input: AssetContentInput, action: string): void {
  const readiness = evaluateAssetContentReadiness(input);
  if (!readiness.admissible) {
    throw new AssetAdmissionError(readiness, action);
  }
}
