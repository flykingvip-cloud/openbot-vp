import { describe, expect, it } from "vitest";
import {
  artifactSourceTrustScore,
  legacySourceToArtifactSourceType,
  normalizeArtifactKind,
  normalizeArtifactSourceType,
  resolveArtifactGovernanceStatus,
} from "./knowledge-universe-artifact-taxonomy.ts";

describe("knowledge-universe artifact taxonomy", () => {
  it("maps legacy deliverable sources to canonical source types", () => {
    expect(legacySourceToArtifactSourceType("agent")).toBe("agent");
    expect(legacySourceToArtifactSourceType("group")).toBe("collaboration");
    expect(legacySourceToArtifactSourceType("task")).toBe("task");
    expect(legacySourceToArtifactSourceType("chat")).toBe("personal");
  });

  it("prefers explicit sourceType from API", () => {
    expect(
      normalizeArtifactSourceType({
        source: "chat",
        sourceType: "enterprise",
        kind: "report",
        title: "制度",
      }),
    ).toBe("enterprise");
  });

  it("derives artifact kind from legacy kind and source", () => {
    expect(
      normalizeArtifactKind({
        source: "agent",
        kind: "analysis",
        title: "预测",
      }),
    ).toBe("report");
    expect(
      normalizeArtifactKind({
        source: "agent",
        kind: "other",
        title: "Bot output",
      }),
    ).toBe("agent_result");
    expect(
      normalizeArtifactKind({
        source: "task",
        kind: "other",
        title: "日报",
      }),
    ).toBe("workflow_output");
  });

  it("marks archived deliverables as verified governance status", () => {
    expect(
      resolveArtifactGovernanceStatus({
        source: "agent",
        relatedKnowledgeBaseId: "kb-1",
        title: "",
        kind: "",
      }),
    ).toBe("verified");
    expect(
      resolveArtifactGovernanceStatus({
        source: "agent",
        title: "",
        kind: "",
      }),
    ).toBe("pending");
  });

  it("exposes trust scores for governance context", () => {
    expect(artifactSourceTrustScore("enterprise")).toBeGreaterThan(
      artifactSourceTrustScore("agent"),
    );
    expect(artifactSourceTrustScore("external")).toBeLessThan(
      artifactSourceTrustScore("collaboration"),
    );
  });
});
