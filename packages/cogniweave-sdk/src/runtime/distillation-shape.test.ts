import { describe, expect, it } from "vitest";
import type { DistillationQuality, DistillationResult } from "../models.js";
import { mergePreferFilledDistillation, readDistillationResult } from "./distillation-shape.js";

const scope = {
  workspaceId: "ws_1",
  projectId: "proj_1",
  agentId: "agent_1",
  visibility: "private" as const,
};

function quality(profile: DistillationQuality["profile"]): DistillationQuality {
  return {
    profile,
    stageCoverage: profile === "llm_multi_call" ? 1 : 0,
    stageFallbackRate: 0,
    stageDecisions: [],
  };
}

function result(id: string, goal: string, constraints: string[]): DistillationResult {
  return {
    event: {
      id,
      scope,
      goal,
      context: "context",
      constraints,
      decisions: [],
      turningPoints: [],
      linkedAtoms: [],
      evidenceRefs: [],
      eventKey: `event_${id}`,
      provenance: { sourceType: "chat" },
    },
    atoms: [],
    entities: [],
    scenarios: [],
    problems: [],
    relations: [],
    evidence: [],
    keys: {
      ingestionChecksum: `ing_${id}`,
      eventKey: `event_${id}`,
      atomDedupKeys: [],
      entityKeys: [],
      scenarioKeys: [],
      problemKeys: [],
    },
    writePlan: {
      canonicalObjectTypes: ["EventSkeleton"],
      relationIds: [],
      graphNodeIds: [id],
      graphEdgeIds: [],
      vectorDocumentIds: [id],
    },
    quality: quality("llm_single_call"),
  };
}

describe("distillation payload shape", () => {
  it("unwraps a distillationResult envelope", () => {
    const payload = result("evt_1", "goal", ["keep"]);
    expect(readDistillationResult({ distillationResult: payload })?.event.id).toBe("evt_1");
  });

  it("rejects payloads that miss the structural minimum", () => {
    expect(readDistillationResult([])).toBeNull();
    expect(readDistillationResult({ event: { id: "evt" } })).toBeNull();
    expect(
      readDistillationResult({
        ...result("evt_2", "goal", []),
        event: { ...result("evt_2", "goal", []).event, id: 1 },
      }),
    ).toBeNull();
  });

  it("keeps the current filled fields when the incoming side is blank", () => {
    const merged = mergePreferFilledDistillation(
      result("evt_current", "current goal", ["current"]),
      result("evt_incoming", "   ", []),
      quality("llm_multi_call"),
    );
    expect(merged.event.goal).toBe("current goal");
    expect(merged.event.constraints).toEqual(["current"]);
    expect(merged.event.id).toBe("evt_incoming");
    expect(merged.quality.profile).toBe("llm_multi_call");
  });

  it("prefers a non-empty incoming list and string", () => {
    const merged = mergePreferFilledDistillation(
      result("evt_current", "current goal", ["current"]),
      result("evt_incoming", "incoming goal", ["incoming"]),
      quality("rule_based"),
    );
    expect(merged.event.goal).toBe("incoming goal");
    expect(merged.event.constraints).toEqual(["incoming"]);
    expect(merged.keys.eventKey).toBe("event_evt_incoming");
  });
});
