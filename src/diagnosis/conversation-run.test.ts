import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createConversationDiagnosisMachine,
  createMemoryConversationDiagnosisStore,
  isConversationDiagnosisTerminal,
} from "./conversation-run.js";
import type { DiagnosticSignal } from "./signal.js";
import { isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };

function target(over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId: TENANT_A,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
    ...over,
  };
}

function principal(over: Partial<DiagnosticPrincipal> = {}): DiagnosticPrincipal {
  return {
    schemaVersion: 1,
    principalId: "user-a",
    kind: "user",
    tenantId: TENANT_A,
    ...over,
  };
}

function signal(over: Partial<DiagnosticSignal> = {}): DiagnosticSignal {
  return {
    schemaVersion: 1,
    signalId: "sig:scheduled:tenant-fixture-a:session:session-a:inspection_scheduled:1",
    kind: "scheduled",
    tenantId: TENANT_A,
    fingerprint: "scheduled|tenant-fixture-a|session:session-a|inspection_scheduled",
    status: "open",
    target: target(),
    evidenceIds: ["ev-a"],
    findingIds: ["find-a"],
    caseId: "case-open",
    completion: "CONFIRMED",
    reasonCode: "inspection_scheduled",
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: "2026-09-03T02:00:00.000Z",
    lastSeenAt: "2026-09-03T02:00:00.000Z",
    expiresAt: "2026-09-03T03:00:00.000Z",
    ...over,
  };
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (err) {
    expect(isDiagnosisContractError(err)).toBe(true);
    if (isDiagnosisContractError(err)) {
      expect(err.code).toBe(code);
    }
  }
}

