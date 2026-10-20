import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { occupancyForRoundState, type PersistedRound } from "./round-state.js";
import type { RoundEventType, RoundTransitionEvent } from "./round-state.js";
import { roundTxnPath, writeJsonDurable } from "./round-store-io.js";
import {
  acceptRoundDispatch,
  applyRoundTransition,
  createPersistedRound,
  readPersistedRound,
  RoundCasConflictError,
  writePersistedRound,
} from "./round-store.js";

function baseRound(roundId = "round-1"): PersistedRound {
  return createPersistedRound({
    roundId,
    groupId: "alpha",
    sessionKey: "space:alpha",
    userMessageId: "msg-1",
    collaborationMode: "lead_plus_supplement",
    policyVersion: "1.0",
    policyHash: "abc",
    policySnapshot: {},
    state: "ROUND_CREATED",
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
    primaryCursor: 0,
  });
}

async function step(
  round: PersistedRound,
  event: RoundTransitionEvent,
  eventType: RoundEventType,
  roundsDir: string,
  eventId?: string,
) {
  return await applyRoundTransition({
    round,
    event,
    eventType,
    eventId,
    roundsDir,
  });
}

describe("round store", () => {
  test("CAS persist, event idempotency, and dispatch idempotency", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-"));
    const round = baseRound();
    expect(occupancyForRoundState(round.state)).toBe("none");

    const first = await applyRoundTransition({
      round,
      event: "message_received",
      eventType: "ROUND_CREATED",
      eventId: "evt-1",
      roundsDir,
    });
    expect(first.skipped).toBe(false);
    expect(first.round.state).toBe("CLASSIFYING");
    expect(first.round.stateVersion).toBe(1);

    const replay = await applyRoundTransition({
      round: first.round,
      event: "message_received",
      eventType: "ROUND_CREATED",
      eventId: "evt-1",
      roundsDir,
    });
    expect(replay.skipped).toBe(true);
    expect(replay.round.stateVersion).toBe(1);

    const accepted = acceptRoundDispatch({
      round: first.round,
      dispatchId: "d-1",
      agentId: "bot-a",
      role: "primary",
    });
    expect(accepted.accepted).toBe(true);
    const duplicate = acceptRoundDispatch({
      round: accepted.round,
      dispatchId: "d-1",
      agentId: "bot-a",
      role: "primary",
    });
    expect(duplicate.accepted).toBe(false);

    const loaded = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-1",
      roundsDir,
    });
    expect(loaded?.state).toBe("CLASSIFYING");
  });

  test("concurrent transitions on the same version: one commits, the other CAS-fails", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-cas-"));
    const round = baseRound("round-cas");
    await writePersistedRound({ round, roundsDir });
    const results = await Promise.allSettled([
      applyRoundTransition({
        round,
        event: "message_received",
        eventType: "ROUND_CREATED",
        eventId: "evt-a",
        roundsDir,
      }),
      applyRoundTransition({
        round,
        event: "message_received",
        eventType: "ROUND_CREATED",
        eventId: "evt-b",
        roundsDir,
      }),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status === "rejected" && rejected[0].reason).toBeInstanceOf(
      RoundCasConflictError,
    );
    const loaded = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-cas",
      roundsDir,
    });
    expect(loaded?.stateVersion).toBe(1);
    const events = await fs.readFile(path.join(roundsDir, "round-cas.events.jsonl"), "utf8");
    expect(events.trim().split("\n")).toHaveLength(1);
  });

  test("eventId remains rejected after the snapshot seen-set is wiped", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-idemp-"));
    const first = await applyRoundTransition({
      round: baseRound("round-idemp"),
      event: "message_received",
      eventType: "ROUND_CREATED",
      eventId: "evt-permanent",
      roundsDir,
    });
    await writeJsonDurable(path.join(roundsDir, "round-idemp.json"), {
      ...first.round,
      seenEventIds: [],
    });
    const replay = await applyRoundTransition({
      round: { ...first.round, seenEventIds: [] },
      event: "message_received",
      eventType: "ROUND_CREATED",
      eventId: "evt-permanent",
      roundsDir,
    });
    expect(replay.skipped).toBe(true);
    expect(replay.round.stateVersion).toBe(1);
  });

  test("persist failure does not invent a newer in-memory state", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-fail-"));
    const first = await applyRoundTransition({
      round: baseRound("round-fail"),
      event: "message_received",
      eventType: "ROUND_CREATED",
      eventId: "evt-1",
      roundsDir,
    });
    await fs.chmod(roundsDir, 0o555);
    try {
      await expect(
        applyRoundTransition({
          round: first.round,
          event: "classified",
          eventType: "CLASSIFIED",
          eventId: "evt-2",
          roundsDir,
        }),
      ).rejects.toThrow();
    } finally {
      await fs.chmod(roundsDir, 0o755);
    }
    const loaded = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-fail",
      roundsDir,
    });
    expect(loaded?.state).toBe("CLASSIFYING");
    expect(loaded?.stateVersion).toBe(1);
  });

  test("pending txn recovers so snapshot and event log stay together", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-txn-"));
    const created = baseRound("round-txn");
    const snapshot = {
      ...created,
      state: "CLASSIFYING" as const,
      stateVersion: 1,
      lastEventSeq: 1,
      lastEventId: "evt-txn",
      seenEventIds: ["evt-txn"],
      occupancy: occupancyForRoundState("CLASSIFYING"),
    };
    await writeJsonDurable(roundTxnPath(roundsDir, "round-txn"), {
      snapshot,
      event: {
        eventId: "evt-txn",
        roundId: "round-txn",
        sequence: 1,
        timestamp: Date.now(),
        type: "ROUND_CREATED",
        previousState: "ROUND_CREATED",
        nextState: "CLASSIFYING",
      },
    });
    const loaded = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-txn",
      roundsDir,
    });
    expect(loaded?.state).toBe("CLASSIFYING");
    expect(loaded?.stateVersion).toBe(1);
    const events = await fs.readFile(path.join(roundsDir, "round-txn.events.jsonl"), "utf8");
    expect(events).toContain("evt-txn");
  });

  test("CANDIDATE_DROPPED advances lastEventSeq and stateVersion without leaving the window", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-drop-"));
    let current = baseRound("round-drop");
    const walk: Array<[RoundTransitionEvent, RoundEventType]> = [
      ["message_received", "ROUND_CREATED"],
      ["classified", "CLASSIFIED"],
      ["queue_ready", "PRIMARY_QUEUE_ENTERED"],
      ["cursor_ready", "PRIMARY_STARTED"],
      ["primary_started", "PRIMARY_STARTED"],
      ["completed", "PRIMARY_COMPLETED"],
      ["queue_exhausted_supplement", "SUPPLEMENT_WINDOW_OPENED"],
    ];
    for (const [event, eventType] of walk) {
      const applied = await step(current, event, eventType, roundsDir);
      current = applied.round;
    }
    const before = current.stateVersion;
    const dropped = await applyRoundTransition({
      round: current,
      event: "candidate_dropped",
      eventType: "CANDIDATE_DROPPED",
      eventId: "evt-drop",
      agentId: "bot-c",
      payload: { reason: "not_relevant" },
      roundsDir,
    });
    expect(dropped.round.state).toBe("SUPPLEMENT_WINDOW");
    expect(dropped.round.stateVersion).toBe(before + 1);
    expect(dropped.round.lastEventSeq).toBe(dropped.round.stateVersion);
    expect(dropped.round.seenEventIds).toContain("evt-drop");
    const loaded = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-drop",
      roundsDir,
    });
    expect(loaded?.lastEventSeq).toBe(dropped.round.lastEventSeq);
    const events = await fs.readFile(path.join(roundsDir, "round-drop.events.jsonl"), "utf8");
    expect(events).toContain("CANDIDATE_DROPPED");
  });
});
