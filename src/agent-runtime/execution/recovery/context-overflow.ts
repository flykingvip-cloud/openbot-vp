/** One recovery transaction. The caller owns the only attempt loop. */
export async function recoverContextOverflow<TMessage>({
  ports,
  contextOverflowError,
  attempt,
  attemptCompactionCount,
  params,
  provider,
  modelId,
  ctxInfo,
  createDiagId,
  compact,
  overflowCompactionAttempts,
  toolResultTruncationAttempted,
  autoCompactionCount,
  MAX_OVERFLOW_COMPACTION_ATTEMPTS,
}: {
  ports: {
    isCompactionFailureError: (text: string) => boolean;
    log: {
      warn: (text: string) => void;
      info: (text: string) => void;
      debug: (text: string) => void;
      isEnabled: (level: "debug") => boolean;
    };
    hasOversized: (input: { messages: TMessage[]; contextWindowTokens: number }) => boolean;
    truncate: (input: {
      sessionFile: string;
      contextWindowTokens: number;
      sessionId: string;
      sessionKey?: string;
    }) => Promise<{ truncated: boolean; truncatedCount: number; reason?: string }>;
  };
  contextOverflowError: { text: string; source: string };
  attempt: { messagesSnapshot?: TMessage[] };
  attemptCompactionCount: number;
  params: { sessionKey?: string; sessionId: string; sessionFile: string };
  provider: string;
  modelId: string;
  ctxInfo: { tokens: number };
  createDiagId: () => string;
  compact: (input: {
    diagId: string;
    attemptNumber: number;
  }) => Promise<{ compacted: boolean; reason?: string }>;
  overflowCompactionAttempts: number;
  toolResultTruncationAttempted: boolean;
  autoCompactionCount: number;
  MAX_OVERFLOW_COMPACTION_ATTEMPTS: number;
}): Promise<
  {
    overflowCompactionAttempts: number;
    toolResultTruncationAttempted: boolean;
    autoCompactionCount: number;
  } & (
    | { action: "retry" }
    | { action: "terminal"; kind: "compaction_failure" | "context_overflow" }
  )
