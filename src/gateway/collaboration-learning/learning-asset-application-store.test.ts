import type { AgentLearningAsset, GroupMemoryCapsule } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import {
  maxApplicationCount,
  maxApplicationCountFor,
  selectAssetIdsForDeliverables,
} from "./learning-asset-application-store.js";

describe("maxApplicationCount (learning reuse intensity signal)", () => {
  it("returns 0 for an empty tally", () => {
    expect(maxApplicationCount({})).toBe(0);
  });

  it("returns the max application count across assets", () => {
    expect(maxApplicationCount({ a: 1, b: 5, c: 3 })).toBe(5);
  });

  it("ignores non-finite / negative-safe values", () => {
    expect(maxApplicationCount({ a: Number.NaN, b: 2 })).toBe(2);
    expect(maxApplicationCount({ a: Number.POSITIVE_INFINITY, b: 4 })).toBe(4);
  });
});

describe("selectAssetIdsForDeliverables (attribute reuse to pattern source)", () => {
  const capsules: GroupMemoryCapsule[] = [
    { capsuleId: "cap-1", groupId: "g1", sourceIds: ["rev-1", "del-1"] },
    { capsuleId: "cap-2", groupId: "g1", sourceIds: ["rev-2", "del-2"] },
    { capsuleId: "cap-3", groupId: "g1", sourceIds: ["sk-1", "round-1"] }, // execution capsule, no deliverable
  ];
  const assets: AgentLearningAsset[] = [
    { assetId: "a1", botId: "b", sourceGroupId: "g1", sourceCapsuleId: "cap-1" },
    { assetId: "a2", botId: "b", sourceGroupId: "g1", sourceCapsuleId: "cap-2" },
    { assetId: "a3", botId: "b", sourceGroupId: "g1", sourceCapsuleId: "cap-3" },
  ];

  it("selects assets whose source capsule references a target deliverable", () => {
    expect(selectAssetIdsForDeliverables(capsules, assets, ["del-1"])).toEqual(["a1"]);
    expect(selectAssetIdsForDeliverables(capsules, assets, ["del-1", "del-2"]).toSorted()).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("returns empty when no deliverable matches", () => {
    expect(selectAssetIdsForDeliverables(capsules, assets, ["del-x"])).toEqual([]);
    expect(selectAssetIdsForDeliverables(capsules, assets, [])).toEqual([]);
  });
});

describe("maxApplicationCountFor (scoped reuse intensity)", () => {
  it("returns the max count among the given asset ids only", () => {
    const counts = { a1: 2, a2: 7, a3: 1 };
    expect(maxApplicationCountFor(counts, ["a1", "a3"])).toBe(2);
    expect(maxApplicationCountFor(counts, ["a2"])).toBe(7);
    expect(maxApplicationCountFor(counts, ["missing"])).toBe(0);
    expect(maxApplicationCountFor(counts, [])).toBe(0);
  });
});
