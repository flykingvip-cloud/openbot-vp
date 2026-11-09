/**
 * ConversationTask Runtime — close active tasks when a matching inbound turn
 * receives a successful assistant reply. Never throws into dispatch.
 */

import {
  consultDeliveryHoldForClose,
  type DeliveryCloseConsult,
} from "../agents/execution-preflight/completion-hold.js";
import { assessTaskOutputAlignment } from "../cron/task-focus.js";
import { normalizeGoal } from "./canonical.js";
import {
  clearDeliveryCloseConsultPersistFileForTest,
  type ConversationTaskDeliveryCloseConsultRecord,
  isConversationTaskDeliveryCloseConsultPersistEnabled,
  loadDeliveryCloseConsultsFromDisk,
  saveDeliveryCloseConsultsToDisk,
} from "./delivery-close-consult-persist.js";
import { readConversationTaskFlags } from "./feature.js";
import {
  LOCAL_ACTIVATION_TENANT_ID,
  resolveActivationTenantId,
} from "./gateway-activation-hook.js";
import {
  completeConversationTaskLedgerOnReplyOutcome,
  conversationLedgerClosedOnCanonicalEvidence,
  conversationToolObservationKey,
  flushConversationToolObservations,
  isConversationTaskCloseRequiresEvidence,
} from "./ledger-binding.js";
import { defaultShadowStoreRoot } from "./runtime-bootstrap.js";
import { recordCheckedTaskCompletion, type TaskCompletionBinding } from "./session-task-board.js";
import { openTaskStore, type StoredConversationTask } from "./store.js";

export type { ConversationTaskDeliveryCloseConsultRecord };

export type ConversationTaskReplyCompletionInput = {
  tenantId: string | null | undefined;
  requesterId: string | null | undefined;
  conversationId: string | null | undefined;
  sourceMessageId: string | null | undefined;
  text: string;
  /** Assistant reply body — when present and long enough, drift blocks premature close. */
  assistantReplyText?: string | null;
  cronStorePath?: string;
  /** Session transcript. Completion notice is written here only after a real close. */
  sessionFile?: string | null;
  completionBinding?: TaskCompletionBinding;
};

/**
 * Default off. When set, CTR close (reply-completed) and the cancel / focus-switch
 * cancel fence soft-observe the delivery hold before terminal transition and
 * record the snapshot. It does not defer close or cancel.
 */
export const CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV =
  "OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT";

const DELIVERY_CLOSE_CONSULT_LIMIT = 32;

const deliveryCloseConsults: ConversationTaskDeliveryCloseConsultRecord[] = [];

/** Whether the in-process ring has been hydrated from the persist file this process. */
let deliveryCloseConsultsHydrated = false;

export function isConversationTaskDeliveryCloseConsultEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Ensure the in-process ring reflects on-disk state when persist ENV is on.
 * Idempotent per process until reset / simulated restart.
 */
function ensureDeliveryCloseConsultsHydrated(): void {
  if (deliveryCloseConsultsHydrated) {
    return;
  }
  deliveryCloseConsultsHydrated = true;
  if (!isConversationTaskDeliveryCloseConsultPersistEnabled()) {
    return;
  }
  try {
    const loaded = loadDeliveryCloseConsultsFromDisk();
    if (loaded.length === 0) {
      return;
    }
    // Prefer disk as the restart source: replace empty ring; if ring already
    // has records (same process), keep memory and do not clobber.
    if (deliveryCloseConsults.length === 0) {
      for (const row of loaded) {
        deliveryCloseConsults.push(row);
      }
      if (deliveryCloseConsults.length > DELIVERY_CLOSE_CONSULT_LIMIT) {
        deliveryCloseConsults.splice(
          0,
          deliveryCloseConsults.length - DELIVERY_CLOSE_CONSULT_LIMIT,
        );
      }
    }
  } catch {
    // Hydrate failure must not affect close/cancel.
  }
}

export function readConversationTaskDeliveryCloseConsults(): readonly ConversationTaskDeliveryCloseConsultRecord[] {
  ensureDeliveryCloseConsultsHydrated();
  return deliveryCloseConsults;
}

export function resetConversationTaskDeliveryCloseConsultsForTest(): void {
  deliveryCloseConsults.length = 0;
  deliveryCloseConsultsHydrated = false;
  clearDeliveryCloseConsultPersistFileForTest();
}

/**
 * Test helper: drop the in-process ring while keeping the persist file, then
 * mark unhydrated so the next read/remember reloads from disk (restart equivalent).
 */
export function simulateDeliveryCloseConsultProcessRestartForTest(): void {
  deliveryCloseConsults.length = 0;
  deliveryCloseConsultsHydrated = false;
}

/**
 * Soft-observe delivery-hold consult on the cancel / focus-switch cancel fence.
 * Reuses FC-02 ENV (`OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`).
 * Same record shape as reply-completed; `closeDeferred` stays false.
 * Never skips or delays the cancel fence / cancelled transition.
 */
export function observeConversationTaskCancelPathConsult(params: {
  sessionKey?: string | null;
  text?: string | null;
  conversationTaskId?: string | null;
}): void {
  try {
    if (!isConversationTaskDeliveryCloseConsultEnabled()) {
      return;
    }
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    const text = typeof params.text === "string" ? params.text.trim() : "";
    const conversationTaskId =
      typeof params.conversationTaskId === "string" && params.conversationTaskId.trim()
        ? params.conversationTaskId.trim()
        : "cancel-path";
    try {
      const consult = consultDeliveryHoldForClose({
        ...(sessionKey ? { sessionKey } : {}),
        text: text || "(cancel)",
      });
      rememberDeliveryCloseConsult(conversationTaskId, sessionKey || "(none)", consult);
    } catch {
      // A failed observe must not skip or defer the cancel transition.
    }
  } catch {
    // Never throw into the cancel fence.
  }
}

