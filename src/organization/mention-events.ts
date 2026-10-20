/**
 * Mention Event Bus — in-memory pub/sub for mention lifecycle events.
 *
 * Subscribers receive events synchronously (handler called inline on emit).
 * Filter matching uses AND logic: all specified filter fields must match;
 * unspecified fields match everything.
 */

import type { MentionEvent, MentionEventType } from "./mention-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filter criteria for subscribing to mention events. */
export type MentionEventFilter = {
  type?: MentionEventType;
  target_agent_id?: string;
  organization_id?: string;
};

/** Handler invoked when a matching event is emitted. */
export type MentionEventHandler = (event: MentionEvent) => void;

/** A subscription entry combining filter and handler. */
type Subscription = {
  filter: MentionEventFilter;
  handler: MentionEventHandler;
};

// ---------------------------------------------------------------------------
// MentionEventBus interface
// ---------------------------------------------------------------------------

/** Event bus for mention lifecycle events. */
export interface MentionEventBus {
  /** Emit a mention lifecycle event to all matching subscribers. */
  emit(event: MentionEvent): void;

  /**
   * Subscribe to mention events matching the given filter.
   * Returns an unsubscribe function that removes this subscription.
   */
  subscribe(filter: MentionEventFilter, handler: MentionEventHandler): () => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Checks whether an event matches a subscription filter.
 * All specified filter fields must match (AND logic).
 * Unspecified (undefined) fields match everything.
 */
function matchesFilter(event: MentionEvent, filter: MentionEventFilter): boolean {
  if (filter.type !== undefined && event.type !== filter.type) {
    return false;
  }
  if (filter.target_agent_id !== undefined && event.target_agent_id !== filter.target_agent_id) {
    return false;
  }
  if (filter.organization_id !== undefined && event.organization_id !== filter.organization_id) {
    return false;
  }
  return true;
}

/** Create a new MentionEventBus instance. */
export function createMentionEventBus(): MentionEventBus {
  const subscriptions: Set<Subscription> = new Set();

  return {
    emit(event: MentionEvent): void {
      for (const subscription of subscriptions) {
        if (matchesFilter(event, subscription.filter)) {
          subscription.handler(event);
        }
      }
    },

    subscribe(filter: MentionEventFilter, handler: MentionEventHandler): () => void {
      const subscription: Subscription = { filter, handler };
      subscriptions.add(subscription);

      return () => {
        subscriptions.delete(subscription);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default singleton instance
// ---------------------------------------------------------------------------

/** Default singleton MentionEventBus for the current process. */
export const mentionEventBus: MentionEventBus = createMentionEventBus();
