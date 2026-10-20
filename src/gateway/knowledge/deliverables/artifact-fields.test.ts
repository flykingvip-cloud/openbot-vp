import { describe, expect, it } from "vitest";
import {
  enrichWorkspaceDeliverableArtifactFields,
  resolveWorkspaceArtifactSourceType,
} from "./artifact-fields.js";

describe("workspace deliverable artifact fields", () => {
  it("enriches legacy collaboration deliverables", () => {
    const item = enrichWorkspaceDeliverableArtifactFields({
      deliverableId: "d-1",
      title: "方案评审",
      kind: "proposal",
      source: "group",
      creators: ["user-1"],
      status: "published",
      updatedAtMs: 1,
    });
    expect(item.sourceType).toBe("collaboration");
    expect(item.artifactKind).toBe("document");
    expect(item.governanceStatus).toBe("pending");
  });

  it("enriches agent skill deliverables", () => {
    const item = enrichWorkspaceDeliverableArtifactFields({
      deliverableId: "skill:1",
      title: "销售预测报告",
      kind: "analysis",
      source: "agent",
      creators: ["bot-1"],
      status: "published",
      updatedAtMs: 1,
    });
    expect(item.sourceType).toBe("agent");
    expect(item.artifactKind).toBe("report");
    expect(resolveWorkspaceArtifactSourceType({ legacySource: "agent" })).toBe("agent");
  });
});
