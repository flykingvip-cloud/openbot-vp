import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DIAGNOSIS_CANDIDATE_PUBLIC_SUBMIT_FIELDS,
  DIAGNOSIS_CANDIDATE_PUBLIC_SUBMIT_FORBIDDEN_FIELDS,
  DIAGNOSIS_INGEST_ADMIT_IS_SERVER_RESOLVED_VIEW,
  admitDiagnosisIngest,
  assertCommandDoesNotRebindCandidate,
  diagnosisIngestDedupKey,
  diagnosisIngestProposalCreatedEventId,
  ledgerActionForWalStep,
  missingDiagnosisIngestWalSteps,
  recoverDiagnosisIngestWal,
  type DiagnosisIngestAdmitInput,
  type DiagnosisIngestWalRecord,
} from "./diagnosis-ingest-wal.js";

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "diagnosis-ingest-wal.ts"),
  "utf8",
);

function admit(over: Partial<DiagnosisIngestAdmitInput> = {}): DiagnosisIngestAdmitInput {
  return {
    commandId: "cmd-1",
    grantId: "grant-1",
    grantActive: true,
    trustedTenantId: "tenant-a",
    surfaceId: "agent.working-dna",
    targetKey: "agent:bot-1",
    targetKnown: true,
    mechanism: "working-style-delta",
    candidateVersion: "v1",
    contentHash: "hash-1",
    reportId: "report-ignored",
    ...over,
  };
}

function record(over: Partial<DiagnosisIngestWalRecord> = {}): DiagnosisIngestWalRecord {
  return {
    commandId: "cmd-1",
    proposalId: "prop-1",
    candidateRef: "cand-1",
    surfaceId: "agent.working-dna",
    contentHash: "hash-1",
    tenantScope: "tenant-a",
    targetKey: "agent:bot-1",
    mechanism: "working-style-delta",
    candidateVersion: "v1",
    grantId: "grant-1",
    state: "pending",
    ledgerEventIds: [],
    ...over,
  };
}

