import { describe, expect, test } from "vitest";
import { occupancyAfterTransition, transitionRoundState } from "./round-state-machine.js";

describe("round state machine", () => {
  test("walks single-primary happy path", () => {
    let state = transitionRoundState("ROUND_CREATED", "message_received");
    state = transitionRoundState(state, "classified");
    state = transitionRoundState(state, "queue_ready");
    state = transitionRoundState(state, "cursor_ready");
    state = transitionRoundState(state, "primary_started");
    expect(occupancyAfterTransition("WAITING_PRIMARY", "primary_started")).toBe("executing");
    state = transitionRoundState(state, "completed");
    state = transitionRoundState(state, "queue_exhausted_no_supplement");
    state = transitionRoundState(state, "close_not_required");
    expect(state).toBe("ROUND_COMPLETE");
  });

  test("explicit_multi re-enters PRIMARY_QUEUE after each completion", () => {
    let state = transitionRoundState("PRIMARY_COMPLETED", "queue_has_next");
    expect(state).toBe("PRIMARY_QUEUE");
    state = transitionRoundState(state, "cursor_ready");
    expect(state).toBe("WAITING_PRIMARY");
  });

  test("MENTION_UNMATCHED stays non-executing and aborts on TTL", () => {
    const unmatched = transitionRoundState("CLASSIFYING", "mention_unmatched");
    expect(unmatched).toBe("MENTION_UNMATCHED");
    expect(occupancyAfterTransition("CLASSIFYING", "mention_unmatched")).toBe("none");
    expect(transitionRoundState(unmatched, "unmatched_expired")).toBe("ROUND_ABORTED");
  });

  test("rejects illegal transitions", () => {
    expect(() => transitionRoundState("WAITING_PRIMARY", "candidate_found")).toThrow(
      /illegal round transition/,
    );
  });

  test("CANDIDATE_DROPPED stays in the supplement state and remains a legal transition", () => {
    expect(transitionRoundState("SUPPLEMENT_WINDOW", "candidate_dropped")).toBe(
      "SUPPLEMENT_WINDOW",
    );
    expect(transitionRoundState("SUPPLEMENTING", "candidate_dropped")).toBe("SUPPLEMENTING");
  });

  test("MENTION_CONFIRM asks without a TTL abort", () => {
    const confirming = transitionRoundState("CLASSIFYING", "mention_confirm");
    expect(confirming).toBe("MENTION_CONFIRM");
    expect(occupancyAfterTransition("CLASSIFYING", "mention_confirm")).toBe("none");
    expect(() => transitionRoundState(confirming, "unmatched_expired")).toThrow(
      /illegal round transition/,
    );
  });
});
