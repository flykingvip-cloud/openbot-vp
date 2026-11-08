import path from "node:path";
import {
  dropSupersededStallTexts,
  EMPTY_AFTER_TOOLS_CONTINUE_LIMIT,
  EMPTY_AFTER_TOOLS_CONTINUE_PROMPT,
  EXECUTION_STALL_CONTINUE_LIMIT,
  EXECUTION_STALL_CONTINUE_PROMPT,
  executionContinueKind,
  FALSE_CONFIRM_CONTINUE_LIMIT,
  FALSE_CONFIRM_CONTINUE_PROMPT,
  SILENT_EXEC_CONTINUE_LIMIT,
  RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT,
  RECOVERABLE_TOOL_FAILURE_CONTINUE_PROMPT,
  SILENT_EXEC_CONTINUE_PROMPT,
  lastAssistantStopKind,
  lastAssistantStopText,
  latestUserText,
  shouldContinueAfterEmptyToolFinal,
  claimStallContinue,
} from "../../../agents/execution-stall-continue.js";
import { isRunnerAbortError } from "../../../agents/pi-embedded-runner/abort.js";
import {
  appendCacheTtlTimestamp,
  isCacheTtlEligibleProvider,
} from "../../../agents/pi-embedded-runner/cache-ttl.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { waitForCompactionRetryWithAggregateTimeout } from "../../../agents/pi-embedded-runner/run/compaction-retry-aggregate-timeout.js";
import { selectCompactionTimeoutSnapshot } from "../../../agents/pi-embedded-runner/run/compaction-timeout.js";
import { rewriteAttemptVisibleReply } from "../../../agents/pi-embedded-runner/run/rewrite-visible-reply.js";
import type { EmbeddedRunAttemptParams } from "../../../agents/pi-embedded-runner/run/types.js";
import { describeUnknownError } from "../../../agents/pi-embedded-runner/utils.js";
import { isProtocolViolationContinueBlocked } from "../../../agents/protocol-violation.js";
import { persistAttemptPromptError } from "../../state/index.js";
import { sessionTaskState } from "../../state/index.js";
import { runExecutionStallContinueLoop } from "../recovery/stall-continuation.js";
import type { EmbeddedAttemptState } from "./embedded-attempt-preflight.js";

