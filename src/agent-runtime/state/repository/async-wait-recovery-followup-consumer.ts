/**
 * Cold-start followup consumer for Package2 async-wait recovery.
 * Registers the existing createFollowupRunner drain callback so enqueue +
 * kickFollowupDrainIfIdle actually consume recovery work after gateway boot
 * without waiting for a live user turn.
 */
import fs from "node:fs";
import { resolveDefaultModelForAgent } from "../../../agents/model-selection.js";
import { createFollowupRunner } from "../../../auto-reply/reply/followup-runner.js";
import {
  hasFollowupDrainCallback,
  registerFollowupDrainCallback,
} from "../../../auto-reply/reply/queue.js";
import { createTypingController } from "../../../auto-reply/reply/typing.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { resolveDefaultSessionStorePath } from "../../../config/sessions/paths.js";
import { loadSessionStore } from "../../../config/sessions/store.js";
import type { SessionEntry } from "../../../config/sessions/types.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";

export function ensureAsyncWaitRecoveryFollowupConsumer(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
}): boolean {
  const key = params.sessionKey.trim();
  if (!key) {
    return false;
  }
  if (hasFollowupDrainCallback(key)) {
    return false;
  }
  const agentId = resolveAgentIdFromSessionKey(key);
  const storePath = resolveDefaultSessionStorePath(agentId);
  let sessionStore: Record<string, SessionEntry> | undefined;
  let sessionEntry: SessionEntry | undefined;
  try {
    if (fs.existsSync(storePath)) {
      sessionStore = loadSessionStore(storePath);
      sessionEntry = sessionStore[key] ?? sessionStore[key.toLowerCase()];
    }
  } catch {
    sessionStore = undefined;
    sessionEntry = undefined;
  }
  const modelRef = resolveDefaultModelForAgent({ cfg: params.cfg, agentId });
  const defaultModel = `${modelRef.provider}/${modelRef.model}`;
  const typing = createTypingController({});
  const runFollowup = createFollowupRunner({
    typing,
    typingMode: "never",
    sessionEntry,
    sessionStore,
    sessionKey: key,
    storePath,
    defaultModel,
  });
  registerFollowupDrainCallback(key, runFollowup);
  return true;
}
