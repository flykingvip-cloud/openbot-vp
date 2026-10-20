import { describe, expect, it } from "vitest";
import {
  STOP_WHEN,
  collectFacts,
  deriveCompletion,
  evaluateStopWhen,
  matchStopWhen,
} from "./stop-when.js";
import type { DiagnosticEvidence, EvidenceRequirement } from "./types.js";

function evidence(
  source: DiagnosticEvidence["source"],
  summary: DiagnosticEvidence["summary"],
  completeness: DiagnosticEvidence["collection"]["completeness"] = "partial",
  attributionResolution: DiagnosticEvidence["collection"]["attributionResolution"] = "not_applicable",
): DiagnosticEvidence {
  return {
    schemaVersion: 1,
    evidenceId: `ev-${source}`,
    evidenceType: "event",
    source,
    authority: "test",
    authorityRecordId: `rec-${source}`,
    observedAt: "2026-09-01T10:00:00.000Z",
    target: {
      schemaVersion: 1,
      targetType: "run",
      targetId: "t",
      tenantId: "tenant-fixture-a",
      authority: source,
      scope: {},
    },
    summary,
    collection: { method: "query", completeness, attributionResolution },
    privacy: { classification: "internal", redacted: true },
  };
}

function routeMissing(): EvidenceRequirement {
  return {
    schemaVersion: 1,
    evidenceType: "event",
    source: "route_resolution",
    targetType: "session",
    fields: ["matchedBy"],
    sensitivity: "internal",
    cost: "low",
    required: true,
  };
}

const PLAN_STOP_WHEN = [
  STOP_WHEN.MESSAGE_NOT_RECEIVED,
  STOP_WHEN.AGENT_NOT_STARTED_CONFIRMED,
  STOP_WHEN.SKILL_NOT_TRIGGERED_CONFIRMED,
  STOP_WHEN.ATTRIBUTION_UNCERTAIN_PROBABLE,
  STOP_WHEN.TOOL_TIMEOUT_CONFIRMED,
  STOP_WHEN.ROUTE_MISSING_INCONCLUSIVE,
];

describe("deriveCompletion from stopWhen + collection", () => {
  it("keeps scene 1 CONFIRMED when agent_runner is complete and route is still missing", () => {
    const collected = [
      evidence("session_store", { messageReceived: true }),
      evidence("agent_runner", { agentStarted: false, agentCompleted: false }, "complete"),
    ];
    const missing = [routeMissing()];
    expect(collectFacts(collected, missing).agentRunnerComplete).toBe(true);
    expect(collectFacts(collected, missing).routeMissing).toBe(true);
    expect(
      evaluateStopWhen(STOP_WHEN.AGENT_NOT_STARTED_CONFIRMED, collectFacts(collected, missing)),
    ).toBe("CONFIRMED");
    expect(deriveCompletion({ stopWhen: PLAN_STOP_WHEN, collected, missing })).toBe("CONFIRMED");
  });

  it("prefers scene 2 CONFIRMED over PROBABLE when skill did not start", () => {
    const collected = [
      evidence("agent_runner", { agentStarted: true, agentCompleted: true }, "complete"),
      evidence(
        "skill_invocation",
        { skillStarted: false, attributionResolution: "none" },
        "complete",
        "none",
      ),
    ];
    expect(deriveCompletion({ stopWhen: PLAN_STOP_WHEN, collected, missing: [] })).toBe(
      "CONFIRMED",
    );
  });

  it("derives scene 5 PROBABLE only after skill started with weak attribution", () => {
    const collected = [
      evidence(
        "skill_invocation",
        { skillStarted: true, attributionResolution: "unique_owner" },
        "complete",
        "unique_owner",
      ),
    ];
    expect(
      deriveCompletion({ stopWhen: PLAN_STOP_WHEN, collected, missing: [routeMissing()] }),
    ).toBe("PROBABLE");
  });

  it("derives scene 6 INCONCLUSIVE when agent_runner is incomplete and route is missing", () => {
    const collected = [evidence("session_store", { messageReceived: true })];
    expect(
      deriveCompletion({ stopWhen: PLAN_STOP_WHEN, collected, missing: [routeMissing()] }),
    ).toBe("INCONCLUSIVE");
  });

  it("matchStopWhen returns null when the current step should keep collecting", () => {
    const collected = [evidence("session_store", { messageReceived: true })];
    expect(
      matchStopWhen({
        stopWhen: [STOP_WHEN.MESSAGE_NOT_RECEIVED],
        collected,
        missing: [],
      }),
    ).toBeNull();
  });
});
