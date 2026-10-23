import { describe, expect, it } from "vitest";
import {
  OGUI_DECISION_STATUSES,
  OGUI_RESUME_STATUSES,
  parseOguiDecisionMap,
  parseOguiDecisionRecord,
  projectOguiDecisionGesture,
  type OguiDecisionRecord,
} from "./ogui-decision.js";
import { mergeSessionEntry, type SessionEntry } from "./types.js";

function waitingRecord(patch?: Partial<OguiDecisionRecord>): OguiDecisionRecord {
  return {
    decisionId: "dec-1",
    version: 1,
    decisionStatus: "waiting",
    resumeStatus: "pending",
    resumeRef: "resume-1",
    scope: {
      sessionKey: "agent:main:main",
      userId: "user-from-auth",
      originRunId: "run-1",
      originUserMessageRef: "msg-1",
    },
    prompt: "Which path should we prepare?",
    options: [
      { value: "staging", label: "Prepare staging" },
      { value: "preview", label: "Prepare preview" },
    ],
    allowCustom: true,
    multiSelect: false,
    issuedAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    ...patch,
  };
}

describe("OguiDecisionRecord", () => {
  it("round-trips a waiting record with separate decision and resume axes", () => {
    const record = waitingRecord();
    const parsed = parseOguiDecisionRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed).toEqual(record);
    expect(parsed?.decisionStatus).toBe("waiting");
    expect(parsed?.resumeStatus).toBe("pending");
    expect(OGUI_DECISION_STATUSES).toEqual([
      "waiting",
      "answered",
      "rejected",
      "expired",
      "superseded",
    ]);
    expect(OGUI_RESUME_STATUSES).toEqual(["pending", "running", "completed", "retryable"]);
  });

  it("round-trips skip as waiting plus deferral, and keeps resumeRef", () => {
    const record = waitingRecord({ deferral: "skipped", resumeStatus: "pending" });
    const parsed = parseOguiDecisionRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed).toEqual(record);
    expect(parsed?.decisionStatus).toBe("waiting");
    expect(parsed?.deferral).toBe("skipped");
  });

  it("round-trips an answered record without collapsing resume into decisionStatus", () => {
    const record = waitingRecord({
      decisionStatus: "answered",
      resumeStatus: "retryable",
      answer: {
        kind: "option",
        value: "staging",
        label: "Prepare staging",
        submissionIds: ["550e8400-e29b-41d4-a716-446655440000"],
      },
    });
    expect(parseOguiDecisionRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it("rejects a single status that mixes skipped, close, or conflict into decisionStatus", () => {
    const base = waitingRecord();
    expect(parseOguiDecisionRecord({ ...base, decisionStatus: "skipped" })).toBeUndefined();
    expect(parseOguiDecisionRecord({ ...base, decisionStatus: "close" })).toBeUndefined();
    expect(parseOguiDecisionRecord({ ...base, decisionStatus: "conflict" })).toBeUndefined();
    expect(parseOguiDecisionRecord({ ...base, resumeStatus: "waiting" })).toBeUndefined();
    expect(parseOguiDecisionRecord({ ...base, version: 0 })).toBeUndefined();
    expect(parseOguiDecisionRecord({ ...base, multiSelect: true })).toBeUndefined();
    expect(
      parseOguiDecisionRecord({ ...base, decisionStatus: "answered", deferral: "skipped" }),
    ).toBeUndefined();
  });

  it("keeps close and dismiss display-only and maps skip to a still-waiting deferral", () => {
    expect(projectOguiDecisionGesture("close")).toEqual({ write: false, reason: "display_only" });
    expect(projectOguiDecisionGesture("dismiss")).toEqual({
      write: false,
      reason: "display_only",
    });
    expect(projectOguiDecisionGesture("skip")).toEqual({
      write: true,
      decisionStatus: "waiting",
      deferral: "skipped",
    });
    expect(projectOguiDecisionGesture("reject")).toEqual({
      write: true,
      decisionStatus: "rejected",
    });
    expect(projectOguiDecisionGesture("answer")).toEqual({
      write: true,
      decisionStatus: "answered",
    });
  });

  it("keys the session map by decisionId", () => {
    const record = waitingRecord();
    const map = parseOguiDecisionMap({ [record.decisionId]: record });
    expect(map?.[record.decisionId]).toEqual(record);
    expect(parseOguiDecisionMap({ "other-id": record })).toBeUndefined();
    expect(parseOguiDecisionMap({})).toEqual({});
  });

  it("stores the map on SessionEntry and leaves it in place when a patch omits it", () => {
    const record = waitingRecord();
    const entry: SessionEntry = {
      sessionId: "sess-1",
      updatedAt: 10,
      oguiDecisions: { [record.decisionId]: record },
    };
    const merged = mergeSessionEntry(entry, { updatedAt: 11 });
    expect(merged.oguiDecisions).toEqual(entry.oguiDecisions);
  });
});
