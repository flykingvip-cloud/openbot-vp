/**
 * P24.5 — single live Da Bai transport write point.
 * Delivers redacted DiagnosticSignal projections through chat.send only.
 * Does not call user.daibai.ask/execute or expose Evidence payload fields.
 */
import {
  assertDeliveryProjectionSafe,
  type DiagnosisDaibaiDeliveryProjection,
  type DiagnosisDaibaiTransport,
} from "./daibai-delivery.js";
/** Keep in sync with DIAGNOSIS_P24_5_CANARY_TENANT (Path B 2026-10-19). */
const DEFAULT_CANARY_TENANT = "001";

export type DiagnosisLiveDaibaiChatSend = (input: {
  sessionKey: string;
  tenantId: string;
  text: string;
  deliveryId: string;
  route: DiagnosisDaibaiDeliveryProjection["route"];
}) => Promise<"accepted" | "unavailable">;

export function formatDiagnosisDaibaiUserVisibleDelivery(
  projection: DiagnosisDaibaiDeliveryProjection,
): string {
  const target =
    projection.targetType && projection.targetId
      ? `${projection.targetType}:${projection.targetId}`
      : "当前对象";
  return [
    "【诊断提醒】",
    `类型：${projection.kind}`,
    `对象：${target}`,
    `结论：${projection.completion}`,
    `原因：${projection.reasonCode}`,
    `发现 ${projection.findingCount} 条 · 证据 ${projection.evidenceCount} 条`,
  ].join("\n");
}

export function createLiveDaibaiTransport(deps: {
  send: DiagnosisLiveDaibaiChatSend;
  sessionKey: string;
  canaryTenantId?: string;
}): DiagnosisDaibaiTransport & {
  deliveries: Array<{ deliveryId: string; text: string }>;
} {
  const canaryTenant = deps.canaryTenantId ?? DEFAULT_CANARY_TENANT;
  const deliveries: Array<{ deliveryId: string; text: string }> = [];
  return {
    deliveries,
    async deliver(projection) {
      assertDeliveryProjectionSafe(projection);
      if (projection.tenantId !== canaryTenant) {
        return "unavailable";
      }
      const text = formatDiagnosisDaibaiUserVisibleDelivery(projection);
      const deliveryId = `dlv:${projection.signalId}:${projection.route}`;
      const result = await deps.send({
        sessionKey: deps.sessionKey,
        tenantId: canaryTenant,
        text,
        deliveryId,
        route: projection.route,
      });
      if (result === "accepted") {
        deliveries.push({ deliveryId, text });
      }
      return result;
    },
  };
}
