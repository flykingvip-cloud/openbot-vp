/**
 * Admin routing preview. Uses the same pure decision core as live execution.
 * This call is dry-run: it does not call generation models and does not record
 * execution success. Live chat / followup / CLI / Routine / tools call
 * `filterModelCandidatesByPlatformAdmission` / `assertExecutorModelAdmitted`.
 */

import { decideRuntimeCapability, type RuntimeDecisionCandidate } from "./runtime-decision.js";
import { readStoredModelAdmissions } from "./store.js";
import type {
  RoutingDecisionPreview,
  RoutingPreviewCandidate,
  RoutingPreviewRequest,
} from "./types.js";

export async function previewRoutingDecision(params: {
  request: RoutingPreviewRequest;
  candidates: RoutingPreviewCandidate[];
  storePath?: string;
  nowMs?: number;
  configFingerprint?: string;
}): Promise<RoutingDecisionPreview> {
  const records = await readStoredModelAdmissions(params.storePath);
  const candidates: RuntimeDecisionCandidate[] = params.candidates.map((asset) => ({
    modelId: asset.modelId,
    scope: "platform",
    health: asset.health,
    costTier: asset.costTier,
    contextWindow: asset.contextWindow,
    record: records[asset.modelId] ?? null,
  }));
  const decision = decideRuntimeCapability({
    role: "executor",
    dryRun: true,
    request: {
      ...params.request,
      ...(params.nowMs != null ? { nowMs: params.nowMs } : {}),
      ...(params.configFingerprint ? { configFingerprint: params.configFingerprint } : {}),
    },
    candidates,
  });
  const suffix = "后端准入干跑预览；与运行时同一决策核心；不调用生成、不记执行成功";
  return {
    requestId: `gpreview_${Date.now().toString(36)}`,
    taskCategory: decision.taskCategory,
    taskCategorySource: decision.taskCategorySource,
    executorPath: decision.executorPath,
    selectedExecutor: decision.primary[0]
      ? `${decision.executorPath} · ${decision.primary[0]}`
      : null,
    selectedModelId: decision.primary[0] ?? null,
    primary: decision.primary,
    fallback: decision.fallback,
    excluded: decision.excluded,
    decisionReason: `${decision.decisionReason}（${suffix}）`,
    dryRun: true,
    uiDemo: false,
    backendStatus: "wired",
    requiredCapabilities: decision.requiredCapabilities,
    aorInvoked: false,
    nativeMidjourneyClaimed: false,
    officialSunoCertified: false,
    ...(params.request.budget ? { budget: params.request.budget } : {}),
    ...(params.request.outputType ? { outputType: params.request.outputType } : {}),
  };
}
