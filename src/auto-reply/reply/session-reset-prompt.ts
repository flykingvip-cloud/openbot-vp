import fs from "node:fs";
import path from "node:path";
import { appendCronStyleCurrentTimeLine } from "../../agents/current-time.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveSessionTranscriptCandidates } from "../../gateway/session-utils.fs.js";
import { formatArchivedTranscriptPointer } from "./task-data-preflight.js";

const BARE_SESSION_RESET_PROMPT_BASE =
  "A new session was started via /new or /reset. Execute your Session Startup sequence now - read the required files before responding to the user. Then greet the user in your configured persona, if one is provided. Be yourself - use your defined voice, mannerisms, and mood. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning.";

export type SessionResetPromptOptions = {
  /** Archived transcript basenames from the prior session (e.g. `*.jsonl.reset.*`). */
  archivedTranscriptPaths?: string[];
  previousSessionId?: string;
};

function buildArchivedTranscriptContinuityBlock(options?: SessionResetPromptOptions): string {
  const archived =
    options?.archivedTranscriptPaths?.map(formatArchivedTranscriptPointer).filter(Boolean) ?? [];
  if (archived.length === 0 && !options?.previousSessionId?.trim()) {
    return "";
  }
  const lines = [
    "Session continuity: the prior conversation transcript was archived when this session started.",
  ];
  if (options?.previousSessionId?.trim()) {
    lines.push(`Previous session id: ${options.previousSessionId.trim()}.`);
  }
  if (archived.length > 0) {
    lines.push(
      `Archived transcript file(s): ${archived.join(", ")} (same sessions directory, suffix .reset.<timestamp>). Read only if the user asks about prior context.`,
    );
  }
  return lines.join(" ");
}

/**
 * Build the bare session reset prompt, appending the current date/time so agents
 * know which daily memory files to read during their Session Startup sequence.
 * Without this, agents on /new or /reset guess the date from their training cutoff.
 */
export function buildBareSessionResetPrompt(
  cfg?: OpenBotConfig,
  nowMs?: number,
  options?: SessionResetPromptOptions,
): string {
  const continuity = buildArchivedTranscriptContinuityBlock(options);
  const base = continuity
    ? `${BARE_SESSION_RESET_PROMPT_BASE}\n\n${continuity}`
    : BARE_SESSION_RESET_PROMPT_BASE;
  return appendCronStyleCurrentTimeLine(base, cfg ?? {}, nowMs ?? Date.now());
}

/** @deprecated Use buildBareSessionResetPrompt(cfg) instead */
export const BARE_SESSION_RESET_PROMPT = BARE_SESSION_RESET_PROMPT_BASE;

/** Resolve archived transcript paths after initSessionState archives the prior session. */
export function resolveArchivedTranscriptPathsForPreviousSession(params: {
  previousSessionEntry?: { sessionId?: string; sessionFile?: string };
  storePath?: string;
  agentId: string;
}): string[] | undefined {
  const sessionId = params.previousSessionEntry?.sessionId?.trim();
  if (!sessionId) {
    return undefined;
  }
  const archived: string[] = [];
  for (const candidate of resolveSessionTranscriptCandidates(
    sessionId,
    params.storePath,
    params.previousSessionEntry?.sessionFile,
    params.agentId,
  )) {
    const dir = path.dirname(candidate);
    const base = path.basename(candidate);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(`${base}.reset.`) || entry.startsWith(`${base}.deleted.`)) {
        archived.push(path.join(dir, entry));
      }
    }
  }
  return archived.length > 0 ? archived : undefined;
}
