/**
 * Tip D: cross-bot acceptSeal + handoff bridge.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertPath1DualSealAuthority,
  canPublishLaneAcceptSeal,
  mapHandoffKindToLaneSealKind,
  sealLaneFromHandoff,
} from "./handoff-bridge.js";
import { createRecordingMergePort } from "./merge-port.js";
import { requestMerge } from "./merge-request.js";
import { computeMissingKeys } from "./projection.js";
import { attachLane, requestMergeReady, sealLane } from "./service.js";
import { getLane, updateLane } from "./store.js";

const TIP = "cccccccccccccccccccccccccccccccccccccccc";

describe("Tip D publish gate", () => {
  it("maps evidence→accept and review→accept", () => {
    expect(mapHandoffKindToLaneSealKind("evidence")).toBe("accept");
    expect(mapHandoffKindToLaneSealKind("review", "reviewer")).toBe("accept");
    expect(mapHandoffKindToLaneSealKind("continue")).toBeNull();
  });

  it("handoff bridge requires path1", () => {
    const d = canPublishLaneAcceptSeal({
      path1CrossBotEnabled: false,
      source: "handoff",
      laneOwnerAgentId: "bot-a",
      issuerAgentId: "bot-b",
      handoff: {
        kind: "evidence",
        status: "approved",
        fromAgentId: "bot-a",
        toAgentId: "bot-b",
      },
    });
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.reason).toBe("path1_required_for_handoff_bridge");
  });

  it("refuses proposed handoff status", () => {
    const d = canPublishLaneAcceptSeal({
      path1CrossBotEnabled: true,
      source: "handoff",
      laneOwnerAgentId: "bot-a",
      issuerAgentId: "bot-b",
      handoff: {
        kind: "review",
        status: "proposed",
        fromAgentId: "bot-a",
        toAgentId: "bot-b",
        toRole: "reviewer",
      },
    });
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.reason).toBe("handoff_status_not_ready");
  });

  it("refuses same-origin and self-sign under path1", () => {
    expect(
      canPublishLaneAcceptSeal({
        path1CrossBotEnabled: true,
        source: "direct",
        laneOwnerAgentId: "bot-a",
        issuerAgentId: "bot-a",
      }).allowed,
    ).toBe(false);
    expect(
      canPublishLaneAcceptSeal({
        path1CrossBotEnabled: true,
        source: "direct",
        laneOwnerAgentId: "bot-a",
        issuerAgentId: "bot-impl",
        implementIssuerAgentId: "bot-impl",
      }).allowed,
    ).toBe(false);
  });
});

describe("Tip D sealLaneFromHandoff + merge path", () => {
  let laneDir: string;

  beforeEach(() => {
    laneDir = mkdtempSync(path.join(tmpdir(), "dl-tipd-"));
  });

  afterEach(() => {
    rmSync(laneDir, { recursive: true, force: true });
  });

  it("path1 same-origin includes issuer.botId===lane.agentId (Tip A)", () => {
    const d = canPublishLaneAcceptSeal({
      path1CrossBotEnabled: true,
      source: "direct",
      laneOwnerAgentId: "bot-a",
      issuerAgentId: "external-agent",
      issuerBotId: "bot-a",
    });
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.reason).toBe("path1_same_origin_refused");
  });

  it("path1 self-sign via botId overlap with implement issuer", () => {
    const d = canPublishLaneAcceptSeal({
      path1CrossBotEnabled: true,
      source: "direct",
      laneOwnerAgentId: "bot-a",
      issuerAgentId: "accept-ext",
      issuerBotId: "worker-bot",
      implementIssuerAgentId: "impl-agent",
      implementIssuerBotId: "worker-bot",
    });
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.reason).toBe("path1_self_sign_refused");
  });

  it("path1: same-origin accept refused; self-sign (implement issuer) refused", async () => {
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      storeDir: laneDir,
      path1CrossBotEnabled: true,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: TIP,
      issuer: { agentId: "bot-worker" },
      storeDir: laneDir,
    });
    await expect(
      sealLane({
        laneId: lane.laneId,
        kind: "accept",
        verdict: "PASS",
        tipSha: TIP,
        issuer: { agentId: "bot-a" },
        storeDir: laneDir,
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/same_origin|path-1/i),
    });

    await expect(
      sealLane({
        laneId: lane.laneId,
        kind: "accept",
        verdict: "PASS",
        tipSha: TIP,
        issuer: { agentId: "bot-worker" },
        storeDir: laneDir,
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/self_sign/i),
    });
  });

  it("path1: botId===owner same-origin refuse on accept seal", async () => {
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      storeDir: laneDir,
      path1CrossBotEnabled: true,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: TIP,
      issuer: { agentId: "bot-worker" },
      storeDir: laneDir,
    });
    await expect(
      sealLane({
        laneId: lane.laneId,
        kind: "accept",
        verdict: "PASS",
        tipSha: TIP,
        issuer: { agentId: "looks-external", botId: "bot-a", mode: "accept" },
        storeDir: laneDir,
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/same_origin/i),
    });
  });

  it("path1: accept→implement same issuer refused at write; forged pair blocked at merge", async () => {
    const port = createRecordingMergePort();
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      headSha: TIP,
      prNumber: 456,
      storeDir: laneDir,
      path1CrossBotEnabled: true,
    });
    // Accept first from external worker (≠ owner).
    await sealLane({
      laneId: lane.laneId,
      kind: "accept",
      verdict: "PASS",
      tipSha: TIP,
      issuer: { agentId: "bot-worker", mode: "accept" },
      storeDir: laneDir,
    });
    // Same issuer implement — write-time path1 self-sign refuse (order-independent).
    await expect(
      sealLane({
        laneId: lane.laneId,
        kind: "implement",
        verdict: "PASS",
        tipSha: TIP,
        issuer: { agentId: "bot-worker" },
        storeDir: laneDir,
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/self_sign/i),
    });

    // Forge dual seals with same issuer (simulate store race / old hole) → merge path re-gates.
    await updateLane(
      lane.laneId,
      (l) => ({
        ...l,
        tipSha: TIP,
        headSha: TIP,
        implementSeal: {
          kind: "implement",
          verdict: "PASS",
          tipSha: TIP,
          issuer: { agentId: "bot-worker" },
          strength: "strong",
          issuedAt: new Date().toISOString(),
        },
        acceptSeal: {
          kind: "accept",
          verdict: "PASS",
          tipSha: TIP,
          issuer: { agentId: "bot-worker", mode: "accept" },
          strength: "strong",
          issuedAt: new Date().toISOString(),
        },
        stage: "accepting",
      }),
      laneDir,
    );
    const forged = await getLane(lane.laneId, laneDir);
    expect(assertPath1DualSealAuthority(forged!).allowed).toBe(false);

    await expect(
      requestMergeReady({ laneId: lane.laneId, storeDir: laneDir }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/self_sign/i),
    });
    await expect(
      requestMerge({
        laneId: lane.laneId,
        storeDir: laneDir,
        mergePort: port,
        observedHeadSha: TIP,
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/self_sign/i),
    });
    expect(port.calls).toHaveLength(0);
  });

  it("forged handoff (wrong kind) refused", async () => {
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      prNumber: 99,
      storeDir: laneDir,
      path1CrossBotEnabled: true,
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
      sealLaneFromHandoff({
        laneId: lane.laneId,
        tipSha: TIP,
        storeDir: laneDir,
        handoff: {
          handoffId: "hoff_forged",
          kind: "owner_transfer",
          status: "approved",
          fromAgentId: "bot-a",
          toAgentId: "bot-b",
          toRole: "owner",
        },
      }),
    ).rejects.toMatchObject({
      code: "REFUSED",
      message: expect.stringMatching(/unsupported_handoff_kind|handoff→seal/i),
    });
  });

  it("cross-bot handoff evidence → acceptSeal + match-head → merge_ready + requestMerge", async () => {
    const port = createRecordingMergePort();
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      tipSha: TIP,
      headSha: TIP,
      prNumber: 452,
      storeDir: laneDir,
      path1CrossBotEnabled: true,
    });
    await sealLane({
      laneId: lane.laneId,
      kind: "implement",
      verdict: "PASS",
      tipSha: TIP,
      issuer: { agentId: "bot-a", mode: "implement" },
      storeDir: laneDir,
    });

    const bridged = await sealLaneFromHandoff({
      laneId: lane.laneId,
      tipSha: TIP,
      headSha: TIP,
      storeDir: laneDir,
      handoff: {
        handoffId: "hoff_ext_1",
        kind: "evidence",
        status: "approved",
        fromAgentId: "bot-a",
        toAgentId: "bot-reviewer-ext",
        toRole: "approver",
        acceptanceCriteria: ["tests-green"],
        completedArtifacts: ["vitest"],
      },
    });
    expect(bridged.gate.allowed).toBe(true);
    expect(bridged.lane.acceptSeal?.strength).toBe("strong");
    expect(bridged.lane.acceptSeal?.issuer.agentId).toBe("bot-reviewer-ext");
    expect(bridged.lane.acceptSeal?.evidence?.refs?.some((r) => r.type === "runtimePhase")).toBe(
      true,
    );
    expect(computeMissingKeys(bridged.lane)).toEqual([]);

    const ready = await requestMergeReady({ laneId: lane.laneId, storeDir: laneDir });
    expect(ready.lane.stage).toBe("merge_ready");

    const merged = await requestMerge({
      laneId: lane.laneId,
      storeDir: laneDir,
      mergePort: port,
      observedHeadSha: TIP,
    });
    expect(port.calls).toHaveLength(1);
    expect(merged.lane.stage).toBe("merged");
    expect((await getLane(lane.laneId, laneDir))?.stage).toBe("merged");
  });
});
