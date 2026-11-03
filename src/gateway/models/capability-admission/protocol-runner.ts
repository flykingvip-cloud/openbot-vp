/**
 * Formal protocol check runner for gateway admission.
 * Does not call paid Midjourney / Suno / other generation APIs.
 * text_chat may pass only from server-trusted connection resolution or
 * already-bound formal evidence; client-supplied connectionOk is ignored.
 * Specialized capabilities stay checker_unavailable until a real specialized
 * runner is injected.
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

/**
 * Resolve whether text_chat may be marked formally passed.
 * Never trusts ctx.connectionOk from RPC clients.
 */
async function resolveTrustedConnectionOk(
  ctx: ProtocolCheckContext,
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean | Promise<boolean>,
): Promise<boolean> {
  if (resolveConnectionOk) {
    return Boolean(await resolveConnectionOk(ctx.modelRef, ctx.configFingerprint));
  }
  return false;
}

export function createDefaultProtocolRunner(
  resolveConnectionOk?: (modelRef: string, fingerprint?: string) => boolean | Promise<boolean>,
  storePath?: string,
): CapabilityCheckRunner {
  return {
    async check(ctx: ProtocolCheckContext): Promise<ProtocolCheckOutcome[]> {
      // Client-forged connectionOk must not mint formal passed.
      const connectionOk = await resolveTrustedConnectionOk(ctx, resolveConnectionOk);
      const admission = await getModelAdmission(ctx.modelRef, storePath);
      return ctx.capabilityIds.map((id) => {
        if (id === "text_chat") {
          const existing = admission.capabilityEvidence.find(
            (item) => item.id === "text_chat" && item.status === "passed",
          );
          const fingerprintBound =
            Boolean(ctx.configFingerprint) &&
            Boolean(admission.connectionFingerprint) &&
            ctx.configFingerprint === admission.connectionFingerprint;
          if (connectionOk) {
            return {
              capabilityId: id,
              status: "passed" as const,
              testVersion: existing?.testVersion ?? "gateway-protocol-v1",
              sourceNote: existing
                ? "复用已通过的连接协议探测（服务端可信）"
                : "连接协议探测通过（服务端可信）",
              verifiedAt: existing?.verifiedAt ?? admission.connectionVerifiedAt ?? Date.now(),
              expiresAt: existing?.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
              reuseExistingEvidence: Boolean(existing),
            };
          }
          // Reuse prior formal evidence only when fingerprint still matches.
          if (existing && fingerprintBound) {
            return {
              capabilityId: id,
              status: "passed" as const,
              testVersion: existing.testVersion ?? "gateway-protocol-v1",
              sourceNote: "复用已绑定指纹的正式证据（非客户端声明）",
              verifiedAt: existing.verifiedAt ?? admission.connectionVerifiedAt,
              expiresAt: existing.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
              reuseExistingEvidence: true,
            };
          }
          return {
            capabilityId: id,
            status: "failed" as const,
            failureReason: "连接未经验证（拒绝客户端 connectionOk 声明），不能证明文本对话可用",
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
        if (id === "coding") {
          return {
            capabilityId: id,
            status: "checker_unavailable" as const,
            failureReason:
              "代码能力专项评测尚未接入；连接探测通过不等于代码能力已验证，未执行检查不记正式失败",
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
