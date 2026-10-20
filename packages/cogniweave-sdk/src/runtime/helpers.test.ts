import { describe, expect, it } from "vitest";
import type { EngineConfig, Scope } from "../models.js";
import { buildDistillationResult } from "./helpers.js";

const config: EngineConfig = {
  environment: "local",
  metadataBackend: "memory",
  graphBackend: "memory",
  evidenceBackend: "memory",
  vectorBackend: "memory",
};

const scope: Scope = {
  workspaceId: "ws_1",
  projectId: "proj_1",
  agentId: "agent_1",
  visibility: "private",
};

describe("runtime helpers distillation pipeline", () => {
  it("injects segmented tool call locators into evidence records", () => {
    const result = buildDistillationResult({
      rawInput: {
        text: "Throughput dropped and external API is very slow.",
        toolCalls: ["tool.fetch_metrics", "tool.query_queue"],
      },
      config,
      scopeInput: scope,
      sourceType: "tool_log",
      sourceSessionId: "sess_tool_1",
      sourceTurnRange: [11, 13],
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].locator.turnRange).toEqual([11, 13]);
    expect(result.evidence[0].locator.toolCallIds).toEqual([
      "tool.fetch_metrics",
      "tool.query_queue",
    ]);
  });

  it("produces repaired tentative atom when extraction has no pattern match", () => {
    const result = buildDistillationResult({
      rawInput: "Please summarize this architecture memo and keep wording concise.",
      config,
      scopeInput: scope,
      sourceType: "chat",
      sourceSessionId: "sess_fallback_1",
    });

    expect(result.atoms.length).toBeGreaterThan(0);
    expect(result.atoms[0].atomType).toBe("problem_pattern");
    expect(result.atoms[0].state.status).toBe("tentative");
    expect(result.atoms[0].dedupKey).toBeTruthy();
    expect(
      result.atoms[0].trigger.conditions.length + result.atoms[0].trigger.contextTags.length,
    ).toBeGreaterThan(0);
    expect(result.atoms[0].applicability.include.length).toBeGreaterThan(0);
  });

  it("normalizes and validates all atoms in output", () => {
    const result = buildDistillationResult({
      rawInput: "Sync retry in HIGH latency causes throughput drop and queue blocking.",
      config,
      scopeInput: scope,
      sourceType: "chat",
      sourceSessionId: "sess_norm_1",
    });

    for (const atom of result.atoms) {
      expect(atom.dedupKey).toBeTruthy();
      expect(atom.claim.statement.trim().length).toBeGreaterThan(0);
      expect(atom.metrics.confidence).toBeGreaterThanOrEqual(0);
      expect(atom.metrics.confidence).toBeLessThanOrEqual(1);
      expect(atom.trigger.conditions.every((entry) => entry === entry.toLowerCase())).toBe(true);
      expect(atom.trigger.contextTags.every((entry) => entry === entry.toLowerCase())).toBe(true);
    }
  });

  it("creates APPLIES_TO relations for entity-scoped applicability", () => {
    const result = buildDistillationResult({
      rawInput: "External API latency is high. Should we use async buffering in worker pipeline?",
      config,
      scopeInput: scope,
      sourceType: "chat",
      sourceSessionId: "sess_rel_1",
    });

    const appliesToRelations = result.relations.filter(
      (relation) => relation.relationType === "APPLIES_TO",
    );
    expect(appliesToRelations.length).toBeGreaterThan(0);
    expect(appliesToRelations.some((relation) => relation.toNodeType === "Entity")).toBe(true);
  });
});
