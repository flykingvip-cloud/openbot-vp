// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertDeliverableSaveDecision,
  originChanged,
  resolveDeliverableSaveDecision,
  resolveSaveAsFilename,
  SaveConflictStaleError,
  SaveDecisionRequiredError,
} from "./save-decision.js";

const existing = {
  knowledgeBaseId: "kb-team",
  documentId: "doc-1",
  deliverableId: "skill:old",
  logicalId: "weekly-brief",
  rawHash: "hash-v1",
  filename: "deliverables/weekly-brief.md",
  archivedByAgentId: "bot-1",
  archivedByGroupId: "grp-a",
};

describe("resolveDeliverableSaveDecision", () => {
  it("creates on first save", () => {
    expect(
      resolveDeliverableSaveDecision({
        existing: null,
        proposedRawHash: "hash-new",
        proposedAgentId: "bot-1",
      }),
    ).toEqual({ action: "create" });
  });

  it("skips when bytes are unchanged even if another robot saves", () => {
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v1",
        proposedAgentId: "bot-2",
        proposedGroupId: "grp-b",
      }),
    ).toEqual({ action: "noop", existing });
  });

  it("asks when the same origin saves changed bytes", () => {
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-1",
        proposedGroupId: "grp-a",
      }),
    ).toEqual({
      action: "require_decision",
      existing,
      reason: "content_changed",
    });
  });

  it("asks when another robot/group saves changed bytes", () => {
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-2",
        proposedGroupId: "grp-a",
      }),
    ).toEqual({
      action: "require_decision",
      existing,
      reason: "different_origin",
    });
  });

  it("asks when a legacy archive has no rawHash", () => {
    const legacy = { ...existing, rawHash: undefined };
    expect(
      resolveDeliverableSaveDecision({
        existing: legacy,
        proposedRawHash: "hash-v1",
        proposedAgentId: "bot-1",
        proposedGroupId: "grp-a",
      }),
    ).toEqual({
      action: "require_decision",
      existing: legacy,
      reason: "already_archived",
    });
  });

  it("overwrites only when the confirmed rawHash still matches", () => {
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-2",
        proposedGroupId: "grp-b",
        saveMode: "overwrite",
        expectedRawHash: "hash-v1",
      }),
    ).toEqual({ action: "overwrite", existing });
  });

  it("rejects a stale overwrite lock", () => {
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-2",
        saveMode: "overwrite",
        expectedRawHash: "hash-stale",
      }),
    ).toEqual({ action: "stale", existing });
  });

  it("rejects overwrite without the hash the user saw", () => {
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-2",
        saveMode: "overwrite",
      }),
    ).toEqual({ action: "stale", existing });
  });

  it("save-as keeps a sibling filename and uniquifies collisions", () => {
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-2",
        saveMode: "save_as",
        saveAsFilename: "定价方案-修订.md",
      }),
    ).toEqual({
      action: "save_as",
      existing,
      filename: "定价方案-修订.md",
    });
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-2",
        saveMode: "save_as",
        saveAsFilename: "deliverables/weekly-brief.md",
      }),
    ).toEqual({
      action: "save_as",
      existing,
      filename: "deliverables/weekly-brief-v2.md",
    });
    expect(
      resolveDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-2",
        saveMode: "save_as",
        saveAsFilename: "定价方案-修订.md",
        reservedFilenames: ["定价方案-修订.md", "deliverables/weekly-brief.md"],
      }),
    ).toEqual({
      action: "save_as",
      existing,
      filename: "定价方案-修订-v2.md",
    });
  });
});

describe("assertDeliverableSaveDecision", () => {
  it("throws typed errors for prompt and stale", () => {
    expect(() =>
      assertDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-1",
        proposedGroupId: "grp-a",
      }),
    ).toThrow(SaveDecisionRequiredError);
    expect(() =>
      assertDeliverableSaveDecision({
        existing,
        proposedRawHash: "hash-v2",
        proposedAgentId: "bot-1",
        saveMode: "overwrite",
        expectedRawHash: "old",
      }),
    ).toThrow(SaveConflictStaleError);
  });
});

describe("originChanged / resolveSaveAsFilename", () => {
  it("treats missing group as different from a grouped archive", () => {
    expect(originChanged(existing, "bot-1", null)).toBe(true);
    expect(originChanged(existing, "bot-1", "grp-a")).toBe(false);
  });

  it("appends -v2 when the requested name equals the current file", () => {
    expect(
      resolveSaveAsFilename({
        requested: "brief.pdf",
        existingFilename: "brief.pdf",
      }),
    ).toBe("brief-v2.pdf");
    expect(
      resolveSaveAsFilename({
        requested: "brief",
        existingFilename: "brief",
      }),
    ).toBe("brief-v2");
    expect(
      resolveSaveAsFilename({
        requested: "brief-v2.pdf",
        existingFilename: "brief-v2.pdf",
        reservedFilenames: ["brief-v2.pdf", "brief-v3.pdf"],
      }),
    ).toBe("brief-v4.pdf");
  });
});
