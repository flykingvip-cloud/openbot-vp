/**
 * Routing decision preview service (batch 3).
 * Backend decision RPC is not wired — default path is UI demo dry-run only.
 */

import {
  previewRoutingDecision,
  type RoutingDecisionPreview,
  type RoutingPreviewRequest,
} from "../routing-decision-preview.ts";
import type { ModelAsset } from "../view-model.ts";

export type RoutingDecisionBackendStatus = "not_wired" | "ui_demo";

export type RoutingDecisionServiceResult = RoutingDecisionPreview & {
  backendStatus: RoutingDecisionBackendStatus;
  banner: string;
};

const DEMO_BANNER = "界面演示，非后端决策 · 尚未接入后端决策接口 · 干跑不调用生成模型";

export function getRoutingDecisionBackendStatus(): RoutingDecisionBackendStatus {
  return "not_wired";
}

export function previewRoutingDecisionViaService(params: {
  request: RoutingPreviewRequest;
  candidates: ModelAsset[];
}): RoutingDecisionServiceResult {
  const preview = previewRoutingDecision(params);
  const backendStatus = getRoutingDecisionBackendStatus();
  return {
    ...preview,
    dryRun: true,
    uiDemo: true,
    backendStatus,
    banner: DEMO_BANNER,
    decisionReason: preview.decisionReason.includes("界面演示")
      ? preview.decisionReason
      : `${preview.decisionReason}（界面演示，非后端决策）`,
  };
}
