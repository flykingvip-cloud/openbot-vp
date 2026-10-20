// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyDeliverableGovernance } from "./governance-runtime.js";

describe("classifyDeliverableGovernance", () => {
  it("returns pending + not stale when the deliverable has no indexed chunks", () => {
    expect(
      classifyDeliverableGovernance({
        hasChunks: false,
        overlappingTaskTypes: [],
        hasPendingGovernanceChunk: false,
      }),
    ).toEqual({ status: "pending", stale: false });
  });

  it("returns verified when chunks exist with no open tasks or pending chunks", () => {
    expect(
      classifyDeliverableGovernance({
        hasChunks: true,
        overlappingTaskTypes: [],
        hasPendingGovernanceChunk: false,
      }),
    ).toEqual({ status: "verified", stale: false });
  });

  it("prioritizes conflict status over other open governance", () => {
    expect(
      classifyDeliverableGovernance({
        hasChunks: true,
        overlappingTaskTypes: ["duplicate", "conflict"],
        hasPendingGovernanceChunk: false,
      }),
    ).toEqual({ status: "conflict", stale: false });
  });

  it("treats claim_conflict as conflict", () => {
    expect(
      classifyDeliverableGovernance({
        hasChunks: true,
        overlappingTaskTypes: ["claim_conflict"],
        hasPendingGovernanceChunk: false,
      }),
    ).toEqual({ status: "conflict", stale: false });
  });

  it("returns pending when a governance chunk is pending even without overlapping tasks", () => {
    expect(
      classifyDeliverableGovernance({
        hasChunks: true,
        overlappingTaskTypes: [],
        hasPendingGovernanceChunk: true,
      }),
    ).toEqual({ status: "pending", stale: false });
  });

  it("flags stale (过时) when a stale task overlaps; stale coexists with pending status", () => {
    expect(
      classifyDeliverableGovernance({
        hasChunks: true,
        overlappingTaskTypes: ["stale"],
        hasPendingGovernanceChunk: false,
      }),
    ).toEqual({ status: "pending", stale: true });
  });

  it("surfaces stale alongside a conflict status", () => {
    expect(
      classifyDeliverableGovernance({
        hasChunks: true,
        overlappingTaskTypes: ["conflict", "stale"],
        hasPendingGovernanceChunk: false,
      }),
    ).toEqual({ status: "conflict", stale: true });
  });
});
