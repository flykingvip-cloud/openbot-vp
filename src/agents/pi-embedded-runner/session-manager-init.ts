import fs from "node:fs/promises";
import { isGroupPublicTranscriptSessionFile } from "../../gateway/collaboration-learning/collaboration-paths.js";

type SessionHeaderEntry = { type: "session"; id?: string; cwd?: string };
type SessionMessageEntry = { type: "message"; message?: { role?: string } };

/**
 * pi-coding-agent SessionManager persistence quirk:
 * - If the file exists but has no assistant message, SessionManager marks itself `flushed=true`
 *   and will never persist the initial user message.
 * - If the file doesn't exist yet, SessionManager builds a new session in memory and flushes
 *   header+user+assistant once the first assistant arrives (good).
 *
 * This normalizes the file/session state so the first user prompt is persisted before the first
 * assistant entry, even for pre-created session files.
 *
 * Exception: GROUP_PUBLIC shared transcripts (`…/groups/<id>/runtime/transcript.jsonl`) must
 * never be wiped. Collaboration already wrote the user turn there (often without `type:"message"`),
 * so a header+no-assistant reset would destroy shared history. Collaboration rounds also set
 * `skipUserTranscriptPersist`, so the SessionManager user-persist quirk does not apply.
 */
export async function prepareSessionManagerForRun(params: {
  sessionManager: unknown;
  sessionFile: string;
  hadSessionFile: boolean;
  sessionId: string;
  cwd: string;
  preserveUserTranscript?: boolean;
}): Promise<void> {
  const sm = params.sessionManager as {
    sessionId: string;
    flushed: boolean;
    fileEntries: Array<SessionHeaderEntry | SessionMessageEntry | { type: string }>;
    byId?: Map<string, unknown>;
    labelsById?: Map<string, unknown>;
    leafId?: string | null;
  };

  const header = sm.fileEntries.find((e): e is SessionHeaderEntry => e.type === "session");
  const hasAssistant = sm.fileEntries.some(
    (e) => e.type === "message" && (e as SessionMessageEntry).message?.role === "assistant",
  );

  if (!params.hadSessionFile && header) {
    header.id = params.sessionId;
    header.cwd = params.cwd;
    sm.sessionId = params.sessionId;
    return;
  }

  if (params.hadSessionFile && header && !hasAssistant) {
    // Never wipe shared collaboration transcripts — gateway already appended the user turn.
    if (params.preserveUserTranscript || isGroupPublicTranscriptSessionFile(params.sessionFile)) {
      return;
    }
    // Reset so the first assistant flush includes header+user+assistant in order.
    // pi-coding-agent SessionManager._persist uses openSync(path, "wx") when flushed=false.
    // Truncating to an empty *existing* file leaves the path on disk and the next flush
    // throws EEXIST (seen after checkpoint restore / abort that leave a 0-byte jsonl).
    // Unlink instead so "wx" can create the file cleanly.
    await fs.unlink(params.sessionFile).catch((err: NodeJS.ErrnoException) => {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    });
    sm.fileEntries = [header];
    sm.byId?.clear?.();
    sm.labelsById?.clear?.();
    sm.leafId = null;
    sm.flushed = false;
  }
}
