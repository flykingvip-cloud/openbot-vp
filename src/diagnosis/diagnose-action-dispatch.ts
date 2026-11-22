/**
 * 1:1 diagnosis execution handoff: steward → diagnosed agent session.
 * This is inter-session agent wake, not collaboration-group share,
 * not user.daibai.ask/execute, and not confirm/cron write.
 */
import crypto from "node:crypto";
import {
  assessForeignStewardCall,
  buildEmployeeBuiltinStewardSessionKey,
  extractEmployeeStewardUserIdFromSessionKey,
  type StewardDispatchRank,
} from "../agents/builtin-steward/employee-isolation.js";
import { AGENT_LANE_NESTED } from "../agents/lanes.js";
import { buildAgentToAgentMessageContext } from "../agents/tools/sessions-send-helpers.js";
import { loadConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { conversationSeatAgentIds } from "../gateway/conversation-seat-grants.js";
import { findActiveOwnershipRecord } from "../gateway/ownership-store.js";
import {
  issuePendingStewardCall,
  listStewardUserTenantIds,
} from "../gateway/steward-call-authorization.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import { extractDiagnoseSpaceGroupId } from "./diagnose-policy.js";

export type DiagnoseHandoffChannel = "diagnosed_agent_session" | "steward";

export const DIAGNOSIS_ACTION_DISPATCH_METHOD = "diagnosis.action.dispatch" as const;

export type DiagnoseActionDispatchRequest = {
  title: string;
  agentPrompt: string;
  targetAgentId: string;
  targetSessionKey: string;
  requesterUserId: string;
  tenantId: string | null;
  tenantAdmin: boolean;
  requesterSessionKey?: string;
  receiptText?: string;
  /** Conversation send: do not write a handoff receipt into the user's chat. */
  omitReceipt?: boolean;
  /** Conversation send: visible text is the message; routing rules stay in the system prompt. */
  plainConversation?: boolean;
  /** Name the recipient should use to keep talking. Not shown in the user chat. */
  fromDisplayName?: string;
  idempotencyKey?: string;
  sessionExists?: (agentId: string, sessionKey: string) => boolean;
  send?: DiagnoseActionSessionSend;
  injectReceipt?: DiagnoseActionReceiptInject;
  /** Rank of the calling 大白管家. Absent means an ordinary caller, not a cross-rank steward call. */
  stewardCaller?: {
    rank: StewardDispatchRank;
    tenantId?: string | null;
    targetTenantIds?: readonly string[];
  };
  /** Target already chose 同意 for this steward call. */
  stewardAuthorizationAgreed?: boolean;
};

export type DiagnoseActionDispatchResult = {
  ok: boolean;
  reason: string;
  channel?: DiagnoseHandoffChannel;
  targetSessionKey?: string;
  requesterSessionKey?: string;
  runId?: string;
  authorizationId?: string;
  prompt?: string;
  actions?: ["同意", "不同意"];
  roleLabel?: "平台管理员" | "企业管理员";
};

export type DiagnoseActionSessionSend = (input: {
  sessionKey: string;
  message: string;
  requesterSessionKey: string;
  sessionOwnerPlatformUserId?: string;
  plainConversation?: boolean;
  fromDisplayName?: string;
  idempotencyKey?: string;
}) => Promise<{ runId: string }>;

export type DiagnoseActionReceiptInject = (input: {
  sessionKey: string;
  text: string;
  sessionOwnerPlatformUserId?: string;
}) => Promise<void>;

export function planDiagnoseActionHandoff(input: {
  title: string;
  agentPrompt: string;
  targetAgentId: string;
  targetSessionKey: string;
  requesterUserId: string;
  tenantAdmin: boolean;
  requesterSessionKey?: string;
  sessionExists?: (agentId: string, sessionKey: string) => boolean;
  stewardCaller?: {
    rank: StewardDispatchRank;
    tenantId?: string | null;
    targetTenantIds?: readonly string[];
  };
  stewardAuthorizationAgreed?: boolean;
}):
  | {
      ok: true;
      channel: DiagnoseHandoffChannel;
      targetAgentId: string;
      targetSessionKey: string;
      requesterSessionKey: string;
      message: string;
      title: string;
    }
  | {
      ok: false;
      reason: string;
      prompt?: string;
      actions?: ["同意", "不同意"];
      roleLabel?: "平台管理员" | "企业管理员";
      targetSessionKey?: string;
    } {
  const title = input.title.trim();
  const message = input.agentPrompt.trim();
  const targetAgentId = input.targetAgentId.trim();
  const targetSessionKey = input.targetSessionKey.trim();
  const requesterUserId = input.requesterUserId.trim();
  if (!title || !message || !targetAgentId || !targetSessionKey || !requesterUserId) {
    return { ok: false, reason: "invalid_target" };
  }
  if (extractDiagnoseSpaceGroupId(targetSessionKey) || targetSessionKey.includes(":space:")) {
    return { ok: false, reason: "group_not_1to1" };
  }
  const stewardOwner = extractEmployeeStewardUserIdFromSessionKey(targetSessionKey);
  if (targetAgentId === "main" || stewardOwner || /:main:employee:/.test(targetSessionKey)) {
    if (!stewardOwner) {
      return { ok: false, reason: "self_steward" };
    }
    const assessment = assessForeignStewardCall({
      callerUserId: requesterUserId,
      targetUserId: stewardOwner,
      rank: input.stewardCaller?.rank ?? "member",
      callerTenantId: input.stewardCaller?.tenantId,
      targetTenantIds: input.stewardCaller?.targetTenantIds,
    });
    if (assessment.disposition === "own") {
      return { ok: false, reason: "self_steward" };
    }
    if (assessment.disposition !== "needs_authorization") {
      return { ok: false, reason: "forbidden" };
    }
    const requesterOverride = input.requesterSessionKey?.trim() ?? "";
    if (
      requesterOverride &&
      (extractDiagnoseSpaceGroupId(requesterOverride) || requesterOverride.includes(":space:"))
    ) {
      return { ok: false, reason: "group_not_1to1" };
    }
    if (!input.stewardAuthorizationAgreed) {
      return {
        ok: false,
        reason: "pending_authorization",
        prompt: assessment.prompt,
        actions: ["同意", "不同意"],
        roleLabel: assessment.roleLabel,
        targetSessionKey,
      };
    }
    return {
      ok: true,
      channel: "steward",
      targetAgentId,
      targetSessionKey,
      requesterSessionKey:
        requesterOverride || buildEmployeeBuiltinStewardSessionKey(requesterUserId),
      message,
      title,
    };
  }
  const expected = `agent:${targetAgentId}:main`;
  if (targetSessionKey !== expected) {
    return { ok: false, reason: "invalid_target" };
  }
  const exists = (input.sessionExists ?? defaultSessionExists)(targetAgentId, targetSessionKey);
  if (!exists) {
    return { ok: false, reason: "session_missing" };
  }
  const requesterOverride = input.requesterSessionKey?.trim() ?? "";
  if (
    requesterOverride &&
    (extractDiagnoseSpaceGroupId(requesterOverride) || requesterOverride.includes(":space:"))
  ) {
    return { ok: false, reason: "group_not_1to1" };
  }
  return {
    ok: true,
    channel: "diagnosed_agent_session",
    targetAgentId,
    targetSessionKey,
    requesterSessionKey:
      requesterOverride || buildEmployeeBuiltinStewardSessionKey(requesterUserId),
    message,
    title,
  };
}

export async function dispatchDiagnoseConversationAction(
  input: DiagnoseActionDispatchRequest,
): Promise<DiagnoseActionDispatchResult> {
  const stewardTarget = Boolean(extractEmployeeStewardUserIdFromSessionKey(input.targetSessionKey));
  const targetAllowed =
    input.plainConversation && input.tenantId
      ? (await conversationSeatAgentIds(input.tenantId, input.requesterUserId)).includes(
          input.targetAgentId,
        )
      : canDispatchDiagnoseAction(input);
  if (!stewardTarget && !targetAllowed) {
    return { ok: false, reason: "unauthorized" };
  }
  let stewardCaller = input.stewardCaller;
  if (
    stewardTarget &&
    stewardCaller?.rank === "enterprise_admin" &&
    !stewardCaller.targetTenantIds
  ) {
    const owner = extractEmployeeStewardUserIdFromSessionKey(input.targetSessionKey) ?? "";
    stewardCaller = {
      ...stewardCaller,
      targetTenantIds: await listStewardUserTenantIds(owner),
    };
  }
  const planned = planDiagnoseActionHandoff({
    title: input.title,
    agentPrompt: input.agentPrompt,
    targetAgentId: input.targetAgentId,
    targetSessionKey: input.targetSessionKey,
    requesterUserId: input.requesterUserId,
    tenantAdmin: input.tenantAdmin,
    requesterSessionKey: input.requesterSessionKey,
    sessionExists: input.sessionExists,
    stewardCaller,
    stewardAuthorizationAgreed: input.stewardAuthorizationAgreed,
  });
  if (!planned.ok) {
    if (
      planned.reason === "pending_authorization" &&
      planned.roleLabel &&
      planned.prompt &&
      stewardCaller &&
      stewardCaller.rank !== "member"
    ) {
      const owner = extractEmployeeStewardUserIdFromSessionKey(input.targetSessionKey) ?? "";
      const pending = issuePendingStewardCall({
        callerUserId: input.requesterUserId,
        targetUserId: owner,
        callerRank: stewardCaller.rank,
        roleLabel: planned.roleLabel,
        callerTenantId: stewardCaller.tenantId,
        targetTenantIds: stewardCaller.targetTenantIds,
        prompt: planned.prompt,
        message: input.agentPrompt.trim(),
        title: input.title.trim(),
        targetSessionKey: input.targetSessionKey.trim(),
        requesterSessionKey:
          input.requesterSessionKey?.trim() ||
          buildEmployeeBuiltinStewardSessionKey(input.requesterUserId),
      });
      return {
        ok: false,
        reason: "pending_authorization",
        authorizationId: pending.id,
        prompt: pending.prompt,
        actions: ["同意", "不同意"],
        roleLabel: pending.roleLabel,
        targetSessionKey: pending.targetSessionKey,
        requesterSessionKey: pending.requesterSessionKey,
      };
    }
    return planned;
  }
  const send = input.send ?? defaultDiagnoseActionSessionSend;
  const injectReceipt = input.injectReceipt ?? defaultDiagnoseActionReceiptInject;
  try {
    const sent = await send({
      sessionKey: planned.targetSessionKey,
      message: planned.message,
      requesterSessionKey: planned.requesterSessionKey,
      sessionOwnerPlatformUserId: input.requesterUserId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.plainConversation ? { plainConversation: true } : {}),
      ...(input.fromDisplayName?.trim() ? { fromDisplayName: input.fromDisplayName.trim() } : {}),
    });
    if (!input.omitReceipt) {
      try {
        await injectReceipt({
          sessionKey: planned.requesterSessionKey,
          sessionOwnerPlatformUserId: input.requesterUserId,
          text: input.receiptText?.trim()
            ? input.receiptText.trim()
            : [
                `已把「${planned.title}」交给被诊断数字人（1:1 会话，不是协作小组）。`,
                `对象会话：${planned.targetSessionKey}`,
                planned.message,
              ].join("\n"),
        });
      } catch {
        // Receipt is best-effort; the target wake already happened.
      }
    }
    return {
      ok: true,
      reason: "accepted",
      channel: planned.channel,
      targetSessionKey: planned.targetSessionKey,
      requesterSessionKey: planned.requesterSessionKey,
      runId: sent.runId,
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function canDispatchDiagnoseAction(input: {
  targetAgentId: string;
  requesterUserId: string;
  tenantId: string | null;
  tenantAdmin: boolean;
}): boolean {
  if (input.tenantAdmin && input.requesterUserId.trim()) {
    return true;
  }
  const tenantId = input.tenantId?.trim();
  const ownerId = input.requesterUserId.trim();
  const agentId = input.targetAgentId.trim();
  if (!tenantId || !ownerId || !agentId) {
    return false;
  }
  return (
    findActiveOwnershipRecord({
      tenantId,
      subjectKind: "agent",
      subjectId: agentId,
    })?.currentManagerUserId === ownerId
  );
}

export function defaultSessionExists(agentId: string, sessionKey: string): boolean {
  try {
    const cfg = loadConfig();
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    const store = loadSessionStore(storePath, { skipCache: true });
    const sessionId = store[sessionKey]?.sessionId;
    return typeof sessionId === "string" && sessionId.length > 0;
  } catch {
    return false;
  }
}

/** Hidden from the user. The other robot cannot read this session. */
export function buildPlainConversationInstruction(fromName?: string): string {
  const who = fromName?.trim();
  const sendLine = who
    ? `给对方的结果，以及还要问清的问题，必须用 conversation_send 发给「${who}」。message 只写给对方的原话。`
    : "给对方的结果，以及还要问清的问题，必须用 conversation_send 发给刚才给你发消息的那位数字人。message 只写给对方的原话。";
  const ownerLine = who
    ? `发出之后，最多给主人留一句，例如：已回复${who}。`
    : "发出之后，最多给主人留一句，例如：已回复对方。";
  return [
    "这是另一位数字人发来的话，用户看不到这段说明。",
    "对方看不到本会话。写在这里的思考，以及写给对方的正文，对方都看不到。",
    sendLine,
    "本会话不要写思考过程，也不要复述给对方的正文。",
    ownerLine,
    "不要请主人把这句话转达回去。",
    "不限轮次。不要写会话编号、角色、闭环或交接过程。",
  ].join("\n");
}

async function defaultDiagnoseActionSessionSend(input: {
  sessionKey: string;
  message: string;
  requesterSessionKey: string;
  sessionOwnerPlatformUserId?: string;
  plainConversation?: boolean;
  fromDisplayName?: string;
  idempotencyKey?: string;
}): Promise<{ runId: string }> {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const extraSystemPrompt = [
    buildAgentToAgentMessageContext({
      requesterSessionKey: input.requesterSessionKey,
      requesterChannel: INTERNAL_MESSAGE_CHANNEL,
      targetSessionKey: input.sessionKey,
    }),
    input.plainConversation ? buildPlainConversationInstruction(input.fromDisplayName) : "",
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
  const response = await callGateway<{ runId?: string }>({
    method: "agent",
    params: {
      message: input.message,
      sessionKey: input.sessionKey,
      idempotencyKey,
      deliver: false,
      channel: INTERNAL_MESSAGE_CHANNEL,
      lane: AGENT_LANE_NESTED,
      extraSystemPrompt,
      inputProvenance: {
        kind: "inter_session",
        sourceSessionKey: input.requesterSessionKey,
        sourceChannel: INTERNAL_MESSAGE_CHANNEL,
        sourceTool: DIAGNOSIS_ACTION_DISPATCH_METHOD,
        sourcePlatformUserId: input.sessionOwnerPlatformUserId,
        ...(input.fromDisplayName?.trim()
          ? { sourceSenderLabel: input.fromDisplayName.trim() }
          : {}),
      },
    },
    timeoutMs: 10_000,
  });
  const runId =
    typeof response?.runId === "string" && response.runId ? response.runId : idempotencyKey;
  // One wake per call. A reply to this sender is posted into their transcript
  // by conversation_send and does not start another run on that session.
  return { runId };
}

async function defaultDiagnoseActionReceiptInject(input: {
  sessionKey: string;
  text: string;
  sessionOwnerPlatformUserId?: string;
}): Promise<void> {
  await callGateway({
    method: "chat.inject",
    params: {
      sessionKey: input.sessionKey,
      message: input.text,
      label: "诊断交接",
      sessionOwnerPlatformUserId: input.sessionOwnerPlatformUserId,
    },
    timeoutMs: 20_000,
  });
}
