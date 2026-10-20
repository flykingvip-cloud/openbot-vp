import { describe, expect, it } from "vitest";
import type { WorkspaceDeliverableDto } from "../capability/knowledge-universe/workspace-endpoints.ts";
import {
  classifyAgentMemoryCategory,
  summarizeAgentMemory,
} from "./knowledge-universe-agent-memory.ts";

function deliverable(partial: Partial<WorkspaceDeliverableDto>): WorkspaceDeliverableDto {
  return {
    deliverableId: "d",
    title: "t",
    kind: "other",
    source: "agent",
    creators: [],
    status: "done",
    updatedAtMs: 0,
    ...partial,
  };
}

describe("knowledge-universe-agent-memory", () => {
  it("classifies by canonical artifactKind first", () => {
    expect(classifyAgentMemoryCategory(deliverable({ artifactKind: "workflow_output" }))).toBe(
      "workflow",
    );
    expect(classifyAgentMemoryCategory(deliverable({ artifactKind: "agent_result" }))).toBe(
      "analysis",
    );
    expect(classifyAgentMemoryCategory(deliverable({ artifactKind: "report" }))).toBe("report");
    expect(classifyAgentMemoryCategory(deliverable({ artifactKind: "knowledge" }))).toBe(
      "knowledge",
    );
    expect(classifyAgentMemoryCategory(deliverable({ artifactKind: "note" }))).toBe("knowledge");
  });

  it("falls back to capture source when artifactKind is generic", () => {
    expect(
      classifyAgentMemoryCategory(deliverable({ artifactKind: "document", source: "chat" })),
    ).toBe("conversation");
    expect(classifyAgentMemoryCategory(deliverable({ source: "task" }))).toBe("workflow");
    expect(classifyAgentMemoryCategory(deliverable({ source: "group" }))).toBe("collaboration");
    expect(classifyAgentMemoryCategory(deliverable({ source: "agent" }))).toBe("other");
    expect(classifyAgentMemoryCategory(deliverable({ source: "agent", sourceType: "task" }))).toBe(
      "workflow",
    );
  });

  it("groups into ordered, non-empty categories", () => {
    const groups = summarizeAgentMemory([
      deliverable({ deliverableId: "a", source: "agent" }),
      deliverable({ deliverableId: "b", source: "chat", artifactKind: "document" }),
      deliverable({ deliverableId: "c", artifactKind: "agent_result" }),
      deliverable({ deliverableId: "d2", artifactKind: "agent_result" }),
    ]);
    expect(groups.map((group) => group.category)).toEqual(["conversation", "analysis", "other"]);
    expect(groups.find((group) => group.category === "analysis")?.items).toHaveLength(2);
  });
});
