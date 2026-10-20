/**
 * Tip C acceptance tests:
 *  - forged / missing seal / head drift → refuse; MergePort not invoked
 *  - valid dual seals + match-head → MergePort invoked once; stage=merged
 *  - merge mode denies raw gh pr merge argv; allows lane.requestMerge
 *  - feature flag default still OFF
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDeliveryLaneEnabled } from "./feature.js";
import { createRecordingMergePort } from "./merge-port.js";
import { requestMerge } from "./merge-request.js";
import { evaluateLaneModeToolPolicy } from "./mode-policy.js";
import { attachLane, requestMergeReady, sealLane } from "./service.js";
import { getLane, updateLane } from "./store.js";

const TIP = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TIP2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function readyLane(opts: {
  storeDir: string;
  tipSha?: string;
  prNumber?: number;
  agentId?: string;
}) {
  const tipSha = opts.tipSha ?? TIP;
  const { lane } = await attachLane({
    templateId: "default",
    agentId: opts.agentId ?? "bot-a",
    tipSha,
    headSha: tipSha,
    prNumber: opts.prNumber ?? 444,
    storeDir: opts.storeDir,
    path1CrossBotEnabled: false,
  });
  await sealLane({
    laneId: lane.laneId,
    kind: "implement",
    verdict: "PASS",
    tipSha,
    issuer: { agentId: "bot-a", mode: "implement" },
    storeDir: opts.storeDir,
  });
  await sealLane({
    laneId: lane.laneId,
    kind: "accept",
    verdict: "REVIEW_PASS",
    tipSha,
    issuer: { agentId: "bot-a", mode: "accept" },
    storeDir: opts.storeDir,
  });
  await requestMergeReady({ laneId: lane.laneId, storeDir: opts.storeDir });
  return lane.laneId;
}

describe("Tip C MergePort / requestMerge", () => {
  let laneDir: string;

  beforeEach(() => {
    laneDir = mkdtempSync(path.join(tmpdir(), "dl-merge-"));
  });

  afterEach(() => {
    rmSync(laneDir, { recursive: true, force: true });
  });

  it("feature flag still defaults OFF", () => {
    expect(isDeliveryLaneEnabled({}, () => false)).toBe(false);
  });

  it("missing seals → refuse; MergePort never called", async () => {
    const port = createRecordingMergePort();
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      prNumber: 1,
      storeDir: laneDir,
    });
    await expect(
      requestMerge({ laneId: lane.laneId, storeDir: laneDir, mergePort: port }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/missing implementSeal/i),
    });
    expect(port.calls).toHaveLength(0);
  });

  it("forged accept seal (FAIL verdict) → refuse; port not called", async () => {
    const port = createRecordingMergePort();
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      headSha: TIP,
      prNumber: 7,
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
    await sealLane({
      laneId: lane.laneId,
      kind: "accept",
      verdict: "FAIL",
      tipSha: TIP,
      issuer: { agentId: "bot-a", mode: "accept" },
      storeDir: laneDir,
    });
    // Force seals present with failing accept into merge_ready-like shape via store
    // (requestMergeReady would refuse FAIL). Simulate forged store write.
    await updateLane(
      lane.laneId,
      (l) => ({
        ...l,
        stage: "merge_ready",
        mode: "merge",
        acceptSeal: l.acceptSeal
          ? { ...l.acceptSeal, verdict: "FAIL", invalidatedAt: undefined }
          : l.acceptSeal,
      }),
      laneDir,
    );
    await expect(
      requestMerge({ laneId: lane.laneId, storeDir: laneDir, mergePort: port }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/PASS|verdict/i),
    });
    expect(port.calls).toHaveLength(0);
  });

  it("invalidated acceptSeal → refuse; port not called", async () => {
    const port = createRecordingMergePort();
    const laneId = await readyLane({ storeDir: laneDir });
    await updateLane(
      laneId,
      (l) => ({
        ...l,
        acceptSeal: l.acceptSeal
          ? {
              ...l.acceptSeal,
              invalidatedAt: new Date().toISOString(),
              invalidateReason: "forged-test",
            }
          : undefined,
      }),
      laneDir,
    );
    await expect(
      requestMerge({ laneId, storeDir: laneDir, mergePort: port }),
    ).rejects.toMatchObject({ code: "REFUSED" });
    expect(port.calls).toHaveLength(0);
  });

  it("observedHeadSha drift → refuse; port not called", async () => {
    const port = createRecordingMergePort();
    const laneId = await readyLane({ storeDir: laneDir });
    await expect(
      requestMerge({
        laneId,
        storeDir: laneDir,
        mergePort: port,
        observedHeadSha: TIP2,
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/tipSha drift/i),
    });
    expect(port.calls).toHaveLength(0);
    expect((await getLane(laneId, laneDir))?.stage).toBe("merge_ready");
  });

  it("headSha mismatch vs tip (match-head missing) → refuse", async () => {
    const port = createRecordingMergePort();
    const laneId = await readyLane({ storeDir: laneDir });
    await updateLane(laneId, (l) => ({ ...l, headSha: TIP2 }), laneDir);
    await expect(
      requestMerge({ laneId, storeDir: laneDir, mergePort: port }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/match-head/i),
    });
    expect(port.calls).toHaveLength(0);
  });

  it("dual seals + match-head → MergePort invoked once; stage=merged", async () => {
    const port = createRecordingMergePort();
    const laneId = await readyLane({ storeDir: laneDir, prNumber: 451 });
    const result = await requestMerge({
      laneId,
      storeDir: laneDir,
      mergePort: port,
      method: "squash",
      observedHeadSha: TIP,
    });
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]).toMatchObject({
      prNumber: 451,
      tipSha: TIP,
      method: "squash",
    });
    expect(result.mergeResult.ok).toBe(true);
    expect(result.lane.stage).toBe("merged");
    expect(result.lane.lastMerge?.prNumber).toBe(451);
    expect(result.lane.lastMerge?.tipSha).toBe(TIP);
    expect(result.projection.stage).toBe("merged");
  });

  it("MergePort failure surfaces as REFUSED; stage stays merge_ready", async () => {
    const port = createRecordingMergePort({ failWith: "gh exploded" });
    const laneId = await readyLane({ storeDir: laneDir });
    await expect(
      requestMerge({ laneId, storeDir: laneDir, mergePort: port }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/gh exploded/),
    });
    expect(port.calls).toHaveLength(1);
    expect((await getLane(laneId, laneDir))?.stage).toBe("merge_ready");
  });

  it("missing prNumber → refuse before port", async () => {
    const port = createRecordingMergePort();
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      headSha: TIP,
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
    await sealLane({
      laneId: lane.laneId,
      kind: "accept",
      verdict: "PASS",
      tipSha: TIP,
      issuer: { agentId: "bot-a", mode: "accept" },
      storeDir: laneDir,
    });
    await requestMergeReady({ laneId: lane.laneId, storeDir: laneDir });
    await expect(
      requestMerge({ laneId: lane.laneId, storeDir: laneDir, mergePort: port }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/prNumber/i),
    });
    expect(port.calls).toHaveLength(0);
  });
});

describe("Tip C merge-mode tool policy", () => {
  it("merge mode denies raw gh pr merge via exec", () => {
    const d = evaluateLaneModeToolPolicy({
      mode: "merge",
      toolName: "exec",
      argv: ["gh", "pr", "merge", "1", "--squash"],
      deliveryLaneEnabled: true,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/requestMerge|raw_merge/i);
  });

  it("merge mode allows lane.requestMerge and merge-port channel", () => {
    expect(
      evaluateLaneModeToolPolicy({
        mode: "merge",
        toolName: "lane.requestMerge",
        channel: "lane-api",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateLaneModeToolPolicy({
        mode: "merge",
        toolName: "exec",
        argv: ["gh", "pr", "merge", "1"],
        channel: "merge-port",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(true);
  });

  it("flag off → merge argv allowed (zero behavior)", () => {
    expect(
      evaluateLaneModeToolPolicy({
        mode: "merge",
        toolName: "exec",
        argv: ["gh", "pr", "merge", "1"],
        deliveryLaneEnabled: false,
      }).allowed,
    ).toBe(true);
  });
});
