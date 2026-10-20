export type RunReplyLanguage = "zh" | "en";

const replyLanguageByRun = new Map<string, RunReplyLanguage | null>();

export function registerRunReplyLanguage(runId: string, language: RunReplyLanguage | null): void {
  if (!runId) {
    return;
  }
  replyLanguageByRun.set(runId, language);
}

export function getRunReplyLanguage(runId: string | undefined): RunReplyLanguage | null {
  if (!runId) {
    return null;
  }
  return replyLanguageByRun.get(runId) ?? null;
}

export function clearRunReplyLanguage(runId: string): void {
  replyLanguageByRun.delete(runId);
}

export function resetRunReplyLanguageForTest(): void {
  replyLanguageByRun.clear();
}
