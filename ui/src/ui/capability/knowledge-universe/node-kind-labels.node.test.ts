import { describe, expect, it } from "vitest";
import { relationshipNodeKindLabel } from "./node-kind-labels.ts";

describe("relationshipNodeKindLabel", () => {
  it("maps internal node kinds to employee-facing labels", () => {
    expect(relationshipNodeKindLabel("knowledge-object")).not.toContain("knowledge-object");
    expect(relationshipNodeKindLabel("data-capability")).not.toContain("data-capability");
    expect(relationshipNodeKindLabel("agent")).not.toBe("agent");
    expect(relationshipNodeKindLabel("project")).not.toBe("project");
    expect(relationshipNodeKindLabel("owner")).not.toBe("owner");
  });

  it("labels knowledge-base and deliverable kinds distinctly from generic knowledge", () => {
    const knowledgeLabel = relationshipNodeKindLabel("knowledge-object");
    const kbLabel = relationshipNodeKindLabel("knowledge-base");
    const deliverableLabel = relationshipNodeKindLabel("deliverable");
    expect(kbLabel).not.toBe("knowledge-base");
    expect(kbLabel).not.toBe(knowledgeLabel);
    expect(deliverableLabel).not.toBe("deliverable");
    expect(deliverableLabel).not.toBe(knowledgeLabel);
  });
});
