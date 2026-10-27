import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import {
  buildSkillDraftProfile,
  deriveSkillDraftCandidates,
  resolveClusterKey,
} from "./skill-draft-curation.js";

function makeAsset(overrides: Partial<AgentLearningAsset> = {}): AgentLearningAsset {
  return {
    assetId: "asset-1",
    botId: "bot-1",
    sourceGroupId: "grp-1",
    sourceCapsuleId: "cap-1",
    assetType: "lesson",
    status: "active",
    reuseCount: 0,
    outcomeVerifiedCount: 0,
    abstractedContent: { lesson: "部署前先跑迁移脚本" },
    ...overrides,
  };
}

describe("resolveClusterKey", () => {
  it("prefers the structured root cause", () => {
    const key = resolveClusterKey(
      makeAsset({ abstractedContent: { lesson: "x", source: { reason: "context_overflow" } } }),
    );
    expect(key).toBe("lesson::reason::context_overflow");
  });

  it("falls back to a normalized lesson signature", () => {
    const a = resolveClusterKey(makeAsset({ abstractedContent: { lesson: "先跑迁移，再部署！" } }));
    const b = resolveClusterKey(makeAsset({ abstractedContent: { lesson: "先跑迁移 再部署" } }));
    expect(a).toBe(b);
  });

  it("returns null when there is nothing to cluster on", () => {
    expect(resolveClusterKey(makeAsset({ abstractedContent: {} }))).toBeNull();
  });
});

describe("deriveSkillDraftCandidates", () => {
  it("does not graduate experience below both thresholds", () => {
    const candidates = deriveSkillDraftCandidates([makeAsset({ outcomeVerifiedCount: 2 })], {
      reuseThreshold: 3,
      occurrenceThreshold: 3,
    });
    expect(candidates).toEqual([]);
  });

  it("does not graduate on prompt injection / legacy reuseCount alone (W4)", () => {
    const candidates = deriveSkillDraftCandidates(
      [makeAsset({ reuseCount: 10, injectedCount: 10, outcomeVerifiedCount: 0 })],
      { reuseThreshold: 3, occurrenceThreshold: 99 },
    );
    expect(candidates).toEqual([]);
  });

  it("graduates on accumulated outcome_verified", () => {
    const candidates = deriveSkillDraftCandidates([makeAsset({ outcomeVerifiedCount: 3 })], {
      reuseThreshold: 3,
      occurrenceThreshold: 3,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.trigger).toBe("outcome_verified_threshold");
    expect(candidates[0]?.totalReuse).toBe(3);
  });

  it("graduates on repeated occurrences of the same root cause", () => {
    const assets = ["a1", "a2", "a3"].map((assetId) =>
      makeAsset({
        assetId,
        outcomeVerifiedCount: 0,
        abstractedContent: { lesson: "别直接改生产库", source: { reason: "prod_write" } },
      }),
    );
    const candidates = deriveSkillDraftCandidates(assets, {
      reuseThreshold: 99,
      occurrenceThreshold: 3,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.trigger).toBe("occurrence_threshold");
    expect(candidates[0]?.assetIds).toEqual(["a1", "a2", "a3"]);
  });

  it("keeps clusters separate per bot", () => {
    const assets = [
      makeAsset({ assetId: "a1", botId: "bot-1", outcomeVerifiedCount: 5 }),
      makeAsset({ assetId: "a2", botId: "bot-2", outcomeVerifiedCount: 5 }),
    ];
    const candidates = deriveSkillDraftCandidates(assets, { reuseThreshold: 3 });
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((entry) => entry.botId))).toEqual(new Set(["bot-1", "bot-2"]));
  });

  it("is idempotent: already-curated assets are excluded", () => {
    const candidates = deriveSkillDraftCandidates(
      [makeAsset({ outcomeVerifiedCount: 10, curatedSkillId: "skill-1" })],
      { reuseThreshold: 3 },
    );
    expect(candidates).toEqual([]);
  });

  it("ignores non-active assets", () => {
    const candidates = deriveSkillDraftCandidates(
      [makeAsset({ outcomeVerifiedCount: 10, status: "revoked" })],
      { reuseThreshold: 3 },
    );
    expect(candidates).toEqual([]);
  });

  it("sums outcome_verified across a cluster", () => {
    const assets = [
      makeAsset({ assetId: "a1", outcomeVerifiedCount: 1 }),
      makeAsset({ assetId: "a2", outcomeVerifiedCount: 1 }),
    ];
    const candidates = deriveSkillDraftCandidates(assets, {
      reuseThreshold: 2,
      occurrenceThreshold: 99,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.totalReuse).toBe(2);
    expect(candidates[0]?.occurrences).toBe(2);
  });
});

describe("buildSkillDraftProfile", () => {
  it("produces a private draft profile that explains why it graduated", () => {
    const [candidate] = deriveSkillDraftCandidates([makeAsset({ outcomeVerifiedCount: 4 })], {
      reuseThreshold: 3,
    });
    expect(candidate).toBeDefined();
    const profile = buildSkillDraftProfile(candidate);
    expect(profile.visibility).toBe("private");
    expect(profile.name).toContain("经验沉淀");
    expect(profile.summary).toContain("累计验证有效 4 次");
    expect(profile.summary).toContain("待人工审核");
  });
});
