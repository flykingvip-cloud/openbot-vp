const INTENT_BUCKETS: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "weekly-report", patterns: [/周报|周总结|weekly\s*report|week(?:ly)?\s*update/i] },
  { key: "competitive-analysis", patterns: [/竞品|竞争分析|competitive\s*analysis/i] },
  { key: "prd", patterns: [/需求文档|\bprd\b|产品需求/i] },
  { key: "meeting-notes", patterns: [/会议纪要|纪要|meeting\s*notes?/i] },
  { key: "business-plan", patterns: [/商业计划|business\s*plan/i] },
  { key: "customer-interview", patterns: [/客户访谈|用户访谈|interview/i] },
  { key: "retrospective", patterns: [/复盘|retrospective/i] },
  { key: "knowledge-article", patterns: [/知识|文档|报告|方案|template|模版|模板/i] },
];

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildNormalizedIntentKey(params: {
  text: string;
  hasArtifact: boolean;
  hasStructuredOutput: boolean;
}): string {
  const normalized = normalizeWhitespace(params.text).slice(0, 2000);
  for (const bucket of INTENT_BUCKETS) {
    if (bucket.patterns.some((pattern) => pattern.test(normalized))) {
      return bucket.key;
    }
  }
  if (params.hasArtifact) {
    return "artifact-delivery";
  }
  if (params.hasStructuredOutput) {
    return "structured-output";
  }
  return "general-task";
}

export function intentKeyLabel(intentKey: string): string {
  switch (intentKey) {
    case "weekly-report":
      return "周报生成";
    case "competitive-analysis":
      return "竞品分析";
    case "prd":
      return "产品需求文档";
    case "meeting-notes":
      return "会议纪要";
    case "business-plan":
      return "商业计划";
    case "customer-interview":
      return "客户访谈整理";
    case "retrospective":
      return "复盘总结";
    case "knowledge-article":
      return "知识/报告产出";
    case "artifact-delivery":
      return "交付物产出";
    case "structured-output":
      return "结构化任务";
    default:
      return "重复工作模式";
  }
}

export function suggestedAssetTypeForIntent(
  intentKey: string,
): import("../skill-models.ts").AssetType {
  switch (intentKey) {
    case "weekly-report":
    case "meeting-notes":
    case "retrospective":
    case "knowledge-article":
      return "template";
    case "competitive-analysis":
    case "business-plan":
    case "customer-interview":
      return "workflow";
    case "prd":
      return "template";
    default:
      return "capability";
  }
}
