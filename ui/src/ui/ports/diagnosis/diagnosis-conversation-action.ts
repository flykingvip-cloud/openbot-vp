/**
 * Conversation shortcuts from a diagnosis report.
 * Steward/owner items use steward chat.send.
 * diagnosed_agent items use diagnosis.action.dispatch (1:1 session, not group).
 * Never user.daibai.ask, execute, confirm, or cron write.
 */

export const DIAGNOSIS_CONVERSATION_ACTION_EVENT = "diagnosis-conversation-action";

export type DiagnosisConversationActionSource = "panel" | "chat";

export type DiagnoseHandoffChannel = "diagnosed_agent_session" | "steward";

export type DiagnoseReportActionChip = {
  title: string;
  prompt: string;
  handoffChannel: DiagnoseHandoffChannel;
  targetSessionKey?: string;
  targetAgentId?: string;
};

export type DiagnosisConversationActionDetail = DiagnoseReportActionChip & {
  source?: DiagnosisConversationActionSource;
};

export function parseDiagnoseReportActions(text: string): DiagnoseReportActionChip[] {
  const actions: DiagnoseReportActionChip[] = [];
  const blocks = text.split(/\n(?=\[[^\]]+\])/);
  for (const block of blocks) {
    const title = block.match(/^\[([^\]]+)\]/m)?.[1]?.trim();
    const prompt = block.match(/^任务：(.+)/m)?.[1]?.trim();
    if (!title || !prompt) {
      continue;
    }
    const channelLine = block.match(/^通道：(.+)/m)?.[1]?.trim();
    const sessionKey = block.match(/^会话：(agent:[^\s]+)/m)?.[1]?.trim();
    const handoffChannel: DiagnoseHandoffChannel =
      channelLine === "数字人会话" && sessionKey ? "diagnosed_agent_session" : "steward";
    const targetAgentId = sessionKey?.match(/^agent:([^:]+):main$/)?.[1];
    actions.push({
      title,
      prompt,
      handoffChannel,
      ...(sessionKey ? { targetSessionKey: sessionKey } : {}),
      ...(targetAgentId ? { targetAgentId } : {}),
    });
  }
  return actions;
}

/** Chat bubbles only expose chips when the next-action section is present. */
export function parseDiagnoseConversationActions(text: string): DiagnoseReportActionChip[] {
  if (!text.includes("八、可执行建议") && !text.includes("九、可执行建议")) {
    return [];
  }
  return parseDiagnoseReportActions(text);
}

export function dispatchDiagnosisConversationAction(
  host: EventTarget,
  action: DiagnoseReportActionChip,
  source: DiagnosisConversationActionSource = "panel",
): void {
  const prompt = action.prompt.trim();
  if (!prompt) {
    return;
  }
  host.dispatchEvent(
    new CustomEvent<DiagnosisConversationActionDetail>(DIAGNOSIS_CONVERSATION_ACTION_EVENT, {
      detail: { ...action, prompt, source },
      bubbles: true,
      composed: true,
    }),
  );
}

export function readDiagnosisConversationAction(
  event: Event,
): DiagnosisConversationActionDetail | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }
  const detail = event.detail as DiagnosisConversationActionDetail | undefined;
  const prompt = typeof detail?.prompt === "string" ? detail.prompt.trim() : "";
  if (!prompt) {
    return null;
  }
  return {
    title: typeof detail?.title === "string" ? detail.title : "",
    prompt,
    handoffChannel:
      detail?.handoffChannel === "diagnosed_agent_session" ? "diagnosed_agent_session" : "steward",
    source: detail?.source === "chat" ? "chat" : "panel",
    ...(typeof detail?.targetSessionKey === "string"
      ? { targetSessionKey: detail.targetSessionKey }
      : {}),
    ...(typeof detail?.targetAgentId === "string" ? { targetAgentId: detail.targetAgentId } : {}),
  };
}
