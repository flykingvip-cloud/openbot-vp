/**
 * Tip F (P2) acceptance:
 *  - tip/PR events advance board stage (no regress)
 *  - templates expose must-green / hosted-CI-blocked policy
 *  - shadow observe never invokes; ORCHESTRATION_LIVE_INVOKE stays false
 *  - feature flag default still off (covered elsewhere)
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORCHESTRATION_LIVE_INVOKE } from "../../task-orchestration/types.js";
import { applyLaneEvent, canAdvanceStage, suggestStageForLaneEvent } from "./events.js";
import { observeLaneEventShadow } from "./lane-shadow.js";
import { attachLane } from "./service.js";
import { getDeliveryLaneTemplate, listDeliveryLaneTemplates } from "./templates.js";

describe("delivery-lane Tip F events", () => {
  let storeDir: string;

  beforeEach(() => {
    storeDir = mkdtempSync(path.join(tmpdir(), "dl-tip-f-"));
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it("suggests stages for tip/PR event kinds", () => {
    expect(suggestStageForLaneEvent("tip.pushed")).toBe("implementing");
    expect(suggestStageForLaneEvent("pr.opened")).toBe("reviewing");
    expect(suggestStageForLaneEvent("pr.approved")).toBe("accepting");
    expect(suggestStageForLaneEvent("pr.merged")).toBe("merged");
  });

  it("refuses stage regress", () => {
    expect(canAdvanceStage("reviewing", "implementing")).toBe(false);
    expect(canAdvanceStage("reviewing", "accepting")).toBe(true);
    expect(canAdvanceStage("blocked", "implementing")).toBe(false);
  });

  it("applyLaneEvent advances drafting → implementing → reviewing", async () => {
    const { lane } = await attachLane({
      templateId: "cloud-computer-experience",
      agentId: "bot-f",
      storeDir,
    });
    expect(lane.stage).toBe("drafting");

    const pushed = await applyLaneEvent({
      event: {
        kind: "tip.pushed",
        laneId: lane.laneId,
        tipSha: "abc111",
        source: "webhook",
      },
      storeDir,
    });
    expect(pushed.advanced).toBe(true);
    expect(pushed.lane.stage).toBe("implementing");
    expect(pushed.lane.tipSha).toBe("abc111");
    expect(pushed.lane.lastEvent?.kind).toBe("tip.pushed");
    expect(pushed.shadow.invoke).toBe(false);
    expect(pushed.shadow.enqueue).toBe(false);

    const opened = await applyLaneEvent({
      event: {
        kind: "pr.opened",
        laneId: lane.laneId,
        prNumber: 501,
        headSha: "abc222",
        source: "webhook",
      },
      storeDir,
    });
    expect(opened.lane.stage).toBe("reviewing");
    expect(opened.lane.prNumber).toBe(501);
    expect(opened.lane.headSha).toBe("abc222");

    // Same-stage event does not regress or falsely advance past
    const again = await applyLaneEvent({
      event: { kind: "pr.review_requested", laneId: lane.laneId, source: "internal" },
      storeDir,
    });
    expect(again.lane.stage).toBe("reviewing");
    expect(again.advanced).toBe(false);
  });

  it("does not regress reviewing → tip.pushed", async () => {
    const { lane } = await attachLane({
      templateId: "collab-dual-gate",
      agentId: "bot-f2",
      storeDir,
    });
    await applyLaneEvent({
      event: { kind: "pr.opened", laneId: lane.laneId, prNumber: 9 },
      storeDir,
    });
    const back = await applyLaneEvent({
      event: { kind: "tip.pushed", laneId: lane.laneId, tipSha: "deadbeef" },
      storeDir,
    });
    expect(back.lane.stage).toBe("reviewing");
    expect(back.advanced).toBe(false);
    expect(back.lane.tipSha).toBe("deadbeef");
  });
});

describe("delivery-lane Tip F templates + shadow", () => {
  it("lists 云电脑体验轨 + 协作双门禁 with must-green policy", () => {
    const ids = listDeliveryLaneTemplates().map((t) => t.id);
    expect(ids).toContain("cloud-computer-experience");
    expect(ids).toContain("collab-dual-gate");

    const cloud = getDeliveryLaneTemplate("cloud-computer-experience");
    expect(cloud?.label).toBe("云电脑体验轨");
    expect(cloud?.ciPolicy?.hostedCiBillingBlocked).toBe(true);
    expect(cloud?.ciPolicy?.mustGreenLocally).toBe(true);
    expect(cloud?.ciPolicy?.strategy).toMatch(/must-green|本机/);

    const collab = getDeliveryLaneTemplate("collab-dual-gate");
    expect(collab?.label).toBe("协作双门禁");
    expect(collab?.ciPolicy?.mustGreenLocally).toBe(true);
    expect(collab?.gates).toEqual(
      expect.arrayContaining(["implementSeal", "acceptSeal", "match-head"]),
    );
  });

  it("shadow observe is invoke:false and orch live invoke stays frozen", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    const obs = observeLaneEventShadow({ kind: "pr.opened", laneId: "lane-x" });
    expect(obs.observed).toBe(true);
    expect(obs.invoke).toBe(false);
    expect(obs.enqueue).toBe(false);
    expect(obs.liveInvokeFrozen).toBe(true);
    expect(obs.orchestrationLiveInvoke).toBe(false);
  });
});
