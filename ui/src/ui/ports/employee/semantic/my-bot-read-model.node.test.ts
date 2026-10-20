import { describe, expect, it } from "vitest";
import { computeContributionFromSessionShare } from "./collaboration-group-read-model.ts";
import {
  MY_BOT_FORBIDDEN_MESH_KEYS,
  assertNoMeshFieldsOnMyBotProjection,
  createEmptyMyBotProjection,
  mapSuccessRateToStars,
  toMyBotBriefStatus,
} from "./my-bot-read-model.ts";

describe("MyBot read model Phase 0 contract", () => {
  it("creates an empty six-block projection without mesh fields", () => {
    const projection = createEmptyMyBotProjection("bot-1", "市场助手");
    expect(projection.agentId).toBe("bot-1");
    expect(projection.identity.name).toBe("市场助手");
    expect(projection.capabilities).toEqual([]);
    expect(projection.personas).toEqual([]);
    expect(projection.collaborations).toEqual([]);
    expect(projection.phase).toBe(0);
    expect(projection.blocksComplete).toMatchObject({ identity: false, capabilities: false });
    assertNoMeshFieldsOnMyBotProjection(projection);
    for (const key of MY_BOT_FORBIDDEN_MESH_KEYS) {
      expect(key in projection).toBe(false);
    }
  });

  it("allows Gateway delivery metadata phase/blocksComplete on the projection", () => {
    const projection = {
      ...createEmptyMyBotProjection("bot-meta"),
      phase: 0,
      blocksComplete: {
        identity: true,
        capabilities: false,
        personas: false,
        growth: false,
        collaborations: false,
        data: false,
      },
    };
    assertNoMeshFieldsOnMyBotProjection(projection);
    expect(projection.blocksComplete?.identity).toBe(true);
  });

  it("rejects projections that smuggle mesh cost/runtime fields", () => {
    const dirty = {
      ...createEmptyMyBotProjection("bot-2"),
      totalCost: 12.5,
    };
    expect(() => assertNoMeshFieldsOnMyBotProjection(dirty)).toThrow(/totalCost/);
  });

  it("maps successRate to 1–5 stars", () => {
    expect(mapSuccessRateToStars(0)).toBe(1);
    expect(mapSuccessRateToStars(0.2)).toBe(1);
    expect(mapSuccessRateToStars(0.5)).toBe(3);
    expect(mapSuccessRateToStars(1)).toBe(5);
    expect(mapSuccessRateToStars(null)).toBe(1);
  });

  it("caps employee runtime to brief status", () => {
    expect(toMyBotBriefStatus({ ready: true })).toBe("online");
    expect(toMyBotBriefStatus({ online: false })).toBe("offline");
    expect(toMyBotBriefStatus({ degraded: true, ready: true })).toBe("degraded");
    expect(toMyBotBriefStatus({})).toBe("unknown");
  });
});

describe("Collaboration group contribution v1", () => {
  it("computes session-share contribution", () => {
    expect(computeContributionFromSessionShare(3, 10)).toBe(30);
    expect(computeContributionFromSessionShare(0, 0)).toBeNull();
  });
});
