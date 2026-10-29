import { extractText } from "./message-extract.ts";

function roleOf(message: unknown): string {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "";
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

function messageId(message: unknown): string {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "";
  }
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" ? id.trim() : "";
}

function messageText(message: unknown): string {
  return extractText(message)?.trim() ?? "";
}

const LOCAL_GROWTH_OPENING_ID_PREFIX = "local-growth-opening-";

export function isOptimisticLocalUserMessage(message: unknown): boolean {
  return roleOf(message) === "user" && messageId(message).startsWith("local-");
}

function isLocalGrowthOpeningMessage(message: unknown): boolean {
  return (
    roleOf(message) === "assistant" && messageId(message).startsWith(LOCAL_GROWTH_OPENING_ID_PREFIX)
  );
}

function hasModelAssistantMessage(messages: unknown[]): boolean {
  return messages.some(
    (message) => roleOf(message) === "assistant" && !isLocalGrowthOpeningMessage(message),
  );
}

function sameVisibleMessage(left: unknown, right: unknown): boolean {
  const leftId = messageId(left);
  const rightId = messageId(right);
  if (leftId && rightId && leftId === rightId) {
    return true;
  }
  const role = roleOf(left);
  if (!role || role !== roleOf(right)) {
    return false;
  }
  const text = messageText(left);
  return Boolean(text) && text === messageText(right);
}

export function latestTurnHasAssistantReply(messages: unknown[]): boolean {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (roleOf(messages[index]) === "user") {
      lastUser = index;
      break;
    }
  }
  if (lastUser < 0) {
    return false;
  }
  return messages.slice(lastUser + 1).some((message) => roleOf(message) === "assistant");
}

/**
 * Quiet history reloads after a nav switch must not delete the in-flight user
 * instruction. Persistence lag and assistant-only pages would otherwise replace
 * `local-<runId>` with results and make the task look like it vanished.
 */
export function mergeIncomingHistoryWithLocalUserTurn(
  localMessages: unknown[],
  incomingMessages: unknown[],
): unknown[] {
  const local = Array.isArray(localMessages) ? localMessages : [];
  const incoming = Array.isArray(incomingMessages) ? incomingMessages : [];
  let optimisticIndex = -1;
  for (let index = local.length - 1; index >= 0; index -= 1) {
    if (isOptimisticLocalUserMessage(local[index])) {
      optimisticIndex = index;
      break;
    }
  }
  if (optimisticIndex < 0) {
    if (openingsShouldStay(local, incoming)) {
      return prependLocalOpenings(local, incoming);
    }
    return incoming;
  }
  const optimistic = local[optimisticIndex];
  const optimisticId = messageId(optimistic);
  // Only drop the optimistic bubble when THIS send's identity appears
  // (server persists id `local-${runId}` / idempotencyKey = runId).
  if (optimisticId && incoming.some((message) => messageId(message) === optimisticId)) {
    if (openingsShouldStay(local, incoming)) {
      return prependLocalOpenings(local, incoming);
    }
    return incoming;
  }
  // Do NOT treat same text alone as "this send persisted". An older
  // non-local user row with identical text (e.g. a prior "继续") would
  // delete a new in-flight local-* bubble when history lag returns only
  // the old row. Persistence identity is local-${runId} (server echoes
  // the same id / idempotencyKey as chat.send).
  const localHead = local.slice(0, optimisticIndex + 1);
  const extra = incoming.filter(
    (message) => !localHead.some((existing) => sameVisibleMessage(existing, message)),
  );
  const merged = [...localHead, ...extra];
  if (openingsShouldStay(local, merged)) {
    return prependLocalOpenings(local, merged);
  }
  return merged;
}

function openingsShouldStay(local: unknown[], incoming: unknown[]): boolean {
  return local.some(isLocalGrowthOpeningMessage) && !hasModelAssistantMessage(incoming);
}

function prependLocalOpenings(local: unknown[], incoming: unknown[]): unknown[] {
  const openings = local.filter(
    (message) =>
      isLocalGrowthOpeningMessage(message) &&
      !incoming.some((row) => sameVisibleMessage(row, message)),
  );
  return openings.length > 0 ? [...openings, ...incoming] : incoming;
}
