import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../../config/sessions.js";
import {
  isGroupPublicTranscriptSessionFile,
  resolveGroupPublicTranscriptPath,
} from "../../gateway/collaboration-learning/collaboration-paths.js";
import { resolveExistingSessionTranscriptPath } from "../../gateway/session-utils.fs.js";

type SessionFileEntry = {
  sessionFile?: string;
};

function collaborationGroupIdFromSessionKey(sessionKey?: string): string | null {
  const raw = sessionKey?.trim() ?? "";
  if (!raw.toLowerCase().startsWith("space:")) {
    return null;
  }
  let groupId = raw.slice("space:".length).trim();
  while (/^space:/i.test(groupId)) {
    groupId = groupId.slice("space:".length).trim();
  }
  return groupId || null;
}

/**
 * Collaboration rounds must open the GROUP_PUBLIC transcript
 * (`…/groups/<id>/runtime/transcript.jsonl`).
 *
 * `resolveSessionFilePath` confines paths to the agent sessions directory.
 * A shared transcript lives outside that directory, so the call falls back to
 * `sessions/<sessionId>.jsonl`. Checkpoint restore truncates the shared file
 * the UI reads; the model would keep the untouched fallback and the next
 * bind could merge that fallback back over the truncation.
 */
export function resolveCollaborationAwareSessionFile(params: {
  sessionId: string;
  sessionKey?: string;
  sessionEntry?: SessionFileEntry;
  agentId?: string;
  storePath?: string;
  cfg?: OpenBotConfig;
}): string {
  const explicit = params.sessionEntry?.sessionFile?.trim();
  if (explicit && isGroupPublicTranscriptSessionFile(explicit)) {
    return path.resolve(explicit);
  }
  const groupId = collaborationGroupIdFromSessionKey(params.sessionKey);
  if (groupId) {
    return path.resolve(resolveGroupPublicTranscriptPath(groupId, params.cfg));
  }
  const canonical = resolveSessionFilePath(
    params.sessionId,
    params.sessionEntry,
    resolveSessionFilePathOptions({
      agentId: params.agentId,
      storePath: params.storePath,
    }),
  );
  // chat.history shows the first existing candidate. When the sessions-dir
  // path is missing, open that same in-dir file so a robot turn does not
  // start a blank transcript beside the one the user is reading.
  try {
    if (!fs.existsSync(canonical) && params.storePath) {
      const visible = resolveExistingSessionTranscriptPath(
        params.sessionId,
        params.storePath,
        params.sessionEntry?.sessionFile,
      );
      if (visible && transcriptPathInsideSessionsDir(params.storePath, visible)) {
        return path.resolve(visible);
      }
    }
  } catch {
    // Keep the canonical path when the candidate scan cannot run.
  }
  return canonical;
}

function transcriptPathInsideSessionsDir(storePath: string, transcriptPath: string): boolean {
  const sessionsDir = path.resolve(path.dirname(storePath));
  const relative = path.relative(sessionsDir, path.resolve(transcriptPath));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