> {
  const { log, isCompactionFailureError } = ports;
  const overflowDiagId = createDiagId();
  const errorText = contextOverflowError.text;
  const msgCount = attempt.messagesSnapshot?.length ?? 0;
  log.warn(
    `[context-overflow-diag] sessionKey=${params.sessionKey ?? params.sessionId} ` +
      `provider=${provider}/${modelId} source=${contextOverflowError.source} ` +
      `messages=${msgCount} sessionFile=${params.sessionFile} ` +
      `diagId=${overflowDiagId} compactionAttempts=${overflowCompactionAttempts} ` +
      `error=${errorText.slice(0, 200)}`,
  );
  const isCompactionFailure = isCompactionFailureError(errorText);
  const hadAttemptLevelCompaction = attemptCompactionCount > 0;
  // If this attempt already compacted (SDK auto-compaction), avoid immediately
  // running another explicit compaction for the same overflow trigger.
  if (
    !isCompactionFailure &&
    hadAttemptLevelCompaction &&
    overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS
  ) {
    overflowCompactionAttempts++;
    log.warn(
      `context overflow persisted after in-attempt compaction (attempt ${overflowCompactionAttempts}/${MAX_OVERFLOW_COMPACTION_ATTEMPTS}); retrying prompt without additional compaction for ${provider}/${modelId}`,
    );
    return {
      action: "retry" as const,
      overflowCompactionAttempts,
      toolResultTruncationAttempted,
      autoCompactionCount,
    };
  }
  // Attempt explicit overflow compaction only when this attempt did not
  // already auto-compact.
  if (
    !isCompactionFailure &&
    !hadAttemptLevelCompaction &&
    overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS
  ) {
    if (log.isEnabled("debug")) {
      log.debug(
        `[compaction-diag] decision diagId=${overflowDiagId} branch=compact ` +
          `isCompactionFailure=${isCompactionFailure} hasOversizedToolResults=unknown ` +
          `attempt=${overflowCompactionAttempts + 1} maxAttempts=${MAX_OVERFLOW_COMPACTION_ATTEMPTS}`,
      );
    }
    overflowCompactionAttempts++;
    log.warn(
      `context overflow detected (attempt ${overflowCompactionAttempts}/${MAX_OVERFLOW_COMPACTION_ATTEMPTS}); attempting auto-compaction for ${provider}/${modelId}`,
    );
    const compactResult = await compact({
      diagId: overflowDiagId,
      attemptNumber: overflowCompactionAttempts,
    });
    if (compactResult.compacted) {
      autoCompactionCount += 1;
      log.info(`auto-compaction succeeded for ${provider}/${modelId}; retrying prompt`);
      return {
        action: "retry" as const,
        overflowCompactionAttempts,
        toolResultTruncationAttempted,
        autoCompactionCount,
      };
    }
    log.warn(
      `auto-compaction failed for ${provider}/${modelId}: ${compactResult.reason ?? "nothing to compact"}`,
    );
  }
  // Fallback: try truncating oversized tool results in the session.
  // This handles the case where a single tool result exceeds the
  // context window and compaction cannot reduce it further.
  if (!toolResultTruncationAttempted) {
    const contextWindowTokens = ctxInfo.tokens;
    const hasOversized = attempt.messagesSnapshot
      ? ports.hasOversized({
          messages: attempt.messagesSnapshot,
          contextWindowTokens,
        })
      : false;

    if (hasOversized) {
      if (log.isEnabled("debug")) {
        log.debug(
          `[compaction-diag] decision diagId=${overflowDiagId} branch=truncate_tool_results ` +
            `isCompactionFailure=${isCompactionFailure} hasOversizedToolResults=${hasOversized} ` +
            `attempt=${overflowCompactionAttempts} maxAttempts=${MAX_OVERFLOW_COMPACTION_ATTEMPTS}`,
        );
      }
      toolResultTruncationAttempted = true;
      log.warn(
        `[context-overflow-recovery] Attempting tool result truncation for ${provider}/${modelId} ` +
          `(contextWindow=${contextWindowTokens} tokens)`,
      );
      const truncResult = await ports.truncate({
        sessionFile: params.sessionFile,
        contextWindowTokens,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
      });
      if (truncResult.truncated) {
        log.info(
          `[context-overflow-recovery] Truncated ${truncResult.truncatedCount} tool result(s); retrying prompt`,
        );
        // Do NOT reset overflowCompactionAttempts here — the global cap must remain
        // enforced across all iterations to prevent unbounded compaction cycles (OC-65).
        return {
          action: "retry" as const,
          overflowCompactionAttempts,
          toolResultTruncationAttempted,
          autoCompactionCount,
        };
      }
      log.warn(
        `[context-overflow-recovery] Tool result truncation did not help: ${truncResult.reason ?? "unknown"}`,
      );
    } else if (log.isEnabled("debug")) {
      log.debug(
        `[compaction-diag] decision diagId=${overflowDiagId} branch=give_up ` +
          `isCompactionFailure=${isCompactionFailure} hasOversizedToolResults=${hasOversized} ` +
          `attempt=${overflowCompactionAttempts} maxAttempts=${MAX_OVERFLOW_COMPACTION_ATTEMPTS}`,
      );
    }
  }
  if (
    (isCompactionFailure ||
      overflowCompactionAttempts >= MAX_OVERFLOW_COMPACTION_ATTEMPTS ||
      toolResultTruncationAttempted) &&
    log.isEnabled("debug")
  ) {
    log.debug(
      `[compaction-diag] decision diagId=${overflowDiagId} branch=give_up ` +
        `isCompactionFailure=${isCompactionFailure} hasOversizedToolResults=unknown ` +
        `attempt=${overflowCompactionAttempts} maxAttempts=${MAX_OVERFLOW_COMPACTION_ATTEMPTS}`,
    );
  }
  return {
    action: "terminal" as const,
    kind: isCompactionFailure ? ("compaction_failure" as const) : ("context_overflow" as const),
    overflowCompactionAttempts,
    toolResultTruncationAttempted,
    autoCompactionCount,
  };
}
