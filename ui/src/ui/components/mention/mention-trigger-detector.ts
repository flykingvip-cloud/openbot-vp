/**
 * Mention Trigger Detector.
 *
 * Watches the Message_Input for an active "@" trigger and produces a
 * `MentionTriggerState` the UI layer can consume to open / update the
 * Mention_Popup.
 *
 * This module exports three complementary shapes:
 *   1. Pure helpers (`isValidTriggerPosition`, `findActiveTrigger`) suitable
 *      for unit + property-based testing without any instance state.
 *   2. A stateful `MentionTriggerDetector` class that layers a "dismissed"
 *      flag on top of the pure helpers (Escape, click-outside,
 *      backspace-over-"@").
 *   3. A `createMentionTriggerDetector()` factory so the React layer does not
 *      have to deal with the class keyword directly.
 *
 * No React imports — callers compute the real caret rectangle themselves and
 * merge it with the `caretPosition` placeholder returned here.
 *
 * Validates requirements: 1.1, 1.2, 1.3, 1.4, 1.5.
 */

import type { MentionTriggerState } from "../../../../../src/organization/mention-types.js";

const MENTION_TRIGGER = "@";
const FENCE_MARKER = "```";

/** Clamp an untrusted cursor position to the range `[0, text.length]`. */
function clampCursorPosition(text: string, cursorPosition: number): number {
  if (!Number.isFinite(cursorPosition)) {
    return text.length;
  }
  return Math.max(0, Math.min(text.length, Math.trunc(cursorPosition)));
}

/** Returns true when the character at `offset` is preceded by an odd number
 *  of backslashes (i.e. escaped in Markdown).
 */
function isEscaped(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

/** Returns true when a fenced-code marker (` ``` `) starts at the given
 *  offset and is preceded by at most three spaces on the same line.
 */
function isFenceAtLineStart(text: string, offset: number): boolean {
  if (!text.startsWith(FENCE_MARKER, offset)) {
    return false;
  }
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const prefix = text.slice(lineStart, offset);
  return /^[ \t]{0,3}$/.test(prefix);
}

/**
 * Walks the text up to `offset` tracking fenced-code and inline-code state.
 * Returns `true` if `offset` lies inside either.
 *
 * - Fenced blocks: toggled on every line-leading ` ``` ` marker (up to 3
 *   leading spaces allowed, matching CommonMark behavior).
 * - Inline code: toggled on every unescaped backtick that is not part of a
 *   triple-backtick fence marker.
 */
function isInsideMarkdownCode(text: string, offset: number): boolean {
  let inFence = false;
  let inInlineCode = false;
  let index = 0;
  while (index < offset) {
    if (!inInlineCode && isFenceAtLineStart(text, index)) {
      inFence = !inFence;
      index += FENCE_MARKER.length;
      continue;
    }

    if (!inFence && text[index] === "`" && !isEscaped(text, index)) {
      if (text.startsWith(FENCE_MARKER, index)) {
        index += FENCE_MARKER.length;
        continue;
      }
      inInlineCode = !inInlineCode;
    }

    index += 1;
  }
  return inFence || inInlineCode;
}

/**
 * Pure: returns `true` when the `@` at `offset` is in a position where the
 * mention popup may activate.
 *
 * Rules:
 * - `offset` must reference an actual `@` character inside `text`.
 * - The `@` must not sit inside a fenced code block or an inline code span.
 *
 * The caller controls neighboring-character policy — this helper only
 * guarantees that we never activate inside Markdown code regions, honoring
 * Requirement 1.3.
 */
export function isValidTriggerPosition(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset >= text.length) {
    return false;
  }
  if (text[offset] !== MENTION_TRIGGER) {
    return false;
  }
  return !isInsideMarkdownCode(text, offset);
}

