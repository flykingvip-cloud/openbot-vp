/**
 * askOutcome P1: map embedded-run terminal signals to honest skill/pattern attribution.
 * Unknown (no abort/timeout/prompt error) → skip run-level success; do not invent failure.
 */
export function resolveAttemptEndOfRunAttribution(params: {
  aborted: boolean;
  timedOut: boolean;
  promptError: unknown;
  lastAssistantErrorMessage?: string | null;
}): {
  runFailed: boolean;
  skillOutcome: "failure" | null;
  patternSuccess: boolean | null;
} {
  const runFailed = Boolean(
    params.aborted || params.timedOut || params.promptError || params.lastAssistantErrorMessage,
  );
  return {
    runFailed,
    skillOutcome: runFailed ? "failure" : null,
    patternSuccess: runFailed ? false : null,
  };
}
