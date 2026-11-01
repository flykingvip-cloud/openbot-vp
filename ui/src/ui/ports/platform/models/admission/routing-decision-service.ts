/**
 * Routing decision preview service.
 * When gateway admission RPC is bound, previews use the same decision core as live execution.
 * Otherwise falls back to a UI dry-run demo, labeled as a demo.
 * Preview never calls generation models and never records execution success.
 */

import {
  previewRoutingDecision,
  type RoutingDecisionPreview,
  type RoutingPreviewRequest,
} from "../routing-decision-preview.ts";
import type { ModelAsset } from "../view-model.ts";
import { MODELS_ADMISSION_METHODS } from "./rpc-adapter.ts";
import {
  getCapabilityAdmissionGatewayRequest,
  isCapabilityAdmissionRpcActive,
} from "./verification-service.ts";

export type RoutingDecisionBackendStatus = "not_wired" | "ui_demo" | "wired";

export type RoutingDecisionServiceResult = Omit<
  RoutingDecisionPreview,
  "uiDemo" | "dryRun" | "backendStatus"
> & {
  dryRun: true;
  uiDemo: boolean;
  backendStatus: RoutingDecisionBackendStatus;
  banner: string;
};

const DEMO_BANNER =
  "界面演示，非后端决策 · 尚未接入后端决策接口 · 干跑不调用生成模型 · 不是运行时准入结果";
const WIRED_BANNER = "后端准入干跑预览 · 与运行时同一决策核心 · 不调用生成模型 · 不记执行成功";

export function getRoutingDecisionBackendStatus(): RoutingDecisionBackendStatus {
  return isCapabilityAdmissionRpcActive() ? "wired" : "not_wired";
}

export async function previewRoutingDecisionViaService(params: {
  request: RoutingPreviewRequest;
  candidates: ModelAsset[];
}): Promise<RoutingDecisionServiceResult> {
  if (isCapabilityAdmissionRpcActive()) {
    const requestFn = getCapabilityAdmissionGatewayRequest();
    if (requestFn) {
      try {
        const result = await requestFn<{
          preview: RoutingDecisionPreview & { backendStatus?: string };
        }>(MODELS_ADMISSION_METHODS.previewRoutingDecision, {
          request: params.request,
          candidates: params.candidates.map((asset) => ({
            modelId: asset.modelId,
            ...(asset.health ? { health: asset.health } : {}),
            ...(asset.costTier ? { costTier: asset.costTier } : {}),
            contextWindow: asset.contextWindow ?? null,
          })),
        });
        const preview = result.preview;
        return {
          ...preview,
          dryRun: true,
          uiDemo: false,
          backendStatus: "wired",
          banner: WIRED_BANNER,
          decisionReason: preview.decisionReason.includes("后端")
            ? preview.decisionReason
            : `${preview.decisionReason}（后端准入干跑预览；与运行时同一决策核心；不调用生成、不记执行成功）`,
        };
      } catch (err) {
        const preview = previewRoutingDecision(params);
        const message = err instanceof Error ? err.message : String(err);
        return {
          ...preview,
          dryRun: true,
          uiDemo: true,
          backendStatus: "not_wired",
          banner: `${DEMO_BANNER}（后端预览失败：${message}）`,
          decisionReason: `${preview.decisionReason}（后端预览失败，回退界面演示）`,
        };
      }
    }
  }

  const preview = previewRoutingDecision(params);
  const backendStatus = getRoutingDecisionBackendStatus();
  return {
    ...preview,
    dryRun: true,
    uiDemo: true,
    backendStatus: backendStatus === "wired" ? "ui_demo" : backendStatus,
    banner: DEMO_BANNER,
    decisionReason: preview.decisionReason.includes("界面演示")
      ? preview.decisionReason
      : `${preview.decisionReason}（界面演示，非后端决策）`,
  };
}
