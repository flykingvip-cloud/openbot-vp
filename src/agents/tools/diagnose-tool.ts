/**
 * Path B: Da Bai (admin or user steward) asks diagnose in conversation
 * and receives the redacted report in the same tool result.
 * Same READ_ONLY engine as enterprise diagnose(). Does not flip the
 * production Da Bai delivery gate or call ask/execute.
 */
import { Type } from "@sinclair/typebox";
import {
  authorizeConversationDiagnoseRequest,
  classifyDiagnoseConversationCaller,
  extractEmployeeStewardUserId,
  listOwnedDiagnoseAgentIds,
  listOwnedDiagnoseGroupIds,
} from "../../diagnosis/diagnose-conversation.js";
import { createDiagnoseGroupExpandDeps } from "../../diagnosis/diagnose-group-expand-deps.js";
import {
  loadGovernedDiagnoseGrowthReads,
  loadPlatformAuthStoreForDiagnosis,
  resolveDiagnoseGrowthActor,
} from "../../diagnosis/diagnose-growth-locator.js";
import {
  executeParsedDiagnoseRequest,
  loadStructuralPreviewConfig,
} from "../../diagnosis/diagnose-live-request.js";
import { DIAGNOSIS_PROFESSIONAL_REPORT_ARTIFACT } from "../../diagnosis/diagnose-professional-protocol.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { asToolParams, jsonResult, type AnyAgentTool } from "./common.js";

const DiagnoseToolSchema = Type.Object({
  agentId: Type.Optional(
    Type.String({
      description:
        "Digital human to diagnose. Omit to diagnose this Da Bai session; pass another bot id to diagnose that bot.",
    }),
  ),
  groupId: Type.Optional(
    Type.String({
      description:
        "Collaboration group to diagnose. Uses that group's space session, not this chat.",
    }),
  ),
  sessionKey: Type.Optional(Type.String({ description: "Session locator, not a chat corpus." })),
  scope: Type.Optional(
    Type.String({ description: "target (default) or all. all is admin-steward only." }),
  ),
  window: Type.Optional(Type.String({ description: "24h (default) or 7d." })),
  mode: Type.Optional(Type.String({ description: "TARGETED (default) or FULL." })),
});

export function createDiagnoseTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  senderIsOwner?: boolean;
  tenantId?: string;
  gatewayClientUser?: string;
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientSessionKind?: GatewayClient["sessionKind"];
  allowedAgentIds?: string[];
}): AnyAgentTool {
  const callerAgentId =
    options?.requesterAgentIdOverride?.trim() ||
    resolveSessionAgentId({ sessionKey: options?.agentSessionKey });
  return {
    name: "diagnose",
    label: "Diagnose",
    description:
      "只读诊断。工具结果里的 userVisibleArtifact（type=diagnosis_professional_report）是唯一用户可见报告，由回复管线直接渲染。第八段是对话内可执行建议，须原样保留。通道为数字人会话时，由系统 1:1 交接给被诊断数字人，不是协作小组共享，不要改写成群广播。不要调用 confirm，不要写定时。diagnosis.diagnose 不写调度。确认写入尚未开放。",
    parameters: DiagnoseToolSchema,
    execute: async (_toolCallId, args) => {
      const params = asToolParams(args);
      const caller = {
        sessionKey: options?.agentSessionKey,
        agentId: callerAgentId,
        senderIsOwner: options?.senderIsOwner,
        sessionDomain: options?.gatewayClientSessionDomain,
      };
      const kind = classifyDiagnoseConversationCaller(caller);
      const allowedAgentIds =
        options?.allowedAgentIds ??
        (kind === "user_steward"
          ? listOwnedDiagnoseAgentIds({
              userId: options?.gatewayClientUser,
              tenantId: options?.tenantId,
            })
          : undefined);
      const allowedGroupIds =
        kind === "user_steward"
          ? listOwnedDiagnoseGroupIds({
              userId: options?.gatewayClientUser,
              tenantId: options?.tenantId,
            })
          : undefined;
      const authorized = authorizeConversationDiagnoseRequest({
        caller: {
          ...caller,
          allowedAgentIds,
          allowedGroupIds,
        },
        params: {
          ...params,
          agentId:
            typeof params.agentId === "string" && params.agentId.trim()
              ? params.agentId
              : undefined,
          groupId:
            typeof params.groupId === "string" && params.groupId.trim()
              ? params.groupId
              : undefined,
          sessionKey:
            typeof params.sessionKey === "string" && params.sessionKey.trim()
              ? params.sessionKey
              : undefined,
        },
      });
      if (!authorized.ok) {
        return jsonResult({
          ok: false,
          reason: authorized.reason,
          report: `【诊断报告】\n结论：未执行\n说明：${authorized.reason}`,
        });
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
      const growthReads = await loadGovernedDiagnoseGrowthReads({
        tenantId: actor?.tenantId ?? options?.tenantId ?? null,
        actorUserId:
          actor?.actorUserId ??
          options?.gatewayClientPlatformUserId ??
          extractEmployeeStewardUserId(options?.agentSessionKey),
        locators: authorized.request.locators,
        tenantAdmin: actor?.tenantAdmin === true,
      });
      const expandDeps = await createDiagnoseGroupExpandDeps();
      const payload = await executeParsedDiagnoseRequest({
        request: authorized.request,
        trusted: { tenantId: options?.tenantId ?? null },
        requestedBy: {
          schemaVersion: 1,
          principalId: options?.gatewayClientUser?.trim() || callerAgentId || "conversation",
          kind: "user",
          tenantId: options?.tenantId ?? null,
        },
        allowConversationDelivery: false,
        growthReads,
        structuralPreview: loadStructuralPreviewConfig(),
        registry: expandDeps.registry,
        loadGroupMembers: expandDeps.loadGroupMembers,
        sessionKeyExists: expandDeps.sessionKeyExists,
      });
      const report = payload.reportText ?? "";
      return {
        content: [{ type: "text", text: report }],
        details: {
          ok: true,
          report,
          userVisibleArtifact: {
            type: DIAGNOSIS_PROFESSIONAL_REPORT_ARTIFACT,
            text: report,
            nextActions: payload.professionalReport?.nextActions ?? [],
          },
          nextActions: payload.professionalReport?.nextActions ?? [],
          professionalReportId: payload.professionalReport?.professionalReportId ?? null,
          reportId: payload.reportId,
          completion: payload.completion,
          scanned: payload.scanned,
          skipped: payload.skipped,
          prescriptions: payload.prescriptions ?? [],
        },
      };
    },
  };
}
