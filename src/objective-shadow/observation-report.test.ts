import { describe, expect, it } from "vitest";
import {
  detectFabricatedIdentity,
  formatObservationReportMarkdown,
  scanShadowPayloadForLeaks,
  summarizeObservation,
} from "./observation-report.js";
import { replayObserve } from "./replay.js";
import {
  OBJECTIVE_SHADOW_SCHEMA,
  type ShadowObserveInput,
  type ShadowObserveRecord,
} from "./types.js";
import { SHADOW_WINDOW_MS } from "./window.js";

const NOW = 1_726_243_200_000;

function record(over: Partial<ShadowObserveRecord> = {}): ShadowObserveRecord {
  const { correlation, metrics, ...rest } = over;
  return {
    schemaVersion: OBJECTIVE_SHADOW_SCHEMA,
    recordId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    observedAtMs: NOW,
    resolveStatus: "resolved",
    conflictCodes: [],
    proposed: [],
    proposedDisposition: "generated",
    rejectOrDiscardCodes: [],
    ...rest,
    correlation: {
      runId: "run-1",
      ingress: "chat",
      tenantHash: "0123456789abcdef",
      objectiveId: "task-obj-1",
      revision: 4,
      source: "conversation_task",
      ...correlation,
    },
    metrics: {
      candidateCount: 1,
      allowedCandidateCount: 1,
      forbiddenCandidateCount: 0,
      sourceConflict: 0,
      allowlistRejected: 0,
      allowlistIgnoredForbidden: 0,
      inheritViolation: 0,
      proposedGenerated: 1,
      proposedRejected: 0,
      proposedDiscarded: 0,
      forbiddenWriteAttempts: 0,
      ...metrics,
    },
  };
}

describe("summarizeObservation", () => {
  it("aggregates required observation metrics without leaking identity plaintext", () => {
    const report = summarizeObservation({
      records: [
        record(),
        record({
          correlation: {
            runId: "occ-1",
            ingress: "cron_isolated",
            cronOccurrenceId: "occ-1",
            objectiveId: "cron-obj:job-a",
            revision: 2,
            source: "cron",
            tenantHash: "0123456789abcdef",
          },
          metrics: {
            proposedGenerated: 1,
            proposedDiscarded: 0,
            proposedRejected: 0,
            sourceConflict: 0,
            allowlistRejected: 0,
            inheritViolation: 0,
            forbiddenWriteAttempts: 0,
            candidateCount: 1,
            allowedCandidateCount: 1,
            forbiddenCandidateCount: 0,
            allowlistIgnoredForbidden: 0,
          },
        }),
        record({
          correlation: {
            runId: "round-1",
            ingress: "collaboration_turn",
            objectiveId: "shared-1",
            revision: 3,
            source: "collaboration",
            tenantHash: "0123456789abcdef",
          },
          resolveStatus: "resolved",
          rejectOrDiscardCodes: ["collab_deferred_phase3b"],
          proposedDisposition: "discarded",
          metrics: {
            proposedGenerated: 0,
            proposedDiscarded: 1,
            proposedRejected: 0,
            sourceConflict: 0,
            allowlistRejected: 0,
            inheritViolation: 0,
            forbiddenWriteAttempts: 0,
            candidateCount: 1,
            allowedCandidateCount: 1,
            forbiddenCandidateCount: 0,
            allowlistIgnoredForbidden: 0,
          },
        }),
        record({
          correlation: { runId: "child-1", ingress: "subagent", tenantHash: "0123456789abcdef" },
          resolveStatus: "conflict",
          conflictCodes: ["inherit_violation"],
          proposedDisposition: "discarded",
          metrics: {
            proposedGenerated: 0,
            proposedDiscarded: 1,
            proposedRejected: 0,
            sourceConflict: 0,
            allowlistRejected: 0,
            inheritViolation: 1,
            forbiddenWriteAttempts: 0,
            candidateCount: 0,
            allowedCandidateCount: 0,
            forbiddenCandidateCount: 0,
            allowlistIgnoredForbidden: 0,
          },
        }),
        record({
          correlation: { runId: "run-skip", ingress: "chat", tenantHash: "0123456789abcdef" },
          resolveStatus: "skipped",
          proposedDisposition: "discarded",
          metrics: {
            proposedGenerated: 0,
            proposedDiscarded: 1,
            proposedRejected: 0,
            sourceConflict: 0,
            allowlistRejected: 0,
            inheritViolation: 0,
            forbiddenWriteAttempts: 0,
            candidateCount: 0,
            allowedCandidateCount: 0,
            forbiddenCandidateCount: 0,
            allowlistIgnoredForbidden: 0,
          },
        }),
      ],
      window: {
        firstWriteAtMs: NOW,
        counts: { chat: 2, cron_isolated: 1, collaboration_turn: 1, subagent: 1 },
        seenRunIds: ["run-1"],
        stopped: false,
      },
      landedSha: "6e3f581e75742112735fe19b03162ce77e7dc874",
      logCorrespondsToLandedSha: true,
      nowMs: NOW + 60_000,
    });
    expect(report.ingress.chat.records).toBe(2);
    expect(report.ingress.cron_isolated.records).toBe(1);
    expect(report.ingress.collaboration_turn.records).toBe(1);
    expect(report.ingress.subagent.records).toBe(1);
    expect(report.resolveStatus.resolved).toBe(3);
    expect(report.resolveStatus.conflict).toBe(1);
    expect(report.resolveStatus.skipped).toBe(1);
    expect(report.inheritViolationCount).toBe(1);
    expect(report.inheritViolationRate).toBe(0.2);
    expect(report.forbiddenWriteAttempts).toBe(0);
    expect(report.hmacKeyMissingCount).toBe(0);
    expect(report.mustStop).toBe(false);
    const markdown = formatObservationReportMarkdown(report);
    expect(markdown).not.toContain("tenant-");
    expect(markdown).not.toContain("@");
    expect(markdown).not.toContain("/Users/");
    expect(markdown).toContain("landedSha: 6e3f581e75742112735fe19b03162ce77e7dc874");
  });

  it("flags stop conditions for leaks, missing runId, forbidden writes, and fabricated identity", () => {
    const leaked = record({
      correlation: {
        runId: "run-leak",
        ingress: "chat",
        tenantHash: "0123456789abcdef",
        objectiveId: "user@example.com",
      },
      metrics: {
        forbiddenWriteAttempts: 1,
        proposedGenerated: 0,
        proposedDiscarded: 1,
        proposedRejected: 0,
        sourceConflict: 0,
        allowlistRejected: 0,
        inheritViolation: 0,
        candidateCount: 1,
        allowedCandidateCount: 1,
        forbiddenCandidateCount: 0,
        allowlistIgnoredForbidden: 0,
      },
    });
    const missingRun = record({
      correlation: { runId: "", ingress: "chat", tenantHash: "0123456789abcdef" },
    });
    const fabricated = record({
      correlation: {
        runId: "run-same",
        ingress: "chat",
        tenantHash: "0123456789abcdef",
        objectiveId: "run-same",
        revision: 1,
      },
    });
    const report = summarizeObservation({
      records: [leaked, missingRun, fabricated],
      nowMs: NOW,
      runtimeResultChanged: true,
      coordinationWritesDetected: true,
      logCorrespondsToLandedSha: false,
    });
    expect(report.mustStop).toBe(true);
    expect(report.stopConditionsTriggered).toEqual(
      expect.arrayContaining([
        "forbiddenWriteAttempts",
        "coordination_writes",
        "runtime_result_changed",
        "plaintext_leak",
        "missing_run_id",
        "fabricated_identity",
        "log_not_tied_to_landed_sha",
      ]),
    );
    expect(report.leakCategories).toContain("email");
    expect(formatObservationReportMarkdown(report)).not.toContain("user@example.com");
  });

  it("counts JSONL lines after the 7-day clock close as writesAfterWindowClose", () => {
    const report = summarizeObservation({
      records: [
        record({
          observedAtMs: NOW,
          correlation: { runId: "run-a", ingress: "chat", tenantHash: "0123456789abcdef" },
        }),
        record({
          observedAtMs: NOW + SHADOW_WINDOW_MS,
          correlation: { runId: "run-b", ingress: "chat", tenantHash: "0123456789abcdef" },
        }),
      ],
      window: {
        firstWriteAtMs: NOW,
        counts: { chat: 2 },
        seenRunIds: ["run-a", "run-b"],
        stopped: false,
      },
      nowMs: NOW + SHADOW_WINDOW_MS + 1,
    });
    expect(report.writesAfterWindowClose).toBe(1);
    expect(report.windowClosedByClock).toBe(true);
    expect(report.stopConditionsTriggered).toContain("write_after_window_close");
  });
});

