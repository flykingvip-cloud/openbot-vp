/**
 * Tip A acceptance tests:
 *  - attach → stage drafting
 *  - refuse merge_ready without seals
 *  - tipSha drift invalidates downstream seals
 *  - path-1 refuses same-origin acceptSeal; single-bot weak accept OK
 *  - feature flag default off
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../supervisor/store.js";
import { DEFAULT_SUPERVISOR_BUDGET, type SupervisedTask } from "../supervisor/types.js";
import { isDeliveryLaneEnabled } from "./feature.js";
import { computeMissingKeys } from "./projection.js";
import {
  attachLane,
  DeliveryLaneError,
  focusLane,
  requestMergeReady,
  sealLane,
} from "./service.js";
import { getLane } from "./store.js";

function makeSupervisedTask(taskId: string): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId,
    goal: "tip-a delivery lane",
    repoRoot: `/repo/${taskId}`,
    worker: { backendId: "kiro-cli" },
    workspace: { id: `ws-${taskId}`, root: `/ws/${taskId}`, kind: "directory" },
    acceptance: {
      steps: [{ id: "test", argv: ["npm", "test"], required: true }],
      source: "template",
    },
    state: "planned",
    iterations: [],
    budget: { ...DEFAULT_SUPERVISOR_BUDGET, spentCostUsd: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

describe("delivery-lane feature gate", () => {
  it("defaults OFF when env/config unset", () => {
    expect(isDeliveryLaneEnabled({}, () => false)).toBe(false);
  });

  it("enables via env", () => {
    expect(isDeliveryLaneEnabled({ OPENBOT_DELIVERY_LANE_ENABLED: "1" }, () => false)).toBe(true);
  });
});

describe("delivery-lane Tip A service", () => {
  let laneDir: string;
  let taskDir: string;

  beforeEach(() => {
    laneDir = mkdtempSync(path.join(tmpdir(), "dl-lane-"));
    taskDir = mkdtempSync(path.join(tmpdir(), "dl-task-"));
  });

  afterEach(() => {
    rmSync(laneDir, { recursive: true, force: true });
    rmSync(taskDir, { recursive: true, force: true });
  });

  it("attach(templateId) yields stage=drafting and projects onto SupervisedTask", async () => {
    await createTask(makeSupervisedTask("t1"), taskDir);
    const { lane, projection } = await attachLane({
      templateId: "default",
      taskId: "t1",
      agentId: "bot-a",
      storeDir: laneDir,
      supervisorStoreDir: taskDir,
    });
    expect(lane.stage).toBe("drafting");
    expect(lane.templateId).toBe("default");
    expect(projection.laneId).toBe(lane.laneId);
    expect(projection.stage).toBe("drafting");
    expect(projection.missingKeys).toEqual(expect.arrayContaining(["implementSeal", "acceptSeal"]));

    const { getTask } = await import("../supervisor/store.js");
    const task = await getTask("t1", taskDir);
    expect(task?.laneId).toBe(lane.laneId);
    expect(task?.laneProjection?.stage).toBe("drafting");
  });

  it("requestMergeReady refuses without seals", async () => {
    const { lane } = await attachLane({
      templateId: "cloud-computer-tip",
      agentId: "bot-a",
      storeDir: laneDir,
    });
    await expect(
      requestMergeReady({ laneId: lane.laneId, storeDir: laneDir }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/missing implementSeal/i),
    });
    expect((await getLane(lane.laneId, laneDir))?.stage).toBe("drafting");
  });

  it("dual seals + match-head unlocks merge_ready (no GH merge)", async () => {
    const tip = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: tip,
      storeDir: laneDir,
      path1CrossBotEnabled: false,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: tip,
      issuer: { agentId: "bot-a", mode: "implement" },
      storeDir: laneDir,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "accept",
      verdict: "REVIEW_PASS",
      tipSha: tip,
      issuer: { agentId: "bot-a", mode: "accept" },
      storeDir: laneDir,
    });
    const sealed = await getLane(lane.laneId, laneDir);
    expect(sealed?.acceptSeal?.strength).toBe("weak");
    expect(computeMissingKeys(sealed!)).toEqual([]);

    const ready = await requestMergeReady({ laneId: lane.laneId, storeDir: laneDir });
    expect(ready.lane.stage).toBe("merge_ready");
    expect(ready.projection.missingKeys).toEqual([]);
  });

  it("merge_ready demotes on tipSha drift (stage + missingKeys + refuse)", async () => {
    const tip1 = "cccccccccccccccccccccccccccccccccccccccc";
    const tip2 = "dddddddddddddddddddddddddddddddddddddddd";
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: tip1,
      storeDir: laneDir,
      path1CrossBotEnabled: false,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: tip1,
      issuer: { agentId: "bot-a" },
      storeDir: laneDir,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "accept",
      verdict: "PASS",
      tipSha: tip1,
      issuer: { agentId: "bot-a", mode: "accept" },
      storeDir: laneDir,
    });
    const ready = await requestMergeReady({ laneId: lane.laneId, storeDir: laneDir });
    expect(ready.lane.stage).toBe("merge_ready");

    // Drift after merge_ready: implement on tip2 must demote stage.
    const drifted = await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: tip2,
      issuer: { agentId: "bot-a" },
      storeDir: laneDir,
    });
    expect(drifted.lane.stage).not.toBe("merge_ready");
    expect(drifted.lane.stage).toBe("implementing");
    expect(drifted.lane.acceptSeal?.invalidatedAt).toBeTruthy();
    expect(computeMissingKeys(drifted.lane)).toContain("acceptSeal");
    expect(drifted.projection.missingKeys).toContain("acceptSeal");

    await expect(
      requestMergeReady({ laneId: lane.laneId, storeDir: laneDir }),
    ).rejects.toMatchObject({ code: "REFUSED" });
  });

  it("tipSha drift invalidates downstream seals and blocks merge_ready", async () => {
    const tip1 = "1111111111111111111111111111111111111111";
    const tip2 = "2222222222222222222222222222222222222222";
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: tip1,
      storeDir: laneDir,
      path1CrossBotEnabled: false,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: tip1,
      issuer: { agentId: "bot-a" },
      storeDir: laneDir,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "accept",
      verdict: "PASS",
      tipSha: tip1,
      issuer: { agentId: "bot-a", mode: "accept" },
      storeDir: laneDir,
    });

    // Drift: new implement seal on tip2 invalidates old seals.
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: tip2,
      issuer: { agentId: "bot-a" },
      storeDir: laneDir,
    });
    const after = await getLane(lane.laneId, laneDir);
    expect(after?.tipSha).toBe(tip2);
    expect(after?.implementSeal?.tipSha).toBe(tip2);
    expect(after?.implementSeal?.invalidatedAt).toBeUndefined();
    // The previous accept was invalidated during tipSha change before new implement written…
    // Actually: invalidateDownstreamSeals clears BOTH including the seal about to be replaced.
    // Then new implement is written. Old accept should be invalidated.
    expect(after?.acceptSeal?.invalidatedAt).toBeTruthy();
    expect(after?.acceptSeal?.invalidateReason).toMatch(/tipSha drift/);

    await expect(
      requestMergeReady({ laneId: lane.laneId, storeDir: laneDir }),
    ).rejects.toBeInstanceOf(DeliveryLaneError);
  });

  it("path-1 enabled refuses same-origin acceptSeal", async () => {
    const tip = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: tip,
      storeDir: laneDir,
      path1CrossBotEnabled: true,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: tip,
      issuer: { agentId: "bot-a" },
      storeDir: laneDir,
    });
    await expect(
      sealLane({
        laneId: lane.laneId,
        kind: "accept",
        verdict: "PASS",
        tipSha: tip,
        issuer: { agentId: "bot-a", mode: "accept" },
        storeDir: laneDir,
      }),
    ).rejects.toMatchObject({ code: "REFUSED" });

    // Distinct bot OK.
    const cross = await sealLane({
      laneId: lane.laneId,
      kind: "accept",
      verdict: "PASS",
      tipSha: tip,
      issuer: { agentId: "bot-reviewer", mode: "accept" },
      storeDir: laneDir,
    });
    expect(cross.lane.acceptSeal?.strength).toBe("strong");
  });

  it("lane.focus returns 交付看板 recall summary (≠对话焦点)", async () => {
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      storeDir: laneDir,
    });
    const focused = await focusLane({ laneId: lane.laneId, storeDir: laneDir });
    expect(focused.summary).toMatch(/交付看板/);
    expect(focused.summary).toMatch(/对话焦点看板/);
    expect(focused.projection.focusSummary).toBe(focused.summary);
  });

  it("unknown templateId is rejected", async () => {
    await expect(attachLane({ templateId: "nope", storeDir: laneDir })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });
});
