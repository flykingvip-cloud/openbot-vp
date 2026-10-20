/**
 * 用量采集 handler（WRITE）。幂等写入 + 发布 UsageReportedEvent（R9）。
 *
 * 方法：usage-ingest.report / usage-ingest.report-credits
 */

import { recordCreditUsage } from "../billing/record-credit-usage.js";
import { reportUsageEvent } from "../billing/report-usage-event.js";
import { resolveUsageAttributionTags } from "../billing/usage-attribution-context.js";
import {
  numberValue,
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const usageIngestHandlers: GatewayRequestHandlers = {
  "usage-ingest.report": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const eventId = stringValue(params.eventId);
      const key = stringValue(params.key);
      const quantity = numberValue(params.quantity);
      const userId = stringValue(params.userId) ?? scope.user?.id ?? "unknown";
      if (!eventId) {
        respondInvalid(respond, "eventId 是必填项（幂等键）");
        return;
      }
      if (!key) {
        respondInvalid(respond, "key 是必填项");
        return;
      }
      if (quantity === null) {
        respondInvalid(respond, "quantity 是必填项");
        return;
      }
      if (quantity < 0) {
        respondInvalid(respond, "quantity 不能为负数");
        return;
      }
      const occurredAt = stringValue(params.occurredAt) ?? undefined;
      const agentId = stringValue(params.agentId) ?? undefined;
      const orgSeatId = stringValue(params.orgSeatId) ?? undefined;
      const attribution = await resolveUsageAttributionTags({
        enterpriseId: scope.enterpriseId,
        agentId,
        orgSeatId,
        userId,
      });
      // 记录 + 按用户发布事件走统一 emit 路径（与 C1 生产者共用，避免重复实现）。
      const { recorded, deduped } = await reportUsageEvent({
        enterpriseId: scope.enterpriseId,
        userId,
        eventId,
        key,
        quantity,
        ...(occurredAt !== undefined ? { occurredAt } : {}),
        agentId: attribution.agentId,
        orgSeatId: attribution.orgSeatId,
      });
      respond(true, { recorded, deduped });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "usage-ingest.report-credits": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const taskId = stringValue(params.taskId);
      const modelId = stringValue(params.modelId);
      const policyId = stringValue(params.policyId) ?? "balanced";
      if (!taskId) {
        respondInvalid(respond, "taskId 是必填项（幂等键）");
        return;
      }
      if (!modelId) {
        respondInvalid(respond, "modelId 是必填项");
        return;
      }
      const occurredAt = stringValue(params.occurredAt) ?? undefined;
      const inputTokens = numberValue(params.inputTokens);
      const outputTokens = numberValue(params.outputTokens);
      const agentId = stringValue(params.agentId) ?? undefined;
      const orgSeatId = stringValue(params.orgSeatId) ?? undefined;
      const subscriptionSnapshotId = stringValue(params.subscriptionSnapshotId) ?? undefined;
      const subscriptionId = stringValue(params.subscriptionId) ?? undefined;
      const planId = stringValue(params.planId) ?? undefined;
      const planVersionId = stringValue(params.planVersionId) ?? undefined;
      const authorizationDecisionId = stringValue(params.authorizationDecisionId) ?? undefined;
      const runId = stringValue(params.runId) ?? undefined;
      const toolCallCount = numberValue(params.toolCallCount);
      const durationMs = numberValue(params.durationMs);
      const retryCount = numberValue(params.retryCount);
      const toolClassesRaw = params.toolClasses;
      const toolClasses = Array.isArray(toolClassesRaw)
        ? toolClassesRaw
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter((entry) => entry.length > 0)
        : undefined;
      const result = await recordCreditUsage({
        enterpriseId: scope.enterpriseId,
        taskId,
        modelId,
        policyId,
        userId: scope.user?.id,
        occurredAt,
        agentId,
        orgSeatId,
        subscriptionSnapshotId,
        subscriptionId,
        planId,
        planVersionId,
        authorizationDecisionId,
        runId,
        ...(toolCallCount !== null ? { toolCallCount } : {}),
        ...(durationMs !== null ? { durationMs } : {}),
        ...(retryCount !== null ? { retryCount } : {}),
        ...(toolClasses && toolClasses.length > 0 ? { toolClasses } : {}),
        ...(inputTokens !== null || outputTokens !== null
          ? {
              tokenUsage: {
                ...(inputTokens !== null ? { inputTokens } : {}),
                ...(outputTokens !== null ? { outputTokens } : {}),
              },
            }
          : {}),
      });
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