/**
 * Pure: locates the active `@` trigger immediately before `cursorPosition`.
 *
 * Returns `null` when:
 * - no `@` exists before the cursor, OR
 * - the closest candidate `@` lives inside a Markdown code region, OR
 * - whitespace separates the candidate `@` from the cursor (user typed a
 *   space → the mention span is no longer being composed).
 *
 * The `query` is the text between the `@` and the cursor, suitable for
 * feeding into the FuzzyMatcher.
 *
 * This helper is stateless so it can be unit- and property-tested without
 * instantiating the detector.
 */
export function findActiveTrigger(
  text: string,
  cursorPosition: number,
): { offset: number; query: string } | null {
  const cursor = clampCursorPosition(text, cursorPosition);
  let searchOffset = cursor - 1;
  while (searchOffset >= 0) {
    const triggerOffset = text.lastIndexOf(MENTION_TRIGGER, searchOffset);
    if (triggerOffset < 0) {
      return null;
    }

    const query = text.slice(triggerOffset + 1, cursor);
    if (/\s/.test(query)) {
      // Whitespace in the span — keep looking further back; the user may
      // have typed `@foo @bar|` and the real active trigger is the second @.
      searchOffset = triggerOffset - 1;
      continue;
    }

    if (!isValidTriggerPosition(text, triggerOffset)) {
      // Candidate sits inside a code region; keep looking back.
      searchOffset = triggerOffset - 1;
      continue;
    }

    return { offset: triggerOffset, query };
  }
  return null;
}

/**
 * Stateful mention trigger detector.
 *
 * Layers a "dismissed" flag on top of the pure `findActiveTrigger`:
 * - Dismissal happens on Escape, click-outside, or backspace-over-"@".
 * - A dismissed trigger stays dismissed until either the user deletes the
 *   `@` character (the anchor no longer exists), or a *different* `@` becomes
 *   the active candidate (the user typed a new mention further along in the
 *   text).
 */
export class MentionTriggerDetector {
  private activeTriggerOffset: number | null = null;
  private dismissedTriggerOffset: number | null = null;

  /**
   * Compute the trigger state for the current `text` / `cursorPosition`.
   * Returns `null` when no trigger is active (or the current trigger has
   * been dismissed).
   *
   * The returned `caretPosition` is always `{ top: 0, left: 0 }` — the React
   * layer is responsible for measuring the caret rect in DOM space.
   */
  onInputChange(text: string, cursorPosition: number): MentionTriggerState | null {
    const active = findActiveTrigger(text, cursorPosition);

    if (active === null) {
      this.activeTriggerOffset = null;
      // If the dismissed anchor no longer points at an `@`, forget the
      // dismissal so a brand-new trigger at the same offset can activate.
      if (
        this.dismissedTriggerOffset !== null &&
        text[this.dismissedTriggerOffset] !== MENTION_TRIGGER
      ) {
        this.dismissedTriggerOffset = null;
      }
      return null;
    }

    if (this.dismissedTriggerOffset === active.offset) {
      this.activeTriggerOffset = null;
      return null;
    }

    this.activeTriggerOffset = active.offset;
    return {
      active: true,
      query: active.query,
      caretPosition: { top: 0, left: 0 },
      triggerOffset: active.offset,
    };
  }

  /**
   * Returns `true` when the `@` at `offset` is in a valid trigger position.
   * Thin instance-level wrapper around the pure `isValidTriggerPosition`
   * helper — provided so callers that only hold the detector instance have
   * everything they need.
   */
  isValidTriggerPosition(text: string, offset: number): boolean {
    return isValidTriggerPosition(text, offset);
  }

  /**
   * Dismiss the currently active trigger. Used for:
   * - Escape key press
   * - Click outside the popup
   * - Backspace over the `@` (the React layer still calls this so the
   *   detector forgets the anchor cleanly even if the `@` is re-typed).
   *
   * Safe to call when nothing is active — it's a no-op in that case.
   */
  dismiss(): void {
    this.dismissedTriggerOffset = this.activeTriggerOffset;
    this.activeTriggerOffset = null;
  }
}

/** Factory: build a fresh stateful detector instance. */
export function createMentionTriggerDetector(): MentionTriggerDetector {
  return new MentionTriggerDetector();
}
