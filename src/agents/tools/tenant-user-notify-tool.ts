/**
 * Push a notice to one real colleague in the same tenant.
 * Does not open their robot chat and does not post into a collaboration group.
 */
import { Type } from "@sinclair/typebox";
import { extractEmployeeStewardUserId } from "../../diagnosis/diagnose-conversation.js";
import {
  loadPlatformAuthStoreForDiagnosis,
  resolveDiagnoseGrowthActor,
} from "../../diagnosis/diagnose-growth-locator.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import {
  listTenantHumans,
  recordTenantHumanNotice,
  resolveTenantHuman,
} from "../../organization/tenant-human-notice.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { asToolParams, jsonResult, type AnyAgentTool } from "./common.js";

const TenantUserNotifySchema = Type.Object({
  target: Type.String({
    description: "同租户真人的姓名、邮箱或 userId，例如 王军。不能填数字人名字。",
  }),
  message: Type.String({
    description: "发给这位真人的通知原文，例如会议时间。不要写给机器人。",
  }),
});

export function createTenantUserNotifyTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  tenantId?: string;
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientSessionKind?: GatewayClient["sessionKind"];
}): AnyAgentTool {
  const callerAgentId =
    options?.requesterAgentIdOverride?.trim() ||
    resolveSessionAgentId({ sessionKey: options?.agentSessionKey });
  return {
    name: "tenant_user_notify",
    label: "Tenant user notify",
    description:
      "给同一个企业租户里的真人发一条定向通知（会议、提醒）。收件人必须是真人同事，不是数字人；数字人仍用 conversation_send。通知写进对方的工作台，不会进协作组。",
    parameters: TenantUserNotifySchema,
    execute: async (_toolCallId, args) => {
      const params = asToolParams(args);
      const target = typeof params.target === "string" ? params.target.trim() : "";
      const message = typeof params.message === "string" ? params.message.trim() : "";
      if (!target || !message) {
        return jsonResult({ ok: false, reason: "invalid_target" });
      }
      const actor = resolveDiagnoseGrowthActor({
        tenantId: options?.tenantId,
        actorUserId:
          options?.gatewayClientPlatformUserId ||
          options?.gatewayClientUser ||
          extractEmployeeStewardUserId(options?.agentSessionKey),
        sessionDomain: options?.gatewayClientSessionDomain,
        sessionKind: options?.gatewayClientSessionKind,
        store: await loadPlatformAuthStoreForDiagnosis(),
      });
      if (!actor) {
        return jsonResult({
          ok: false,
          reason: "unauthorized",
          hint: "当前会话无法确认企业身份，不能给真人发通知。",
        });
      }
      const store = await loadPlatformAuthStoreForDiagnosis();
      if (!store) {
        return jsonResult({
          ok: false,
          reason: "unauthorized",
          hint: "无法加载企业身份存储。",
        });
      }
      const humans = listTenantHumans(store, actor.tenantId);
      const recipient = resolveTenantHuman(humans, target);
      if (!recipient) {
        return jsonResult({
          ok: false,
          reason: "not_in_tenant",
          hint: "这个人不在当前企业租户里，或姓名对上了不止一位。",
          humans: humans.map((human) => ({
            userId: human.userId,
            displayName: human.displayName,
          })),
        });
      }
      const notice = recordTenantHumanNotice({
        tenantId: actor.tenantId,
        recipient,
        message,
        fromAgentId: callerAgentId,
        ...(options?.agentSessionKey?.trim()
          ? { fromSessionKey: options.agentSessionKey.trim() }
          : {}),
        senderUserId: actor.actorUserId,
      });
      return jsonResult({
        ok: true,
        delivered: true,
        to: recipient.displayName,
        noticeId: notice.id,
      });
    },
  };
}
