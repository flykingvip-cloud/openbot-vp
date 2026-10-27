/**
 * Formal protocol check runner for gateway admission.
 * Does not call paid Midjourney / Suno / other generation APIs.
 * text_chat may pass when connectionOk; specialized capabilities stay
 * checker_unavailable until a real specialized runner is injected.
 */

import { capabilityLabel } from "./capability-ids.js";
import { getModelAdmission } from "./store.js";
import type {
  CapabilityEvidenceItem,
  ProtocolCheckContext,
  ProtocolCheckOutcome,
  VerificationMode,
} from "./types.js";

export type CapabilityCheckRunner = {
  check(ctx: ProtocolCheckContext): Promise<ProtocolCheckOutcome[]> | ProtocolCheckOutcome[];
};

export function createDefaultProtocolRunner(
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean | Promise<boolean>,
): CapabilityCheckRunner {
  return {
    async check(ctx: ProtocolCheckContext): Promise<ProtocolCheckOutcome[]> {
      const connectionOk =
        ctx.connectionOk ??
        (resolveConnectionOk
          ? Boolean(await resolveConnectionOk(ctx.modelRef, ctx.configFingerprint))
          : false);
      const admission = await getModelAdmission(ctx.modelRef);
      return ctx.capabilityIds.map((id) => {
        if (id === "text_chat") {
          if (connectionOk) {
            const existing = admission.capabilityEvidence.find(
              (item) => item.id === "text_chat" && item.status === "passed",
            );
            return {
              capabilityId: id,
              status: "passed" as const,
              testVersion: existing?.testVersion ?? "gateway-protocol-v1",
              sourceNote: existing
                ? "复用已通过的连接协议探测（指纹绑定）"
                : "连接协议探测通过（指纹绑定）",
              verifiedAt: existing?.verifiedAt ?? admission.connectionVerifiedAt ?? Date.now(),
              expiresAt: existing?.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
              reuseExistingEvidence: Boolean(existing),
            };
          }
          return {
            capabilityId: id,
            status: "failed" as const,
            failureReason: "连接未验证或指纹不匹配，不能证明文本对话可用",
            testVersion: "gateway-protocol-v1",
          };
        }
        if (id === "tool_use") {
          return {
            capabilityId: id,
            status: "checker_unavailable" as const,
            failureReason:
              "工具调用专项检查器尚未接入；连接成功不等于工具可用，未执行检查不记正式失败",
            testVersion: "gateway-protocol-v1",
            sourceNote: "检查器不可用",
          };
        }
        if (id === "image_generation" || id === "music_generation") {
          return {
            capabilityId: id,
            status: "checker_unavailable" as const,
            failureReason:
              "图片／音乐专项检查器尚未接入，未向生成服务提交请求；不能把未检查记为失败或产物缺失",
            testVersion: "gateway-protocol-v1",
            sourceNote: "检查器不可用",
          };
        }
        return {
          capabilityId: id,
          status: "untested" as const,
          failureReason: "该能力未纳入本次协议检查范围",
          testVersion: "gateway-protocol-v1",
          sourceNote: "未测试",
        };
      });
    },
  };
}

function normalizeQualityScore(score: unknown): number | undefined {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return undefined;
  }
  if (score < 0 || score > 1) {
    return undefined;
  }
  return score;
}

export function outcomeToEvidence(
  outcome: ProtocolCheckOutcome,
  mode: VerificationMode,
): CapabilityEvidenceItem {
  const source = mode === "specialized_eval" ? "specialized_eval" : "protocol_probe";
  let status: CapabilityEvidenceItem["status"];
  switch (outcome.status) {
    case "passed":
      status = "passed";
      break;
    case "failed":
      status = "failed";
      break;
    case "pending":
      status = "pending";
      break;
    case "checker_unavailable":
      status = "checker_unavailable";
      break;
    default:
      status = "untested";
  }
  const qualityScore = normalizeQualityScore(outcome.qualityScore);
  return {
    id: outcome.capabilityId,
    label: capabilityLabel(outcome.capabilityId),
    source,
    status,
    ...(outcome.sourceNote ? { sourceNote: outcome.sourceNote } : {}),
    ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
    ...(outcome.testVersion ? { testVersion: outcome.testVersion } : {}),
    ...(outcome.expiresAt != null ? { expiresAt: outcome.expiresAt } : {}),
    ...(outcome.verifiedAt != null
      ? { verifiedAt: outcome.verifiedAt }
      : status === "passed"
        ? { verifiedAt: Date.now() }
        : {}),
    ...(qualityScore != null ? { qualityScore } : {}),
  };
}
