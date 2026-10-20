import type { KnowledgeAccessState, KnowledgeObject, KnowledgeSource } from "../types.js";

export type KnowledgeComplianceMeta = {
  sourceSystem?: string;
  scopeLabel?: string;
  maskingSummary?: string;
  lineageId?: string;
  traceRefs?: string[];
  accessState?: KnowledgeAccessState;
};

const CONTROLLED_SOURCES = new Set<KnowledgeSource>(["enterprise", "data"]);

function defaultSourceSystem(source: KnowledgeSource): string {
  if (source === "enterprise") {
    return "企业知识";
  }
  if (source === "data") {
    return "数据能力";
  }
  return "个人知识";
}

function defaultScopeLabel(accessState: KnowledgeAccessState | undefined): string {
  if (accessState === "restricted") {
    return "需申请访问权限";
  }
  return "岗位可见";
}

function defaultMaskingSummary(params: {
  source: KnowledgeSource;
  accessState?: KnowledgeAccessState;
  maskedFieldCount?: number;
}): string {
  if (params.accessState === "restricted") {
    return "需申请访问权限后查看完整内容";
  }
  if (params.source === "data") {
    return "已按席位授权与脱敏策略展示";
  }
  if (params.maskedFieldCount && params.maskedFieldCount > 0) {
    return `已脱敏字段：${params.maskedFieldCount} 项`;
  }
  return "企业知识按可见性与脱敏策略展示";
}

export function applyKnowledgeCompliance(
  object: KnowledgeObject,
  meta: KnowledgeComplianceMeta = {},
): KnowledgeObject {
  if (!CONTROLLED_SOURCES.has(object.source)) {
    return object;
  }
  const accessState = meta.accessState ?? object.accessState ?? "accessible";
  return {
    ...object,
    accessState,
    sourceSystem:
      meta.sourceSystem?.trim() || object.sourceSystem || defaultSourceSystem(object.source),
    scopeLabel: meta.scopeLabel?.trim() || object.scopeLabel || defaultScopeLabel(accessState),
    maskingSummary:
      meta.maskingSummary?.trim() ||
      object.maskingSummary ||
      defaultMaskingSummary({
        source: object.source,
        accessState,
      }),
    ...(meta.lineageId ? { lineageId: meta.lineageId } : {}),
    ...(meta.traceRefs?.length ? { traceRefs: [...meta.traceRefs] } : {}),
  };
}

export function ensureControlledObjectGovernance(object: KnowledgeObject): KnowledgeObject {
  return applyKnowledgeCompliance(object);
}
