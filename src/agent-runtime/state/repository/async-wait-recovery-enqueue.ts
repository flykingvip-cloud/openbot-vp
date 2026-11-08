/**
 * Production enqueue adapter: arm task-board continue onto the existing
 * followup queue with a real taskBoardContinueTicket. Does not mark delivery.
 */
import fs from "node:fs";
import { resolveAgentDir } from "../../../agents/agent-scope.js";
import { enqueueFollowupRun } from "../../../auto-reply/reply/queue.js";
import type { FollowupRun } from "../../../auto-reply/reply/queue/types.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { resolveDefaultSessionStorePath } from "../../../config/sessions/paths.js";
import { loadSessionStore } from "../../../config/sessions/store.js";
import { captureTaskCompletionBinding } from "../../../conversation-task/session-task-board.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import type { AsyncWaitRecoveryContinueEnqueue } from "./async-wait-job-recovery.js";

function tryLoadSessionEntry(
  sessionKey: string,
): { sessionId: string; sessionFile?: string } | undefined {
  try {
    const agentId = resolveAgentIdFromSessionKey(sessionKey);
    const storePath = resolveDefaultSessionStorePath(agentId);
    if (!fs.existsSync(storePath)) {
      return undefined;
    }
    const store = loadSessionStore(storePath);
    const entry = store[sessionKey] ?? store[sessionKey.toLowerCase()];
    if (!entry?.sessionId) {
      return undefined;
    }
    return { sessionId: entry.sessionId, sessionFile: entry.sessionFile };
  } catch {
    return undefined;
  }
}

export function createAsyncWaitRecoveryContinueEnqueue(
  cfg: OpenBotConfig,
): AsyncWaitRecoveryContinueEnqueue {
  return (params) => {
    const agentId = resolveAgentIdFromSessionKey(params.sessionKey);
    const agentDir = resolveAgentDir(cfg, agentId);
    const sessionMeta = tryLoadSessionEntry(params.sessionKey);
    const sessionId = sessionMeta?.sessionId ?? `async-wait-recovery:${params.jobId}`;
    let binding;
    try {
      binding = captureTaskCompletionBinding(params.sessionFile);
    } catch {
      binding = undefined;
    }
    const run: FollowupRun = {
      prompt: params.prompt,
      messageId: params.messageId,
      summaryLine: "async_wait_recovery_continue",
      enqueuedAt: Date.now(),
      taskBoardContinueTicket: {
        taskId: params.taskId,
        focusRevision: params.focusRevision,
      },
      run: {
        agentId,
        agentDir,
        sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        workspaceDir: agentDir,
        config: cfg,
        provider: "openai",
        model: "recovery-continue",
        timeoutMs: 120_000,
        blockReplyBreak: "message_end",
        ...(binding ? { taskCompletionBinding: binding } : {}),
      },
    };
    return enqueueFollowupRun(
      params.sessionKey,
      run,
      {
        mode: "followup",
        debounceMs: 0,
        cap: 20,
      },
      "message-id",
    );
  };
}