describe("Phase 6 — conversation diagnosis state machine", () => {
  it("walks the happy path and records auditable transitions", () => {
    const machine = createConversationDiagnosisMachine({
      now: () => Date.parse("2026-09-03T03:00:00.000Z"),
    });
    const actor = { principal: principal(), trusted: TRUSTED_A };
    const started = machine.dispatch({
      commandId: "cmd-start",
      command: "start",
      signal: signal(),
      ...actor,
    });
    expect(started.state).toBe("TRIAGING");
    expect(started.idempotent).toBe(false);
    expect(
      machine.dispatch({ commandId: "cmd-start", command: "start", signal: signal(), ...actor }),
    ).toEqual({
      ...started,
      idempotent: true,
    });

    expect(
      machine.dispatch({
        commandId: "cmd-ask",
        command: "ask",
        conversationRunId: started.conversationRunId,
        question: "which skill timed out?",
        ...actor,
      }).state,
    ).toBe("TRIAGING");
    expect(
      machine.dispatch({
        commandId: "cmd-answer-1",
        command: "answer",
        conversationRunId: started.conversationRunId,
        answer: "skill-runtime",
        diagnoserId: "skill-runtime",
        evidenceSourceId: "skill_invocation",
        evidenceRefs: ["ev-a"],
        ...actor,
      }).state,
    ).toBe("COLLECTING_EVIDENCE");
    expect(
      machine.dispatch({
        commandId: "cmd-answer-2",
        command: "answer",
        conversationRunId: started.conversationRunId,
        ...actor,
      }).state,
    ).toBe("DIAGNOSING");
    expect(
      machine.dispatch({
        commandId: "cmd-answer-3",
        command: "answer",
        conversationRunId: started.conversationRunId,
        findingRefs: ["find-a"],
        hypothesisRef: "hyp-timeout",
        ...actor,
      }).state,
    ).toBe("VERIFYING");
    const resolved = machine.dispatch({
      commandId: "cmd-answer-4",
      command: "answer",
      conversationRunId: started.conversationRunId,
      recommendationRef: "rec-retry",
      ...actor,
    });
    expect(resolved.state).toBe("RESOLVED");
    expect(isConversationDiagnosisTerminal(resolved.state)).toBe(true);
    const run = machine.get(started.conversationRunId);
    expect(run?.lastEvidenceRefs).toEqual(["ev-a"]);
    expect(run?.lastFindingRefs).toEqual(["find-a"]);
    expect(run?.hypothesisRefs).toEqual(["hyp-timeout"]);
    expect(run?.audit.map((event) => `${event.from}->${event.to}`)).toContain("DETECTED->TRIAGING");
    expect(run?.audit.map((event) => event.command)).toContain("answer");
  });

  it("rejects illegal transitions and model-as-RCA", () => {
    const machine = createConversationDiagnosisMachine({
      now: () => Date.parse("2026-09-03T03:10:00.000Z"),
    });
    const actor = { principal: principal(), trusted: TRUSTED_A };
    const started = machine.dispatch({
      commandId: "cmd-start-illegal",
      command: "start",
      signal: signal({ signalId: "sig-illegal" }),
      ...actor,
    });
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-approve-early",
          command: "approve",
          conversationRunId: started.conversationRunId,
          ...actor,
        }),
      "illegal_transition",
    );
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-model-rca",
          command: "answer",
          conversationRunId: started.conversationRunId,
          hypothesisRef: "MODEL_INFERRED",
          ...actor,
        }),
      "model_rca_forbidden",
    );
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-unknown-ev",
          command: "answer",
          conversationRunId: started.conversationRunId,
          evidenceRefs: ["ev-forged"],
          ...actor,
        }),
      "unknown_evidence_ref",
    );
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-bad-diagnoser",
          command: "answer",
          conversationRunId: started.conversationRunId,
          diagnoserId: "not-a-diagnoser",
          ...actor,
        }),
      "unregistered_diagnoser",
    );
    machine.dispatch({
      commandId: "cmd-cancel-illegal",
      command: "cancel",
      conversationRunId: started.conversationRunId,
      ...actor,
    });
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-answer-cancelled",
          command: "answer",
          conversationRunId: started.conversationRunId,
          ...actor,
        }),
      "illegal_transition",
    );
  });

  it("pauses collection, waits for authorization, and resumes the same run", () => {
    const machine = createConversationDiagnosisMachine({
      now: () => Date.parse("2026-09-03T03:20:00.000Z"),
    });
    const actor = { principal: principal(), trusted: TRUSTED_A };
    const started = machine.dispatch({
      commandId: "cmd-start-auth",
      command: "start",
      signal: signal({ signalId: "sig-auth" }),
      ...actor,
    });
    machine.dispatch({
      commandId: "cmd-pause",
      command: "pause",
      conversationRunId: started.conversationRunId,
      ...actor,
    });
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-answer-paused",
          command: "answer",
          conversationRunId: started.conversationRunId,
          ...actor,
        }),
      "collection_paused",
    );
    expect(
      machine.dispatch({
        commandId: "cmd-pause",
        command: "pause",
        conversationRunId: started.conversationRunId,
        ...actor,
      }).idempotent,
    ).toBe(true);
    machine.dispatch({
      commandId: "cmd-resume",
      command: "resume",
      conversationRunId: started.conversationRunId,
      ...actor,
    });
    const waiting = machine.dispatch({
      commandId: "cmd-need-auth",
      command: "ask",
      conversationRunId: started.conversationRunId,
      question: "approve session read?",
      authorization: {
        authorizationId: "auth-1",
        capability: "diagnosis:read",
        expiresAt: "2026-09-03T04:20:00.000Z",
      },
      ...actor,
    });
    expect(waiting.state).toBe("WAITING_AUTHORIZATION");
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-collect-while-waiting",
          command: "answer",
          conversationRunId: started.conversationRunId,
          ...actor,
        }),
      "collection_paused",
    );
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-resume-while-waiting",
          command: "resume",
          conversationRunId: started.conversationRunId,
          ...actor,
        }),
      "authorization_required",
    );
    const approved = machine.dispatch({
      commandId: "cmd-approve",
      command: "approve",
      conversationRunId: started.conversationRunId,
      ...actor,
    });
    expect(approved.state).toBe("TRIAGING");
    expect(approved.conversationRunId).toBe(started.conversationRunId);
    expect(
      machine.dispatch({
        commandId: "cmd-approve",
        command: "approve",
        conversationRunId: started.conversationRunId,
        ...actor,
      }).idempotent,
    ).toBe(true);
    expect(machine.get(started.conversationRunId)?.requiredAuthorization?.status).toBe("granted");
    expect(
      machine.dispatch({
        commandId: "cmd-revoke",
        command: "deny",
        conversationRunId: started.conversationRunId,
        ...actor,
      }).state,
    ).toBe("INCONCLUSIVE");
    expect(machine.get(started.conversationRunId)?.requiredAuthorization?.status).toBe("revoked");
  });

  it("deny, cancel, and timeout stop collection; timeout can escalate", () => {
    const machine = createConversationDiagnosisMachine({
      now: () => Date.parse("2026-09-03T03:30:00.000Z"),
    });
    const actor = { principal: principal(), trusted: TRUSTED_A };
    const denied = machine.dispatch({
      commandId: "cmd-start-deny",
      command: "start",
      signal: signal({ signalId: "sig-deny" }),
      ...actor,
    });
    machine.dispatch({
      commandId: "cmd-ask-deny",
      command: "ask",
      conversationRunId: denied.conversationRunId,
      authorization: {
        authorizationId: "auth-deny",
        capability: "diagnosis:read",
        expiresAt: "2026-09-03T04:30:00.000Z",
      },
      ...actor,
    });
    expect(
      machine.dispatch({
        commandId: "cmd-deny",
        command: "deny",
        conversationRunId: denied.conversationRunId,
        ...actor,
      }).state,
    ).toBe("INCONCLUSIVE");
    expect(machine.get(denied.conversationRunId)?.requiredAuthorization?.status).toBe("denied");
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-collect-denied",
          command: "answer",
          conversationRunId: denied.conversationRunId,
          ...actor,
        }),
      "illegal_transition",
    );

    const cancelled = machine.dispatch({
      commandId: "cmd-start-cancel",
      command: "start",
      signal: signal({ signalId: "sig-cancel" }),
      ...actor,
    });
    expect(
      machine.dispatch({
        commandId: "cmd-cancel",
        command: "cancel",
        conversationRunId: cancelled.conversationRunId,
        ...actor,
      }).state,
    ).toBe("CANCELLED");
    expect(
      machine.dispatch({
        commandId: "cmd-cancel",
        command: "cancel",
        conversationRunId: cancelled.conversationRunId,
        ...actor,
      }).idempotent,
    ).toBe(true);

    const timed = machine.dispatch({
      commandId: "cmd-start-timeout",
      command: "start",
      signal: signal({ signalId: "sig-timeout" }),
      ...actor,
    });
    expect(
      machine.dispatch({
        commandId: "cmd-timeout",
        command: "timeout",
        conversationRunId: timed.conversationRunId,
        ...actor,
      }).state,
    ).toBe("INCONCLUSIVE");
    const escalated = machine.dispatch({
      commandId: "cmd-start-escalate",
      command: "start",
      signal: signal({ signalId: "sig-escalate" }),
      ...actor,
    });
    expect(
      machine.dispatch({
        commandId: "cmd-escalate",
        command: "timeout",
        conversationRunId: escalated.conversationRunId,
        escalate: true,
        ...actor,
      }).state,
    ).toBe("ESCALATED");
  });

  it("isolates tenant/principal and restores snapshots with expired auth", () => {
    const store = createMemoryConversationDiagnosisStore();
    let nowMs = Date.parse("2026-09-03T03:40:00.000Z");
    const machine = createConversationDiagnosisMachine({ now: () => nowMs, store });
    const actorA = { principal: principal(), trusted: TRUSTED_A };
    const started = machine.dispatch({
      commandId: "cmd-start-iso",
      command: "start",
      signal: signal({ signalId: "sig-iso" }),
      ...actorA,
    });
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-other-principal",
          command: "ask",
          conversationRunId: started.conversationRunId,
          question: "x",
          principal: principal({ principalId: "user-b" }),
          trusted: TRUSTED_A,
        }),
      "principal_mismatch",
    );
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-other-tenant",
          command: "ask",
          conversationRunId: started.conversationRunId,
          question: "x",
          principal: principal({ tenantId: TENANT_B }),
          trusted: { tenantId: TENANT_B },
        }),
      "tenant_mismatch",
    );
    expect(machine.list(TENANT_A)).toHaveLength(1);
    expect(machine.list(TENANT_B)).toEqual([]);

    machine.dispatch({
      commandId: "cmd-ask-exp",
      command: "ask",
      conversationRunId: started.conversationRunId,
      authorization: {
        authorizationId: "auth-exp",
        capability: "diagnosis:read",
        expiresAt: "2026-09-03T03:41:00.000Z",
      },
      ...actorA,
    });
    const snapshot = machine.get(started.conversationRunId);
    expect(snapshot).toBeDefined();
    nowMs += 120_000;
    const restored = machine.restore(snapshot!, TRUSTED_A);
    expect(restored.requiredAuthorization?.status).toBe("expired");
    expect(restored.conversationRunId).toBe(started.conversationRunId);
    expectCode(
      () =>
        machine.dispatch({
          commandId: "cmd-approve-expired",
          command: "approve",
          conversationRunId: started.conversationRunId,
          ...actorA,
        }),
      "authorization_expired",
    );
    expectCode(() => machine.restore(snapshot!, { tenantId: TENANT_B }), "tenant_mismatch");

    const replay = createConversationDiagnosisMachine({ now: () => nowMs });
    replay.restore(restored, TRUSTED_A);
    expect(replay.get(started.conversationRunId)?.state).toBe("WAITING_AUTHORIZATION");
    expect(replay.get(started.conversationRunId)?.requiredAuthorization?.status).toBe("expired");
  });

  it("does not call live chat, transcript, Doctor fix, or channel writes", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "conversation-run.ts"),
      "utf8",
    );
    expect(source).toContain("Does not call live Da Bai");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("user.daibai.execute");
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("writeConfigFile");
    expect(source).not.toContain("runDoctorFix");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain('from "../gateway/server-methods/daibai');
    expect(source).not.toContain('from "../commands/doctor');
  });
});
