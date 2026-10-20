import { describe, expect, it } from "vitest";
import type { KnowledgeLineageRecord } from "../knowledge-lineage-store.js";
import { resolveDownstreamDeliverableLinks } from "./downstream-runtime.js";

function generation(
  overrides: Partial<KnowledgeLineageRecord> & { lineageId: string },
): KnowledgeLineageRecord {
  return {
    kind: "generation",
    deliverableId: null,
    sessionKey: null,
    messageId: null,
    agentId: null,
    taskId: null,
    groupId: null,
    generationPromptHash: null,
    sourceChunkIds: [],
    sourceKnowledgeBaseIds: [],
    sourceAgentIds: [],
    sourceTaskIds: [],
    sourceRelationIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("resolveDownstreamDeliverableLinks", () => {
  it("returns nothing when there are no downstream generations", () => {
    expect(
      resolveDownstreamDeliverableLinks({
        currentDeliverableId: "dlv-a",
        downstreamGenerations: [],
        resolveCommittedDeliverable: () => null,
      }),
    ).toEqual([]);
  });

  it("resolves a downstream deliverable via its commit sibling", () => {
    const links = resolveDownstreamDeliverableLinks({
      currentDeliverableId: "dlv-a",
      downstreamGenerations: [generation({ lineageId: "lin-2", agentId: "agent-sales" })],
      resolveCommittedDeliverable: (lineageId) =>
        lineageId === "lin-2"
          ? { deliverableId: "dlv-b", agentId: "agent-sales", atMs: 200 }
          : null,
    });
    expect(links).toEqual([{ deliverableId: "dlv-b", agentId: "agent-sales", atMs: 200 }]);
  });

  it("skips generations whose downstream run was never archived (no commit sibling)", () => {
    const links = resolveDownstreamDeliverableLinks({
      currentDeliverableId: "dlv-a",
      downstreamGenerations: [generation({ lineageId: "lin-unarchived" })],
      resolveCommittedDeliverable: () => null,
    });
    expect(links).toEqual([]);
  });

  it("excludes the current deliverable (its own commit row also lists the KB)", () => {
    const links = resolveDownstreamDeliverableLinks({
      currentDeliverableId: "dlv-a",
      downstreamGenerations: [generation({ lineageId: "lin-a" })],
      resolveCommittedDeliverable: () => ({ deliverableId: "dlv-a", agentId: null, atMs: 100 }),
    });
    expect(links).toEqual([]);
  });

  it("dedupes multiple generations pointing at the same downstream deliverable", () => {
    const links = resolveDownstreamDeliverableLinks({
      currentDeliverableId: "dlv-a",
      downstreamGenerations: [
        generation({ lineageId: "lin-1" }),
        generation({ lineageId: "lin-2" }),
      ],
      resolveCommittedDeliverable: () => ({ deliverableId: "dlv-b", agentId: "r1", atMs: 10 }),
    });
    expect(links).toEqual([{ deliverableId: "dlv-b", agentId: "r1", atMs: 10 }]);
  });

  it("orders links by recency (atMs desc)", () => {
    const links = resolveDownstreamDeliverableLinks({
      currentDeliverableId: "dlv-a",
      downstreamGenerations: [
        generation({ lineageId: "lin-old" }),
        generation({ lineageId: "lin-new" }),
      ],
      resolveCommittedDeliverable: (lineageId) =>
        lineageId === "lin-old"
          ? { deliverableId: "dlv-old", agentId: null, atMs: 100 }
          : { deliverableId: "dlv-new", agentId: null, atMs: 900 },
    });
    expect(links.map((link) => link.deliverableId)).toEqual(["dlv-new", "dlv-old"]);
  });

  it("falls back to the generation agent + updatedAt when the commit row omits them", () => {
    const links = resolveDownstreamDeliverableLinks({
      currentDeliverableId: "dlv-a",
      downstreamGenerations: [
        generation({ lineageId: "lin-2", agentId: "agent-gen", updatedAt: 555 }),
      ],
      resolveCommittedDeliverable: () => ({ deliverableId: "dlv-b", agentId: null }),
    });
    expect(links).toEqual([{ deliverableId: "dlv-b", agentId: "agent-gen", atMs: 555 }]);
  });
});
