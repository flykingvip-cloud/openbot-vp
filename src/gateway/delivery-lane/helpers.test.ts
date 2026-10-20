/**
 * Tip E: maxLaneHelpers ≤ 2; personal_subagent cannot acceptSeal.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LANE_MAX_HELPERS } from "./helpers.js";
import { attachLaneHelper, countActiveLaneHelpers } from "./helpers.js";
import { canPublishLaneAcceptSeal } from "./publish-gate.js";
import { attachLane, sealLane } from "./service.js";

const TIP = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

describe("Tip E lane helpers cap", () => {
  let laneDir: string;

  beforeEach(() => {
    laneDir = mkdtempSync(path.join(tmpdir(), "dl-helpe-"));
  });

  afterEach(() => {
    rmSync(laneDir, { recursive: true, force: true });
  });

  it("DEFAULT_LANE_MAX_HELPERS is 2", () => {
    expect(DEFAULT_LANE_MAX_HELPERS).toBe(2);
  });

  it("3rd helper attach is REFUSED", async () => {
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      storeDir: laneDir,
    });
    await attachLaneHelper({
      laneId: lane.laneId,
      agentId: "helper-1",
      kind: "helper",
      storeDir: laneDir,
    });
    const second = await attachLaneHelper({
      laneId: lane.laneId,
      agentId: "helper-2",
      kind: "personal_subagent",
      storeDir: laneDir,
    });
    expect(countActiveLaneHelpers(second.lane)).toBe(2);

    await expect(
      attachLaneHelper({
        laneId: lane.laneId,
        agentId: "helper-3",
        storeDir: laneDir,
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/maxLaneHelpers=2|helper cap/i),
    });
  });
});

describe("Tip E personal_subagent acceptSeal ban", () => {
  let laneDir: string;

  beforeEach(() => {
    laneDir = mkdtempSync(path.join(tmpdir(), "dl-psub-"));
  });

  afterEach(() => {
    rmSync(laneDir, { recursive: true, force: true });
  });

  it("gate refuses personal_subagent issuer for accept", () => {
    const d = canPublishLaneAcceptSeal({
      path1CrossBotEnabled: false,
      source: "direct",
      laneOwnerAgentId: "bot-a",
      issuerAgentId: "sub-1",
      issuerKind: "personal_subagent",
    });
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.reason).toBe("personal_subagent_cannot_accept_seal");
  });

  it("sealLane(accept) with personal_subagent issuer is REFUSED", async () => {
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      storeDir: laneDir,
      path1CrossBotEnabled: false,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: TIP,
      issuer: { agentId: "bot-a" },
      storeDir: laneDir,
    });
    await expect(
      sealLane({
        laneId: lane.laneId,
        kind: "accept",
        verdict: "PASS",
        tipSha: TIP,
        issuer: { agentId: "sub-helper", kind: "personal_subagent", mode: "accept" },
        storeDir: laneDir,
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/personal_subagent/i),
    });
  });
});
