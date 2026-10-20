export type KnowledgePublishIntentTarget = {
  provider: string;
  suggestedAction: string;
  channelLabel?: string;
};

export type KnowledgePublishIntentExecutionPayload = {
  title?: string;
  body?: string;
  owner?: string;
  repo?: string;
  to?: string;
  subject?: string;
  message?: string;
};

export type KnowledgePublishIntentPayload = {
  intentId: string;
  objectId: string;
  objectTitle: string;
  objectSummary?: string;
  target: KnowledgePublishIntentTarget;
  executionPayload: KnowledgePublishIntentExecutionPayload;
  draftMessage: string;
  createdAt: string;
  tenantId?: string;
  seatId?: string;
  sessionKey?: string | null;
};

const PUBLISH_INTENT_MARKER = "[openbot-publish-intent]";

function buildExecutionPayload(params: {
  provider: string;
  suggestedAction: string;
  objectTitle: string;
  objectSummary?: string;
}): KnowledgePublishIntentExecutionPayload {
  const title = params.objectTitle.trim();
  const body = params.objectSummary?.trim() || title;
  if (params.provider === "personal-email") {
    return {
      subject: title,
      message: body,
    };
  }
  return {
    title,
    body,
  };
}

export function buildKnowledgePublishIntent(params: {
  objectId: string;
  objectTitle: string;
  objectSummary?: string;
  provider: string;
  suggestedAction: string;
  channelLabel?: string;
  tenantId?: string;
  seatId?: string;
  sessionKey?: string | null;
  nowIso?: string;
}): KnowledgePublishIntentPayload {
  const nowIso = params.nowIso ?? new Date().toISOString();
  const channel = params.channelLabel?.trim() || params.provider;
  const executionPayload = buildExecutionPayload({
    provider: params.provider,
    suggestedAction: params.suggestedAction,
    objectTitle: params.objectTitle,
    objectSummary: params.objectSummary,
  });
  const intentId = `publish-intent-${params.objectId}-${Date.now()}`;
  return {
    intentId,
    objectId: params.objectId,
    objectTitle: params.objectTitle.trim(),
    objectSummary: params.objectSummary?.trim() || undefined,
    target: {
      provider: params.provider,
      suggestedAction: params.suggestedAction,
      channelLabel: channel,
    },
    executionPayload,
    draftMessage: [
      PUBLISH_INTENT_MARKER,
      `intentId=${intentId}`,
      `provider=${params.provider}`,
      `operationalAction=${params.suggestedAction}`,
      "",
      "请帮我将以下知识对象发布到外部平台（知识宇宙只创建发布意图，实际执行由 assistant 通过 user_operational_identity 工具完成）：",
      `标题：${params.objectTitle.trim()}`,
      params.objectSummary?.trim() ? `摘要：${params.objectSummary.trim()}` : "",
      `目标平台：${channel}`,
      `建议动作：${params.suggestedAction}`,
      "",
      "执行步骤：",
      "1. 调用 user_operational_identity action=resolve 确认授权",
      "2. 若 allowed=true，调用 user_operational_identity action=execute 完成发布",
      "3. 若被拒绝，引导用户在个人设置完成 OAuth 绑定后再重试",
      "禁止调用 knowledge.publish.execute 或任何 knowledge 执行类 RPC。",
    ]
      .filter(Boolean)
      .join("\n"),
    createdAt: nowIso,
    tenantId: params.tenantId?.trim() || undefined,
    seatId: params.seatId?.trim() || undefined,
    sessionKey: params.sessionKey ?? null,
  };
}

export function formatKnowledgePublishIntentHandoffMessage(
  intent: KnowledgePublishIntentPayload,
): string {
  return intent.draftMessage;
}

export function formatKnowledgePublishIntentExecutionSystemPrompt(
  intent: KnowledgePublishIntentPayload,
): string {
  const payloadJson = JSON.stringify(intent.executionPayload);
  return [
    "Knowledge publish intent handoff (agent execution required):",
    `intentId=${intent.intentId}`,
    `provider=${intent.target.provider}`,
    `operationalAction=${intent.target.suggestedAction}`,
    `objectTitle=${intent.objectTitle}`,
    intent.objectSummary ? `objectSummary=${intent.objectSummary}` : "",
    `executionPayload=${payloadJson}`,
    "Use user_operational_identity: resolve first, then execute with executionPayload fields.",
    "Never expose access tokens. Do not call knowledge.publish.execute.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseKnowledgePublishIntentFromMessage(
  message: string,
): KnowledgePublishIntentPayload | null {
  if (!message.includes(PUBLISH_INTENT_MARKER)) {
    return null;
  }
  const intentId = message.match(/^intentId=(.+)$/m)?.[1]?.trim();
  const provider = message.match(/^provider=(.+)$/m)?.[1]?.trim();
  const operationalAction = message.match(/^operationalAction=(.+)$/m)?.[1]?.trim();
  const titleMatch = message.match(/^标题：(.+)$/m)?.[1]?.trim();
  const summaryMatch = message.match(/^摘要：(.+)$/m)?.[1]?.trim();
  if (!intentId || !provider || !operationalAction || !titleMatch) {
    return null;
  }
  const objectId = intentId.replace(/^publish-intent-/, "").replace(/-\d+$/, "") || "unknown";
  return buildKnowledgePublishIntent({
    objectId,
    objectTitle: titleMatch,
    objectSummary: summaryMatch,
    provider,
    suggestedAction: operationalAction,
    nowIso: new Date().toISOString(),
  });
}

export function buildKnowledgePublishIntentExecutionPayloadFromIntent(
  intent: KnowledgePublishIntentPayload,
): Record<string, unknown> {
  return { ...intent.executionPayload };
}
