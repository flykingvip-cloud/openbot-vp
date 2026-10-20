import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRoundPolicySnapshot,
  persistPolicySnapshotBody,
  replayFrozenPolicyFromKey,
} from "./round-policy-snapshot.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("replay-by-snapshot (P0.0b)", () => {
  it("given policySnapshotId + policyHash, restores a frozen policy with the original hash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "p00b-replay-"));
    tempDirs.push(root);
    vi.stubEnv("OPENBOT_HOME", root);
    vi.stubEnv("OPENBOT_STATE_DIR", root);

    const snap = createRoundPolicySnapshot(
      { maxVisibleBotRepliesPerRound: 7, mentionBotMustRespond: true },
      { now: 42, idGen: () => "pss_replay_1" },
    );
    const first = await persistPolicySnapshotBody({
      snapshot: snap,
      groupId: "g-replay",
      tenantId: null,
    });
    expect(first.written).toBe(true);
    const second = await persistPolicySnapshotBody({
      snapshot: snap,
      groupId: "g-replay",
      tenantId: null,
    });
    expect(second.written).toBe(false); // content-addressed: same hash writes once

    const replayed = await replayFrozenPolicyFromKey({
      policySnapshotId: snap.policySnapshotId,
      policyHash: snap.policyHash,
      groupId: "g-replay",
      tenantId: null,
    });
    expect(replayed).not.toBeNull();
    expect(replayed!.policyHash).toBe(snap.policyHash);
    expect(replayed!.policySnapshotId).toBe("pss_replay_1");
    expect(replayed!.effective.participation.maxVisibleBotRepliesPerRound).toBe(7);
    expect(Object.isFrozen(replayed!.effective)).toBe(true);
    expect(() => {
      (
        replayed!.effective.participation as { mentionBotMustRespond: boolean }
      ).mentionBotMustRespond = false;
    }).toThrow(TypeError);
  });
});