describe("scanShadowPayloadForLeaks", () => {
  it("does not treat timestamps or hex hashes as leaks", () => {
    expect(scanShadowPayloadForLeaks(JSON.stringify(record()))).toEqual([]);
  });

  it("classifies email, token, phone, and absolute path without returning the secret", () => {
    const leaked = {
      note: "user@example.com",
      token: "sk-testtokenvalue",
      phone: "13800138000",
      path: "/Users/someone/secret/task.md",
    };
    const categories = scanShadowPayloadForLeaks(JSON.stringify(leaked));
    expect(categories).toEqual(
      expect.arrayContaining(["email", "token", "phone", "absolute_path"]),
    );
    expect(categories.join(" ")).not.toContain("user@example.com");
    expect(categories.join(" ")).not.toContain("sk-testtokenvalue");
  });
});

describe("detectFabricatedIdentity", () => {
  it("flags objectiveId copied from runId and constant cron revision=1", () => {
    const flags = detectFabricatedIdentity([
      record({
        correlation: {
          runId: "occ-1",
          ingress: "cron_isolated",
          cronOccurrenceId: "occ-1",
          objectiveId: "occ-1",
          revision: 1,
          source: "cron",
          tenantHash: "0123456789abcdef",
        },
      }),
      record({
        correlation: {
          runId: "occ-2",
          ingress: "cron_isolated",
          cronOccurrenceId: "occ-2",
          objectiveId: "occ-2",
          revision: 1,
          source: "cron",
          tenantHash: "0123456789abcdef",
        },
      }),
    ]);
    expect(flags).toEqual(
      expect.arrayContaining([
        "objective_equals_run_id",
        "objective_equals_occurrence",
        "cron_constant_revision_one",
      ]),
    );
  });
});

describe("replay remains write-free", () => {
  it("replays the observe pure function only", () => {
    const input: ShadowObserveInput = {
      schemaVersion: OBJECTIVE_SHADOW_SCHEMA,
      tenantId: "tenant-a",
      ingress: "chat",
      runId: "run-replay",
      candidates: [{ source: "conversation_task", objectiveId: "task-obj-1", revision: 4 }],
      observedAtMs: NOW,
    };
    const first = replayObserve(input, {
      tenantHash: "0123456789abcdef",
      nowMs: NOW,
    });
    const second = replayObserve(input, {
      tenantHash: "0123456789abcdef",
      nowMs: NOW,
    });
    expect(first.hash).toBe(second.hash);
    expect(first.record.resolveStatus).toBe("resolved");
  });
});