/** Progress-only stops through cache-TTL timestamps and compaction-timeout snapshot. */
export async function runEmbeddedAttemptContinue(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- phase bag temp */
  let __d: any;
  // Progress-only stops, a repeated 「请确认」 after GO, and an empty
  // final after successful tools otherwise end the run. Each continues
  // a small bounded number of times. Questions, permission, payment,
  // scan, and authorization pauses stay terminal.
  if (
    !s.promptError &&
    !s.aborted &&
    !s.timedOut &&
    !isProtocolViolationContinueBlocked({
      boundaryTerminated: s.protocolBoundaryState.terminated,
      messages: s.activeSession.messages,
    })
  ) {
    const toolsDisabled = params.disableTools === true;
    const continuedStalls: string[] = [];
    let stallContinues = 0;
    let falseConfirmContinues = 0;
    let emptyAfterToolsContinues = 0;
    let silentExecContinues = 0;
    let recoverableContinues = 0;
    // Durable ≤2 progress-stall ledger (restart + concurrency safe via wx slots).
    // Quota cycle binds to board taskId so same-task retry shares ≤2 and a
    // new task in the same chat gets an independent quota (resume cannot
    // swap ids: cycle comes from authoritative board current, not user text).
    const stallLedgerSessionKey = (
      params.sessionKey?.trim() ||
      params.sessionId?.trim() ||
      ""
    ).trim();
    let stallQuotaCycleId = "";
    try {
      const boardTaskId = sessionTaskState.read(params.sessionFile).current?.taskId?.trim();
      if (boardTaskId) {
        stallQuotaCycleId = boardTaskId;
      }
    } catch {
      // Board unavailable — fall through to execution task id.
    }
    if (!stallQuotaCycleId) {
      stallQuotaCycleId = (s.executionTaskId ?? "").trim();
    }
    const stallLedger =
      stallLedgerSessionKey && params.agentDir?.trim() && stallQuotaCycleId
        ? {
            ledgerDir: path.join(params.agentDir.trim(), "stall-continue-ledger"),
            sessionKey: stallLedgerSessionKey,
            quotaCycleId: stallQuotaCycleId,
          }
        : undefined;
    const continueBudget =
      EXECUTION_STALL_CONTINUE_LIMIT +
      FALSE_CONFIRM_CONTINUE_LIMIT +
      EMPTY_AFTER_TOOLS_CONTINUE_LIMIT +
      SILENT_EXEC_CONTINUE_LIMIT +
      RECOVERABLE_TOOL_FAILURE_CONTINUE_LIMIT;
    await runExecutionStallContinueLoop({
      continueBudget,
      isAbortedOrTimedOut: () => s.aborted || s.timedOut,
      getProtocolBlock: () => ({
        boundaryTerminated: s.protocolBoundaryState.terminated,
        messages: s.activeSession.messages,
      }),
      resolveContinue: () => {
        const stopText = lastAssistantStopText(s.activeSession.messages);
        const userText = latestUserText(s.activeSession.messages);
        const kind = executionContinueKind({
          text: stopText,
          toolsDisabled,
          continuesUsed: stallContinues,
          latestUserText: userText,
          falseConfirmContinuesUsed: falseConfirmContinues,
          silentExecContinuesUsed: silentExecContinues,
          recoverableContinuesUsed: recoverableContinues,
          tools: s.toolMetas,
          visibleTexts: s.assistantTexts,
          stallLedger,
        });
        const emptyContinue =
          !kind &&
          shouldContinueAfterEmptyToolFinal({
            stopKind: lastAssistantStopKind(s.activeSession.messages),
            toolsDisabled,
            continuesUsed: emptyAfterToolsContinues,
            tools: s.toolMetas,
            visibleTexts: s.assistantTexts,
          });
        return { kind, emptyContinue, stopText };
      },
      sendContinue: async ({ kind }) => {
        if (kind === "progress-stall" && stallLedger) {
          const claim = claimStallContinue(stallLedger);
          if (!claim.allowed) {
            throw new Error(claim.stopReason ?? "execution_stall_continue_exhausted");
          }
          stallContinues = claim.continuesUsed;
        }
        try {
          await s.abortable(
            s.activeSession.sendCustomMessage(
              {
                customType: "openbot:execution-stall-continue",
                content:
                  kind === "silent-exec"
                    ? SILENT_EXEC_CONTINUE_PROMPT
                    : kind === "false-confirm"
                      ? FALSE_CONFIRM_CONTINUE_PROMPT
                      : kind === "empty-after-tools"
                        ? EMPTY_AFTER_TOOLS_CONTINUE_PROMPT
                        : kind === "recoverable-tool-failure"
                          ? RECOVERABLE_TOOL_FAILURE_CONTINUE_PROMPT
                          : EXECUTION_STALL_CONTINUE_PROMPT,
                display: false,
                details: { reason: kind },
              },
              { triggerTurn: true },
            ),
          );
        } catch (err) {
          log.warn(`execution stall continuation failed: ${String(err)}`);
          throw err;
        }
      },
      onContinued: (kind, stopText) => {
        if (kind === "progress-stall") {
          // When durable ledger is active, claim already set stallContinues.
          if (!stallLedger) {
            stallContinues += 1;
          }
          if (stopText) {
            continuedStalls.push(stopText);
          }
        } else if (kind === "false-confirm") {
          falseConfirmContinues += 1;
          if (stopText) {
            continuedStalls.push(stopText);
          }
        } else if (kind === "silent-exec") {
          silentExecContinues += 1;
          if (stopText) {
            continuedStalls.push(stopText);
          }
        } else if (kind === "recoverable-tool-failure") {
          recoverableContinues += 1;
          if (stopText) {
            continuedStalls.push(stopText);
          }
        } else {
          emptyAfterToolsContinues += 1;
        }
      },
    });
    if (continuedStalls.length > 0) {
      dropSupersededStallTexts(
        s.assistantTexts,
        continuedStalls,
        lastAssistantStopText(s.activeSession.messages),
      );
    }
  }

  try {
    await rewriteAttemptVisibleReply({
      runId: params.runId,
      assistantTexts: s.assistantTexts,
      messages: s.activeSession.messages,
      sessionFile: params.sessionFile,
      workspaceDir: s.effectiveWorkspace,
      sessionKey: params.sessionKey,
      ...(params.oguiDecisionRun ? { oguiDecisionRun: params.oguiDecisionRun } : {}),
    });
  } catch (err) {
    log.warn(`visible reply rewrite failed: ${String(err)}`);
  }

  // Capture snapshot before compaction wait so we have complete messages if timeout occurs
  // Check compaction state before and after to avoid race condition where compaction starts during capture
  // Use session state (not subscription) for snapshot decisions - need instantaneous compaction status
  const wasCompactingBefore = s.activeSession.isCompacting;
  const snapshot = s.activeSession.messages.slice();
  const wasCompactingAfter = s.activeSession.isCompacting;
  // Only trust snapshot if compaction wasn't running before or after capture
  s.preCompactionSnapshot = wasCompactingBefore || wasCompactingAfter ? null : snapshot;
  s.preCompactionSessionId = s.activeSession.sessionId;
  const COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS = 60_000;

  try {
    // Flush buffered block replies before waiting for compaction so the
    // user receives the assistant response immediately.  Without this,
    // coalesced/buffered blocks stay in the pipeline until compaction
    // finishes — which can take minutes on large contexts (#35074).
    if (params.onBlockReplyFlush) {
      await params.onBlockReplyFlush();
    }

    const compactionRetryWait = await waitForCompactionRetryWithAggregateTimeout({
      waitForCompactionRetry: s.waitForCompactionRetry,
      abortable: s.abortable,
      aggregateTimeoutMs: COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS,
      isCompactionStillInFlight: s.isCompactionInFlight,
    });
    if (compactionRetryWait.timedOut) {
      s.timedOutDuringCompaction = true;
      if (!s.isProbeSession) {
        log.warn(
          `compaction retry aggregate timeout (${COMPACTION_RETRY_AGGREGATE_TIMEOUT_MS}ms): ` +
            `proceeding with pre-compaction state runId=${params.runId} sessionId=${params.sessionId}`,
        );
      }
    }
  } catch (err) {
    if (isRunnerAbortError(err)) {
      if (!s.promptError) {
        s.promptError = err;
        s.promptErrorSource = "compaction";
      }
      if (!s.isProbeSession) {
        log.debug(`compaction wait aborted: runId=${params.runId} sessionId=${params.sessionId}`);
      }
    } else {
      throw err;
    }
  }

  s.compactionOccurredThisAttempt = s.getCompactionCount() > 0;

  // Append cache-TTL timestamp AFTER prompt + compaction retry completes.
  // Previously this was before the prompt, which caused a custom entry to be
  // inserted between compaction and the next prompt — breaking the
  // prepareCompaction() guard that checks the last entry type, leading to
  // double-compaction. See: https://github.com/openclaw/openclaw/issues/9282
  // Skip when timed out during compaction — session state may be inconsistent.
  if (!s.timedOutDuringCompaction && !s.compactionOccurredThisAttempt) {
    const shouldTrackCacheTtl =
      params.config?.agents?.defaults?.contextPruning?.mode === "cache-ttl" &&
      isCacheTtlEligibleProvider(params.provider, params.modelId);
    if (shouldTrackCacheTtl) {
      appendCacheTtlTimestamp(s.sessionManager, {
        timestamp: Date.now(),
        provider: params.provider,
        modelId: params.modelId,
      });
    }
  }

  // If timeout occurred during compaction, use pre-compaction snapshot when available
  // (compaction restructures messages but does not add user/assistant turns).
  const snapshotSelection = selectCompactionTimeoutSnapshot({
    timedOutDuringCompaction: s.timedOutDuringCompaction,
    preCompactionSnapshot: s.preCompactionSnapshot,
    preCompactionSessionId: s.preCompactionSessionId,
    currentSnapshot: s.activeSession.messages.slice(),
    currentSessionId: s.activeSession.sessionId,
  });
  if (s.timedOutDuringCompaction) {
    if (!s.isProbeSession) {
      log.warn(
        `using ${snapshotSelection.source} snapshot: timed out during compaction runId=${params.runId} sessionId=${params.sessionId}`,
      );
    }
  }
  s.messagesSnapshot = snapshotSelection.messagesSnapshot;
  s.sessionIdUsed = snapshotSelection.sessionIdUsed;

  if (s.promptError && s.promptErrorSource === "prompt" && !s.compactionOccurredThisAttempt) {
    persistAttemptPromptError(
      s.sessionManager,
      {
        runId: params.runId,
        sessionId: params.sessionId,
        provider: params.provider,
        model: params.modelId,
        api: params.model.api,
        error: describeUnknownError(s.promptError),
      },
      (message) => log.warn(message),
    );
  }
}
