import { recordOrNull as asRecord } from "../records.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import type {
  DataGatewaySuccessResponse,
  EnterpriseKnowledgeProjectionSpec,
  ProjectionTemplateKey,
} from "./types.js";

export type ProjectionTemplateResult = {
  title: string;
  payload: Record<string, unknown>;
};

function applyNormalizeTemplate(params: {
  spec: Pick<EnterpriseKnowledgeProjectionSpec, "displayName" | "projectionKey">;
  gatewayData: unknown;
}): ProjectionTemplateResult {
  const root = asRecord(params.gatewayData);
  const customer = root ? asRecord(root.customer) : null;
  const title =
    typeof customer?.name === "string" && customer.name.trim()
      ? `${customer.name} 画像`
      : params.spec.displayName;
  return {
    title,
    payload: {
      projectionKey: params.spec.projectionKey,
      customer: customer ?? null,
    },
  };
}

function applyAggregateTemplate(params: {
  spec: Pick<EnterpriseKnowledgeProjectionSpec, "displayName">;
  gatewayData: unknown;
}): ProjectionTemplateResult {
  const root = asRecord(params.gatewayData);
  const items = Array.isArray(root?.items)
    ? root.items
    : Array.isArray(params.gatewayData)
      ? params.gatewayData
      : [];
  return {
    title: `${params.spec.displayName} 汇总`,
    payload: {
      count: items.length,
      items,
    },
  };
}

function applyTrendTemplate(params: {
  spec: Pick<EnterpriseKnowledgeProjectionSpec, "displayName">;
  gatewayData: unknown;
}): ProjectionTemplateResult {
  const root = asRecord(params.gatewayData);
  return {
    title: `${params.spec.displayName} 趋势`,
    payload: {
      trend: root?.trend ?? "stable",
      points: Array.isArray(root?.points) ? root.points : [],
    },
  };
}

function applyRiskDetectionTemplate(params: {
  spec: Pick<EnterpriseKnowledgeProjectionSpec, "displayName">;
  gatewayData: unknown;
}): ProjectionTemplateResult {
  const root = asRecord(params.gatewayData);
  const customer = root ? asRecord(root.customer) : null;
  const segment = typeof customer?.segment === "string" ? customer.segment : "unknown";
  const riskScore = segment === "enterprise" ? 0.2 : segment === "smb" ? 0.55 : 0.8;
  const riskLevel = riskScore >= 0.7 ? "high" : riskScore >= 0.4 ? "medium" : "low";
  const customerName = typeof customer?.name === "string" ? customer.name : "未知客户";
  return {
    title: `${customerName} 流失风险`,
    payload: {
      customerId: customer?.id ?? null,
      segment,
      riskScore,
      riskLevel,
      signals: [`segment:${segment}`],
    },
  };
}

function applyForecastTemplate(params: {
  spec: Pick<EnterpriseKnowledgeProjectionSpec, "displayName">;
  gatewayData: unknown;
}): ProjectionTemplateResult {
  const root = asRecord(params.gatewayData);
  return {
    title: `${params.spec.displayName} 预测`,
    payload: {
      horizonDays: typeof root?.horizonDays === "number" ? root.horizonDays : 30,
      forecast: root?.forecast ?? null,
    },
  };
}

export function applyProjectionTemplate(params: {
  templateKey: ProjectionTemplateKey;
  spec: Pick<
    EnterpriseKnowledgeProjectionSpec,
    "projectionKey" | "displayName" | "objectKind" | "category"
  >;
  gatewayData: unknown;
  gatewayResponse: Pick<DataGatewaySuccessResponse, "maskedFields" | "scopeApplied">;
}): ProjectionTemplateResult {
  switch (params.templateKey) {
    case "NormalizeTemplate":
      return applyNormalizeTemplate({ spec: params.spec, gatewayData: params.gatewayData });
    case "AggregateTemplate":
      return applyAggregateTemplate({ spec: params.spec, gatewayData: params.gatewayData });
    case "TrendTemplate":
      return applyTrendTemplate({ spec: params.spec, gatewayData: params.gatewayData });
    case "RiskDetectionTemplate":
      return applyRiskDetectionTemplate({ spec: params.spec, gatewayData: params.gatewayData });
    case "ForecastTemplate":
      return applyForecastTemplate({ spec: params.spec, gatewayData: params.gatewayData });
    default:
      throw new EnterpriseDataStoreError(
        "PROJECTION_TEMPLATE_UNSUPPORTED",
        `Unsupported projection template: ${params.templateKey as string}`,
      );
  }
}
