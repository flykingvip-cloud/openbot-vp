/**
 * Chat send wiring — cron reply context resolution extracted from app.ts shell.
 */

import type { handleSendChat as handleSendChatInternal } from "../app-chat.ts";

export type CronReplyContext = {
  jobId: string;
  runId?: string;
  jobName?: string;
};

export type ChatSendCronHost = {
  chatCronReplyContext: CronReplyContext | null;
  chatMessages: unknown[];
};

export type AppChatSendOptions = Parameters<typeof handleSendChatInternal>[2] & {
  cronReplyContext?: CronReplyContext;
  growthGateProceed?: boolean;
  focusSwitchProceed?: boolean;
  focusSwitchCancel?: boolean;
  suppressOptimisticUserMessage?: boolean;
};

/**
 * Cron follow-up is explicit-only (EA-B1 / EA-B4).
 * A leftover “定时任务结果” card in the transcript must not stamp the next
 * composer send as `kind: cron`.
 */
export function resolveChatSendCronContext(
  host: ChatSendCronHost,
  opts?: AppChatSendOptions,
): CronReplyContext | undefined {
  return opts?.cronReplyContext ?? host.chatCronReplyContext ?? undefined;
}

export async function runAppChatSend(
  host: ChatSendCronHost,
  send: typeof handleSendChatInternal,
  chatHost: Parameters<typeof handleSendChatInternal>[0],
  messageOverride?: string,
  opts?: AppChatSendOptions,
): Promise<void> {
  const cronReplyContext = resolveChatSendCronContext(host, opts);
  await send(chatHost, messageOverride, {
    ...opts,
    ...(cronReplyContext ? { cronReplyContext } : {}),
  });
  if (host.chatCronReplyContext) {
    host.chatCronReplyContext = null;
  }
}
