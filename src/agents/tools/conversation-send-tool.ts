/**
 * Grok-style 1:1 conversation send. Steward or a tenant robot addresses
 * another existing agent:<id>:main session. Not a collaboration group.
 */
import fs from "node:fs";
import { Type } from "@sinclair/typebox";
import {
  CONVERSATION_SEND_TOOL,
  defaultConversationSessionKey,
  dispatchConversationHandoff,
  latestInboundInterSessionSource,
  listConversationPeers,
  postConversationOutboundLine,
  postConversationPeerLine,
  resolveConversationPeer,
  resolveConversationSessionExists,
} from "../../conversation-task/conversation-handoff.js";
import {
  evaluateCurrentTaskSend,
  readSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { extractEmployeeStewardUserId } from "../../diagnosis/diagnose-conversation.js";
import {
  loadPlatformAuthStoreForDiagnosis,
  resolveDiagnoseGrowthActor,
} from "../../diagnosis/diagnose-growth-locator.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { loadSessionEntry } from "../../gateway/session-utils.js";
import {
  loadSessionEntryForClient,
  toGatewayClientFromSessionHint,
} from "../../gateway/tenant-context.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { isBuiltinStewardAgent, BUILTIN_STEWARD_NAME } from "../builtin-steward/identity.js";
import { asToolParams, jsonResult, type AnyAgentTool } from "./common.js";
import { validateConversationDispatch } from "./conversation-send-dispatch.js";

function readInboundInterSessionSource(sessionFile: string | undefined): string | undefined {
  if (!sessionFile) {
    return undefined;
  }
  try {
    return latestInboundInterSessionSource(fs.readFileSync(sessionFile, "utf8"));
  } catch {
    return undefined;
  }
}

function existingSessionFile(file: string | undefined): string | undefined {
  const trimmed = file?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return fs.existsSync(trimmed) ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

async function resolveCallerSessionFile(
  sessionKey: string | undefined,
  client: GatewayClient | null,
): Promise<string | undefined> {
  const key = sessionKey?.trim();
  if (!key) {
    return undefined;
  }
  const candidates: Array<string | undefined> = [];
  if (client) {
    try {
      candidates.push((await loadSessionEntryForClient(key, client)).entry?.sessionFile);
    } catch {
      // Membership routing can fail outside a managed tenant; the global store is the fallback.
    }
  }
  try {
    candidates.push(loadSessionEntry(key).entry?.sessionFile);
  } catch {
    // No store for this key.
  }
  for (const candidate of candidates) {
    const file = existingSessionFile(candidate);
    if (file) {
      return file;
    }
  }
  return undefined;
}

const ConversationSendSchema = Type.Object({
  target: Type.String({
    description:
      "对方数字人的名字、agentId 或 @mention 词，和 agents_list 同一份企业注册表。没有主会话的注册机器人会返回 registered_no_session，不会假装不在名单里。",
  }),
  message: Type.String({
    description:
      "发给对方的原话。可以是任务、回答，或接着上一句继续讨论。不要写会话编号、角色或交接说明。派工时写清成功标准/主责/禁区，或用下方字段。",
  }),
  taskId: Type.Optional(
    Type.String({
      description: "当前任务 id。与当前任务相同则直接投送；重试必须沿用同一个 id。",
    }),
  ),
  successCriteria: Type.Optional(
    Type.String({
      description: "派工成功标准（验收条件）。派工单必填；闲聊可省略。",
    }),
  ),
  singleOwner: Type.Optional(
    Type.String({
      description: "单主责方（通常即 target）。派工单必填；默认可用 target。",
    }),
  ),
  forbiddenZones: Type.Optional(
    Type.String({
      description: "禁区与约束（不要做什么）。派工单必填；闲聊可省略。",
    }),
  ),
});

export function createConversationSendTool(options?: {
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
    name: CONVERSATION_SEND_TOOL,
    label: "Conversation send",
    description:
      "把一句话发给另一个已有主会话的数字人，并等待对方回复。对用户只说有没有发出去。delivered 为真就是已发出；reply 为空只表示还没读到回复，不要说没送到。answerInChat 为真表示对方的原话已经在本会话里，这时 reply 为空也不要说没送到，不要复述，不要请用户转达。posted 为真表示这句话已经写进对方会话，本会话不要再把这句话写一遍。to 是对方是谁。想继续讨论就再调用本工具，target 用 to 里的名字，message 写下一句。不限轮次，像两个人接着说。只有必须问用户时才问用户一句。不要把会话编号、角色、闭环或交接过程写进对话。当前任务直接投送，重试沿用同一个 taskId。",
    parameters: ConversationSendSchema,
    execute: async (_toolCallId, args) => {
      const params = asToolParams(args);
      const target = typeof params.target === "string" ? params.target.trim() : "";
      const message = typeof params.message === "string" ? params.message.trim() : "";
      if (!target || !message) {
        return jsonResult({ ok: false, reason: "invalid_target" });
      }
      const successCriteria =
        typeof params.successCriteria === "string" ? params.successCriteria.trim() : undefined;
      const singleOwner =
        typeof params.singleOwner === "string" ? params.singleOwner.trim() : undefined;
      const forbiddenZones =
        typeof params.forbiddenZones === "string" ? params.forbiddenZones.trim() : undefined;
      const requestedTaskIdEarly =
        typeof params.taskId === "string" ? params.taskId.trim() : undefined;
      const dispatchCheck = validateConversationDispatch({
        target,
        message,
        ...(requestedTaskIdEarly ? { taskId: requestedTaskIdEarly } : {}),
        ...(successCriteria ? { successCriteria } : {}),
        ...(singleOwner ? { singleOwner } : {}),
        ...(forbiddenZones ? { forbiddenZones } : {}),
      });
      if (!dispatchCheck.ok) {
        return jsonResult({
          ok: false,
          reason: "dispatch_ticket_incomplete",
          missing: dispatchCheck.missing,
          hint: "派工需写清成功标准、单主责、禁区（字段或正文标记）。",
          ...(dispatchCheck.secondUserConfirmWarning
            ? { warning: dispatchCheck.secondUserConfirmWarning }
            : {}),
        });
      }
      const withDispatchMeta = <T extends Record<string, unknown>>(
        row: T,
      ): T & Record<string, unknown> => {
        if (!dispatchCheck.secondUserConfirmWarning) {
          return row;
        }
        return { ...row, warning: dispatchCheck.secondUserConfirmWarning };
      };
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
          hint: "当前会话无法确认企业身份，不能 1:1 交接。",
        });
      }
      const sessionDomain = options?.gatewayClientSessionDomain;
      const sessionClient = toGatewayClientFromSessionHint({
        user: options?.gatewayClientUser,
        platformUserId:
          options?.gatewayClientPlatformUserId ||
          extractEmployeeStewardUserId(options?.agentSessionKey) ||
          actor.actorUserId ||
          undefined,
        sessionDomain:
          sessionDomain === "employee" || sessionDomain === "enterprise"
            ? sessionDomain
            : "employee",
      });
      const sessionExists = await resolveConversationSessionExists(sessionClient);
      const peers = await listConversationPeers({
        tenantId: actor.tenantId,
        requesterUserId: actor.actorUserId,
        tenantAdmin: actor.tenantAdmin,
        sessionExists,
        includeMissingSessions: true,
      });
      const peer = resolveConversationPeer(target.replace(/^@/, ""), peers);
      const roster = peers.map((row) => ({
        agentId: row.agentId,
        displayName: row.displayName,
        sessionKey: row.sessionKey,
        sessionExists: row.sessionExists,
      }));
      if (!peer) {
        return jsonResult({
          ok: false,
          reason: "not_registered",
          hint: "不在企业注册表里。agents_list 和这里是同一份名单。",
          reachable: roster,
        });
      }
      if (!peer.sessionExists) {
        return jsonResult({
          ok: false,
          reason: "registered_no_session",
          hint: "已在注册表，但还没有主会话，所以发不出去。",
          to: peer.displayName,
          reachable: roster,
        });
      }
      const fromDisplayName = isBuiltinStewardAgent(callerAgentId)
        ? BUILTIN_STEWARD_NAME
        : (peers.find((row) => row.agentId === callerAgentId)?.displayName ?? callerAgentId);
      const sessionFile = await resolveCallerSessionFile(options?.agentSessionKey, sessionClient);
      const requestedTaskId = requestedTaskIdEarly;
      const currentTaskId = readSessionTaskBoard(sessionFile).current?.taskId;
      const taskSend = evaluateCurrentTaskSend({
        currentTaskId,
        taskId: requestedTaskId,
      });
      const inboundSource = readInboundInterSessionSource(sessionFile);
      if (inboundSource && inboundSource === peer.sessionKey) {
        const senderSessionKey =
          options?.agentSessionKey?.trim() || defaultConversationSessionKey(callerAgentId);
        try {
          await postConversationPeerLine({
            sessionKey: peer.sessionKey,
            message,
            senderLabel: fromDisplayName,
            sourceSessionKey: senderSessionKey,
            sessionOwnerPlatformUserId: actor.actorUserId,
          });
        } catch {
          return jsonResult({
            ok: false,
            delivered: false,
            to: peer.displayName,
            reason: "return_not_posted",
          });
        }
        if (senderSessionKey && senderSessionKey !== peer.sessionKey) {
          await postConversationOutboundLine({
            sessionKey: senderSessionKey,
            message,
            targets: [
              {
                agentId: peer.agentId,
                label: peer.displayName,
                sessionKey: peer.sessionKey,
              },
            ],
            sessionOwnerPlatformUserId: actor.actorUserId,
          }).catch(() => undefined);
        }
        return jsonResult(
          withDispatchMeta({
            ok: true,
            delivered: true,
            to: peer.displayName,
            posted: true,
            ...(taskSend.taskId ? { taskId: taskSend.taskId } : {}),
          }),
        );
      }
      const senderSessionKey =
        options?.agentSessionKey?.trim() || defaultConversationSessionKey(callerAgentId);
      const result = await dispatchConversationHandoff({
        title: `对话：${peer.displayName}`,
        message,
        targetAgentId: peer.agentId,
        requesterUserId: actor.actorUserId,
        tenantId: actor.tenantId,
        tenantAdmin: actor.tenantAdmin,
        callerAgentId,
        fromDisplayName,
        waitForReply: true,
        injectReply: false,
        sessionExists,
      });
      if (result.ok && senderSessionKey && senderSessionKey !== peer.sessionKey) {
        await postConversationOutboundLine({
          sessionKey: senderSessionKey,
          message,
          targets: [
            {
              agentId: peer.agentId,
              label: peer.displayName,
              sessionKey: peer.sessionKey,
            },
          ],
          sessionOwnerPlatformUserId: actor.actorUserId,
        }).catch(() => undefined);
      }
      const reply = typeof result.reply === "string" ? result.reply.trim() : "";
      if (result.answerInChat) {
        return jsonResult(
          withDispatchMeta({
            ok: result.ok,
            delivered: result.ok,
            to: peer.displayName,
            answerInChat: true,
            ...(taskSend.taskId ? { taskId: taskSend.taskId } : {}),
          }),
        );
      }
      return jsonResult(
        withDispatchMeta({
          ok: result.ok,
          delivered: result.ok,
          to: peer.displayName,
          ...(reply ? { reply } : {}),
          ...(taskSend.taskId ? { taskId: taskSend.taskId } : {}),
          ...(result.ok ? {} : { reason: result.reason }),
        }),
      );
    },
  };
}
