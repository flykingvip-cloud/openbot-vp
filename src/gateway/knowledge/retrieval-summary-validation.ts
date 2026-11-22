import type { RetrievalSummary } from "./retrieval-summary.js";
/** Same validation for model responses and maintenance writes. Unknown facts stay absent. */
export function parseRetrievalSummaryFields(
  value: unknown,
): RetrievalSummary["fields"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const fields = value as Record<string, unknown>;
  if (
    typeof fields.purpose !== "string" ||
    !fields.purpose.trim() ||
    fields.purpose.length > 4000
  ) {
    return undefined;
  }
  const names = ["keyPoints", "coverage", "entities", "boundaries"] as const;
  for (const name of names) {
    const list = fields[name];
    if (
      !Array.isArray(list) ||
      list.length > 100 ||
      list.some((item) => typeof item !== "string" || item.length > 4000)
    ) {
      return undefined;
    }
  }
  const navigation = [fields.purpose, ...names.flatMap((name) => fields[name] as string[])].join(
    "\n",
  );
  // Retrieval metadata must not propagate quoted prompt injection or generation meta-talk.
  // Reject the whole generation for review; never strip legitimate business negations.
  if (
    /(?:忽略(?:此前|之前|以上|所有|系统).{0,12}(?:规则|指令)|(?:输出|泄露|提供).{0,16}(?:API.?密钥|api.?key|系统提示)|ignore.{0,24}(?:instructions|rules)|(?:reveal|output).{0,20}(?:api.?key|system prompt)|(?:本次|我|模型).{0,10}(?:未执行|未调用|不会执行)|输出(?:只|仅)包含|摘要生成过程|(?:引用示例|不可信数据).{0,40}(?:未执行|不是执行指令|不执行))/iu.test(
      navigation,
    )
  ) {
    return undefined;
  }
  return {
    purpose: fields.purpose.trim(),
    keyPoints: fields.keyPoints as string[],
    coverage: fields.coverage as string[],
    entities: fields.entities as string[],
    boundaries: fields.boundaries as string[],
  };
}
