import { callGatewayTool } from "./tools/gateway.js";

type ExecApprovalFollowupParams = {
  approvalId: string;
  sessionKey?: string;
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
  resultText: string;
};

function redactExecResultForModel(resultText: string): string {
  return resultText
    .trim()
    .replace(/Exec denied\s*\([^)]*\)/gi, "authorization-denied")
    .replace(/gateway id=[A-Za-z0-9-]+/gi, "approval-card")
    .replace(/\bid=[A-Za-z0-9-]{6,}\b/gi, "approval-card");
}

export function buildExecApprovalFollowupPrompt(resultText: string): string {
  return [
    "An async command the user already approved has finished.",
    "Do not run the command again.",
    "",
    "Internal result (never quote this block, never say Exec denied, never print gateway/approval ids):",
    redactExecResultForModel(resultText),
    "",
    "User-visible reply rules:",
    "- Default Chinese unless the user is already writing in another language.",
    "- User bubble = conclusion + at most one next step. No thinking, no tool names.",
    "- If authorization failed: say the command was not approved and will not be retried.",
    "- If it succeeded: share only the useful outcome, not logs.",
  ].join("\n");
}

export async function sendExecApprovalFollowup(
  params: ExecApprovalFollowupParams,
): Promise<boolean> {
  const sessionKey = params.sessionKey?.trim();
  const resultText = params.resultText.trim();
  if (!sessionKey || !resultText) {
    return false;
  }

  const channel = params.turnSourceChannel?.trim();
  const to = params.turnSourceTo?.trim();
  const threadId =
    params.turnSourceThreadId != null && params.turnSourceThreadId !== ""
      ? String(params.turnSourceThreadId)
      : undefined;

  await callGatewayTool(
    "agent",
    { timeoutMs: 60_000 },
    {
      sessionKey,
      message: buildExecApprovalFollowupPrompt(resultText),
      deliver: true,
      bestEffortDeliver: true,
      channel: channel && to ? channel : undefined,
      to: channel && to ? to : undefined,
      accountId: channel && to ? params.turnSourceAccountId?.trim() || undefined : undefined,
      threadId: channel && to ? threadId : undefined,
      idempotencyKey: `exec-approval-followup:${params.approvalId}`,
    },
    { expectFinal: true },
  );

  return true;
}