describe("diagnosis ingest WAL fixtures", () => {
  it("does not import registerProposal or live diagnosis modules", () => {
    expect(SOURCE).not.toMatch(/\bregisterProposal\s*\(/);
    expect(SOURCE).not.toMatch(/from ["'].*diagnosis/);
    expect(SOURCE).not.toMatch(/\bsubmitDiagnosisCandidate\s*\(/);
  });

  it("marks admit as a server-resolved view and keeps those fields off the public submit", () => {
    expect(DIAGNOSIS_INGEST_ADMIT_IS_SERVER_RESOLVED_VIEW).toBe(true);
    expect(DIAGNOSIS_CANDIDATE_PUBLIC_SUBMIT_FIELDS).toEqual([
      "commandId",
      "candidate",
      "trustedContext",
      "grantId",
    ]);
    expect(DIAGNOSIS_CANDIDATE_PUBLIC_SUBMIT_FORBIDDEN_FIELDS).toEqual([
      "grantActive",
      "targetKnown",
      "claimedTenantId",
    ]);
  });

  it("fail-closes with zero writes", () => {
    expect(admitDiagnosisIngest(admit({ grantId: "" }))).toEqual({
      ok: false,
      code: "grant_missing",
      writes: [],
    });
    expect(admitDiagnosisIngest(admit({ grantActive: false }))).toEqual({
      ok: false,
      code: "grant_inactive",
      writes: [],
    });
    expect(admitDiagnosisIngest(admit({ claimedTenantId: "tenant-b" }))).toEqual({
      ok: false,
      code: "cross_tenant",
      writes: [],
    });
    expect(admitDiagnosisIngest(admit({ targetKnown: false }))).toEqual({
      ok: false,
      code: "unknown_target",
      writes: [],
    });
    expect(admitDiagnosisIngest(admit({ surfaceId: "system.secrets" }))).toEqual({
      ok: false,
      code: "forbidden_surface",
      writes: [],
    });
    expect(admitDiagnosisIngest(admit({ surfaceId: "capability.skill-spec" }))).toEqual({
      ok: false,
      code: "unsupported_surface",
      writes: [],
    });
    expect(admitDiagnosisIngest(admit({ surfaceId: "knowledge.experience-capsule" }))).toEqual({
      ok: false,
      code: "unsupported_surface",
      writes: [],
    });
  });

  it("admits explicit existing-skill installation without admitting skill-spec", () => {
    const admitted = admitDiagnosisIngest(
      admit({
        surfaceId: "capability.skill-installation",
        targetKey: "capability:briefing:agent:bot-1",
        mechanism: "diagnosis.capability.skill_installation_intent",
      }),
    );
    expect(admitted).toEqual({
      ok: true,
      surfaceId: "capability.skill-installation",
      dedupKey: diagnosisIngestDedupKey({
        tenantScope: "tenant-a",
        surfaceId: "capability.skill-installation",
        targetKey: "capability:briefing:agent:bot-1",
        mechanism: "diagnosis.capability.skill_installation_intent",
        candidateVersion: "v1",
      }),
    });
  });

  it("excludes reportId from the dedup key", () => {
    const admitted = admitDiagnosisIngest(admit());
    expect(admitted.ok).toBe(true);
    if (admitted.ok) {
      expect(admitted.dedupKey).toBe(
        diagnosisIngestDedupKey({
          tenantScope: "tenant-a",
          surfaceId: "agent.working-dna",
          targetKey: "agent:bot-1",
          mechanism: "working-style-delta",
          candidateVersion: "v1",
        }),
      );
      expect(admitted.dedupKey).not.toContain("report-ignored");
    }
  });

  it("keeps commandId idempotent and refuses candidate rebinding", () => {
    const existing = record({ candidateRef: "cand-1", contentHash: "hash-1" });
    expect(
      assertCommandDoesNotRebindCandidate({
        existing,
        commandId: "cmd-1",
        contentHash: "hash-1",
        candidateRef: "cand-1",
      }),
    ).toEqual({ ok: true });
    expect(
      assertCommandDoesNotRebindCandidate({
        existing,
        commandId: "cmd-1",
        contentHash: "hash-2",
        candidateRef: "cand-2",
      }),
    ).toEqual({ ok: false, code: "command_rebind" });
  });

  it("appends only proposal.created and never emits a committed ledger event", () => {
    const eventId = diagnosisIngestProposalCreatedEventId("cmd-1");
    expect(eventId).toBe("led:cmd-1:proposal.created");
    expect(
      ledgerActionForWalStep({
        commandId: "cmd-1",
        step: "proposal_written",
        existingEventIds: [],
      }),
    ).toEqual({ appendEventIds: [], advanceReceiptOnly: true });
    expect(
      ledgerActionForWalStep({
        commandId: "cmd-1",
        step: "committed",
        existingEventIds: [],
      }),
    ).toEqual({ appendEventIds: [], advanceReceiptOnly: true });
    expect(
      ledgerActionForWalStep({
        commandId: "cmd-1",
        step: "ledger_written",
        existingEventIds: [],
      }),
    ).toEqual({ appendEventIds: [eventId], advanceReceiptOnly: false });
    expect(
      ledgerActionForWalStep({
        commandId: "cmd-1",
        step: "ledger_written",
        existingEventIds: [eventId],
      }),
    ).toEqual({ appendEventIds: [], advanceReceiptOnly: true });
  });

  it("recovers forward without deleting or duplicating ledger events", () => {
    expect(missingDiagnosisIngestWalSteps("pending")).toEqual([
      "proposal_written",
      "candidate_written",
      "ledger_written",
      "committed",
    ]);
    const eventId = diagnosisIngestProposalCreatedEventId("cmd-1");
    const recovered = recoverDiagnosisIngestWal(
      record({
        state: "candidate_written",
        ledgerEventIds: [],
      }),
    );
    expect(recovered.deleteLedger).toBe(false);
    expect(recovered.resumeFrom).toBe("candidate_written");
    expect(recovered.stepsToApply).toEqual(["ledger_written", "committed"]);
    expect(recovered.ledgerAppends).toEqual([eventId]);

    const alreadyWritten = recoverDiagnosisIngestWal(
      record({
        state: "candidate_written",
        ledgerEventIds: [eventId],
      }),
    );
    expect(alreadyWritten.ledgerAppends).toEqual([]);
    expect(alreadyWritten.stepsToApply).toEqual(["ledger_written", "committed"]);
  });
});
