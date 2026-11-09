import fs from "node:fs/promises";
import {
  prewarmSessionFile,
  trackSessionManagerAccess,
} from "../../agents/pi-embedded-runner/session-manager-cache.js";
import { prepareSessionManagerForRun } from "../../agents/pi-embedded-runner/session-manager-init.js";
import { openSessionManager } from "../../agents/pi-sdk/session.js";
import { repairSessionFileIfNeeded } from "../../agents/session-file-repair.js";
import { guardSessionManager } from "../../agents/session-tool-result-guard-wrapper.js";
import { resolveTranscriptPolicy } from "../../agents/transcript-policy.js";

/** Caller holds the session lock. Preserve repair/open/guard order and one writer. */
export async function openAttemptSession(input: {
  sessionFile: string;
  model: Parameters<typeof resolveTranscriptPolicy>[0];
  guard: Omit<NonNullable<Parameters<typeof guardSessionManager>[1]>, "allowSyntheticToolResults">;
  warn: (message: string) => void;
}) {
  await repairSessionFileIfNeeded({ sessionFile: input.sessionFile, warn: input.warn });
  const hadSessionFile = await fs
    .stat(input.sessionFile)
    .then(() => true)
    .catch(() => false);
  const transcriptPolicy = resolveTranscriptPolicy(input.model);
  await prewarmSessionFile(input.sessionFile);
  const manager = guardSessionManager(openSessionManager(input.sessionFile), {
    ...input.guard,
    allowSyntheticToolResults: transcriptPolicy.allowSyntheticToolResults,
  });
  trackSessionManagerAccess(input.sessionFile);
  return { manager, transcriptPolicy, hadSessionFile };
}

export const prepareAttemptSessionTranscript = prepareSessionManagerForRun;
