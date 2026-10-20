import { describe, expect, test } from "vitest";
import {
  canTransitionEpisodeState,
  EpisodeTransitionError,
  LEGACY_ONE_BEAT_HAPPY_PATH,
  transitionEpisodeState,
  walkLegacyOneBeatPath,
} from "./episode-state-machine.js";
import type { EpisodeState, EpisodeTransitionEvent } from "./episode-state.js";
import { isEpisodeTerminal } from "./episode-state.js";

describe("episode state machine", () => {
  test("legacy 1-beat happy path reaches EPISODE_CLOSED", () => {
    expect(walkLegacyOneBeatPath()).toBe("EPISODE_CLOSED");
    expect(LEGACY_ONE_BEAT_HAPPY_PATH).toHaveLength(10);
  });

  test("legacy path from POLICY_SNAPSHOTTED (post-E0) still closes", () => {
    let state: EpisodeState = "POLICY_SNAPSHOTTED";
    for (const event of LEGACY_ONE_BEAT_HAPPY_PATH.slice(1)) {
      state = transitionEpisodeState(state, event);
    }
    expect(state).toBe("EPISODE_CLOSED");
  });

  test("rejects illegal transitions", () => {
    expect(() => transitionEpisodeState("EPISODE_CREATED", "admitted")).toThrow(
      EpisodeTransitionError,
    );
    expect(() => transitionEpisodeState("EPISODE_CLOSED", "recover")).toThrow(
      EpisodeTransitionError,
    );
    expect(() => transitionEpisodeState("ABORTED_ON_RESTART", "abort")).toThrow(
      EpisodeTransitionError,
    );
    expect(() => transitionEpisodeState("COMMIT", "admitted")).toThrow(EpisodeTransitionError);
  });

  test("E-R recover marks any non-terminal → ABORTED_ON_RESTART", () => {
    const nonTerminal: EpisodeState[] = [
      "EPISODE_CREATED",
      "POLICY_SNAPSHOTTED",
      "CONTEXT_RESOLVE",
      "INTENT_CLASSIFIED",
      "WAITING_USER",
      "PARTICIPANT_ELIGIBILITY",
      "BID_ADMISSION",
      "BEAT_ACTIVE",
      "FACILITATOR_OBSERVE",
      "GOVERNANCE_GATE",
      "WAIT_HUMAN",
      "COMMIT",
    ];
    for (const state of nonTerminal) {
      expect(transitionEpisodeState(state, "recover")).toBe("ABORTED_ON_RESTART");
      expect(canTransitionEpisodeState(state, "recover")).toBe(true);
    }
  });

  test("E* abort / E** fuse close any non-terminal", () => {
    expect(transitionEpisodeState("BEAT_ACTIVE", "abort")).toBe("EPISODE_CLOSED");
    expect(transitionEpisodeState("BID_ADMISSION", "fuse")).toBe("EPISODE_CLOSED");
  });

  test("terminal states accept no transitions", () => {
    const events: EpisodeTransitionEvent[] = [
      "snapshot_bound",
      "recover",
      "abort",
      "fuse",
      "committed",
    ];
    for (const state of ["EPISODE_CLOSED", "ABORTED_ON_RESTART"] as const) {
      expect(isEpisodeTerminal(state)).toBe(true);
      for (const event of events) {
        expect(canTransitionEpisodeState(state, event)).toBe(false);
      }
    }
  });

  test("close-reason branches: waiting_user / no_eligible / silent", () => {
    expect(transitionEpisodeState("WAITING_USER", "notice_sent")).toBe("EPISODE_CLOSED");
    expect(transitionEpisodeState("PARTICIPANT_ELIGIBILITY", "none_eligible")).toBe(
      "EPISODE_CLOSED",
    );
    expect(transitionEpisodeState("BID_ADMISSION", "nobody")).toBe("EPISODE_CLOSED");
  });
});