function rememberDeliveryCloseConsult(
  conversationTaskId: string,
  sessionKey: string,
  consult: DeliveryCloseConsult,
): void {
  ensureDeliveryCloseConsultsHydrated();
  deliveryCloseConsults.push({
    conversationTaskId,
    sessionKey,
    mode: "observe",
    closeDeferred: false,
    hasDeliveryContext: consult.hasDeliveryContext,
    sessionHoldAmbiguous: consult.sessionHoldAmbiguous,
    completionClaimBlocked: consult.completionClaimBlocked,
    deliveryBlocksCompletionClaims: consult.deliveryBlocksCompletionClaims,
    holds: consult.holds.map((hold) => ({ ...hold })),
  });
  if (deliveryCloseConsults.length > DELIVERY_CLOSE_CONSULT_LIMIT) {
    deliveryCloseConsults.splice(0, deliveryCloseConsults.length - DELIVERY_CLOSE_CONSULT_LIMIT);
  }
  if (isConversationTaskDeliveryCloseConsultPersistEnabled()) {
    saveDeliveryCloseConsultsToDisk(deliveryCloseConsults);
  }
}

function matchesTask(
  task: StoredConversationTask,
  params: { normalizedGoal: string; sourceMessageId: string },
): boolean {
  if (params.sourceMessageId && task.sourceMessageId === params.sourceMessageId) {
    return true;
  }
  return task.normalizedGoal === params.normalizedGoal;
}

/**
 * Mark the ConversationTask tied to this inbound turn as delivered: ledger
 * acceptance closes, task lifecycle moves to `closed`. No-op when activation is
 * off, identity is missing, or no matching active task exists.
 */
export function observeConversationTaskReplyCompleted(
  input: ConversationTaskReplyCompletionInput,
): Promise<string | undefined> {
  try {
    const flags = readConversationTaskFlags();
    if (!flags.activation) {
      return Promise.resolve(undefined);
    }
    const requesterId = typeof input.requesterId === "string" ? input.requesterId.trim() : "";
    const conversationId =
      typeof input.conversationId === "string" ? input.conversationId.trim() : "";
    const text = input.text.trim();
    if (!requesterId || !conversationId || !text) {
      return Promise.resolve(undefined);
    }
    const tenantId = resolveActivationTenantId(input.tenantId, requesterId);
    if (!tenantId) {
      return Promise.resolve(undefined);
    }
    const normalizedGoal = normalizeGoal(text);
    const sourceMessageId =
      typeof input.sourceMessageId === "string" ? input.sourceMessageId.trim() : "";

    const completionBinding = input.completionBinding;
    return (async () => {
      const store = openTaskStore({
        tenantId,
        storeRoot: defaultShadowStoreRoot(),
      });
      try {
        const candidates = store
          .findActiveTasksByConversation(conversationId)
          .filter((task) => task.requesterId === requesterId || task.ownerId === requesterId);
        const task = candidates.find((row) =>
          matchesTask(row, { normalizedGoal, sourceMessageId }),
        );
        if (!task) {
          return;
        }
        const strictClose = isConversationTaskCloseRequiresEvidence();
        const assistantReply =
          typeof input.assistantReplyText === "string" ? input.assistantReplyText.trim() : "";
        if (assistantReply) {
          const alignment = assessTaskOutputAlignment({
            anchorText: task.goal,
            outputText: assistantReply,
            minOutputLength: 25,
          });
          if (!alignment.aligned) {
            return;
          }
        } else if (strictClose) {
          // Empty assistant text is not completion once evidence is required.
          return;
        }
        if (isConversationTaskDeliveryCloseConsultEnabled()) {
          try {
            const consult = consultDeliveryHoldForClose({
              sessionKey: conversationId,
              text: assistantReply || text,
            });
            rememberDeliveryCloseConsult(String(task.id), conversationId, consult);
          } catch {
            // A failed observe must not skip the domain-local close.
          }
        }
        await flushConversationToolObservations(
          conversationToolObservationKey({
            requesterId,
            conversationId,
            sourceMessageId,
          }),
        );
        const ledgerOutcome = await completeConversationTaskLedgerOnReplyOutcome({
          task,
          cronStorePath: input.cronStorePath,
        });
        const sessionFile = typeof input.sessionFile === "string" ? input.sessionFile : undefined;
        if (strictClose && !conversationLedgerClosedOnCanonicalEvidence(ledgerOutcome.ledger)) {
          if (!ledgerOutcome.closedNow) {
            return undefined;
          }
          return recordCheckedTaskCompletion({
            sessionFile,
            closed: true,
            binding: completionBinding,
          }).notice;
        }
        store.transitionTask(task.id, "closed");
        return recordCheckedTaskCompletion({
          sessionFile,
          closed: true,
          binding: completionBinding,
        }).notice;
      } catch {
        // Ledger close must never surface on the reply path.
      } finally {
        store.close();
      }
    })();
  } catch {
    // Fail closed: never throw into dispatch-from-config.
    return Promise.resolve(undefined);
  }
}

/** @internal test-only export for LOCAL tenant alias parity */
export const _LOCAL_ACTIVATION_TENANT_ID = LOCAL_ACTIVATION_TENANT_ID;
