import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createMemoryCompletionLedger,
  type CompletionLedgerRecord,
  type DiagnosisRecheckResult,
} from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DiagnosisReceiptFailClosedError,
  hashDiagnosisM1ReceiptPayload,
  loadDiagnosisRecheckReceipt,
  lookupDiagnosisM1Closure,
  persistDiagnosisRecheckReceipt,
  projectDiagnosisM1Closure,
  readDiagnosisM1Status,
  resetDiagnosisM1ReceiptsForTests,
  setDiagnosisReceiptAtomicWriteForTests,
  setDiagnosisReceiptBuildInfoForTests,
  userVisibleStatus,
  type DiagnosisM1ReceiptRecord,
  type DiagnosisRecheckReceiptDraft,
} from "./diagnosis-m1-status.js";
import { createFileEvolutionLedger } from "./persistent-store.js";

const TENANT = "001";
const PROPOSAL = "evo:diag:1";

function receiptResult(over: Partial<DiagnosisRecheckResult> = {}): DiagnosisRecheckResult {
  return { ...baseResult(), ...over };
}

function baseResult(): DiagnosisRecheckResult {
  return {
    outcome: "STILL_OPEN",
    reasonCode: "sot_unchanged",
    findingRefs: ["abc"],
    target: { domain: "agent" as const, agentId: "a8-m1-isolated" },
    verificationRef: {
      schemaVersion: 1 as const,
      proposalId: PROPOSAL,
      experimentId: "exp-1",
      applicationId: "app-1",
      verificationId: "ver-1",
    },
    observedEvidenceRefs: ["obs:recheck:style"],
  };
}

function closedLoopLedger(includePromotion: boolean) {
  const target = { domain: "agent" as const, agentId: "a8-m1-isolated" };
  const candidate = "c5fda4dba439f8c00084c650da491f0c450c7976a9c16a0644d90e1e2aceb255";
  const candidateRef = "cand:diag:c5fda4dba439f8c00084c650da491f0c";
  const records: CompletionLedgerRecord[] = [
    {
      kind: "proposal",
      body: {
        proposalId: PROPOSAL,
        status: "VERIFIED",
        tenantScope: TENANT,
        surfaceId: "agent.working-dna",
        candidateRef,
        target,
      },
    },
    {
      kind: "experiment",
      body: {
        experimentId: "exp-1",
        proposalId: PROPOSAL,
        surfaceId: "agent.working-dna",
        tenantScope: TENANT,
        candidateRef,
      },
    },
    {
      kind: "application",
      body: {
        applicationId: "app-1",
        proposalId: PROPOSAL,
        experimentId: "exp-1",
        status: "applied",
      },
    },
    {
      kind: "verification",
      proposalId: PROPOSAL,
      experimentId: "exp-1",
      body: {
        verificationId: "ver-1",
        applicationId: "app-1",
        outcome: "improved",
        verifiedAt: "2026-09-22T09:00:00.000Z",
      },
    },
    {
      kind: "recheck",
      tenantId: TENANT,
      recordedAt: "2026-09-22T09:30:00.000Z",
      body: receiptResult({ outcome: "RESOLVED", reasonCode: "sot_confirmed" }),
    },
  ];
  if (includePromotion) {
    records.push({
      kind: "event",
      event: {
        eventId: "evt-promotion-001",
        type: "promotion.completed",
        tenantScope: TENANT,
        proposalId: PROPOSAL,
        experimentId: "exp-1",
        applicationId: "app-1",
        verificationId: "ver-1",
        target,
        surfaceId: "agent.working-dna",
        candidateRef,
        principalRef: "operator-1",
        timestamp: "2026-09-22T10:00:00.000Z",
      },
    });
  }
  return {
    reader: createMemoryCompletionLedger(records),
    query: {
      tenantId: TENANT,
      proposalId: PROPOSAL,
      experimentId: "exp-1",
      applicationId: "app-1",
    },
    target,
    surfaceId: "agent.working-dna",
    candidateVersion: candidate,
    authorityOk: true,
    guardrailDegraded: false,
    evaluation: { action: "promote" as const, reasonCode: "evaluation_passed" },
  };
}

function draft(over: Partial<DiagnosisRecheckReceiptDraft> = {}): DiagnosisRecheckReceiptDraft {
  const result = over.result ?? receiptResult();
  return {
    receiptId: "recheck:app-1",
    proposalId: PROPOSAL,
    experimentId: "exp-1",
    applicationId: "app-1",
    verificationId: "ver-1",
    tenantId: TENANT,
    target: "agent:a8-m1-isolated",
    operatorId: "operator-1",
    commandId: "cmd-1",
    candidateVersion: "abc",
    result,
    applicationVerified: true,
    ...over,
  };
}

function seedReceiptChain(dir: string): void {
  writeFileSync(
    path.join(dir, "proposals.json"),
    JSON.stringify({
      [PROPOSAL]: {
        proposalId: PROPOSAL,
        status: "VERIFIED",
        tenantScope: TENANT,
        surfaceId: "agent.working-dna",
        candidateRef: "abc",
        target: { domain: "agent", agentId: "a8-m1-isolated" },
      },
    }),
  );
  writeFileSync(
    path.join(dir, "experiments.json"),
    JSON.stringify({
      "exp-1": {
        experimentId: "exp-1",
        proposalId: PROPOSAL,
        surfaceId: "agent.working-dna",
        tenantScope: TENANT,
        candidateRef: "abc",
        result: "improved",
      },
    }),
  );
  writeFileSync(
    path.join(dir, "applications.json"),
    JSON.stringify({
      "app-1": {
        applicationId: "app-1",
        proposalId: PROPOSAL,
        experimentId: "exp-1",
        status: "applied",
      },
    }),
  );
  writeFileSync(
    path.join(dir, "verifications.json"),
    JSON.stringify({
      "ver-1": {
        verificationId: "ver-1",
        applicationId: "app-1",
        outcome: "improved",
        verifiedAt: "2026-09-22T09:00:00.000Z",
        sampleSize: 20,
        confidence: 0.95,
        guardrailResults: [],
      },
    }),
  );
  const ledgerPath = path.join(dir, "ledger.jsonl");
  const ledger = createFileEvolutionLedger(ledgerPath);
  ledger.append({
    eventId: "evt-approved",
    type: "application.approved",
    timestamp: "2026-09-22T09:05:00.000Z",
    proposalId: PROPOSAL,
    target: { domain: "agent", agentId: "a8-m1-isolated" },
    surfaceId: "agent.working-dna",
    tenantScope: TENANT,
    principalRef: "operator-1",
    grantId: "grant-1",
    evidenceRefs: [],
    experimentId: "exp-1",
    applicationId: "app-1",
  });
  ledger.append({
    eventId: "evt-external",
    type: "external_effect.recorded",
    timestamp: "2026-09-22T09:10:00.000Z",
    proposalId: PROPOSAL,
    target: { domain: "agent", agentId: "a8-m1-isolated" },
    surfaceId: "agent.working-dna",
    tenantScope: TENANT,
    principalRef: "operator-1",
    grantId: "grant-1",
    evidenceRefs: [],
    experimentId: "exp-1",
    applicationId: "app-1",
    externalEffectOutcome: "verified",
  });
  ledger.append({
    eventId: "evt-drill",
    type: "rollback_drill.completed",
    timestamp: "2026-09-22T09:15:00.000Z",
    proposalId: PROPOSAL,
    target: { domain: "agent", agentId: "a8-m1-isolated" },
    surfaceId: "agent.working-dna",
    tenantScope: TENANT,
    principalRef: "operator-1",
    grantId: "grant-1",
    evidenceRefs: [],
    experimentId: "exp-1",
    applicationId: "app-1",
    drillId: "drill-1",
  });
  if (!existsSync(ledgerPath)) {
    writeFileSync(ledgerPath, "");
  }
}

beforeEach(() => {
  setDiagnosisReceiptBuildInfoForTests(() => ({ commit: "test-build-sha" }));
});

afterEach(() => {
  setDiagnosisReceiptBuildInfoForTests();
  resetDiagnosisM1ReceiptsForTests();
});

describe("projectDiagnosisM1Closure", () => {
  it("keeps VERIFIED + STILL_OPEN ineligible and does not record promotion", () => {
    const closure = projectDiagnosisM1Closure({
      applicationVerified: true,
      diagnosisRecheckOutcome: "STILL_OPEN",
      sotReadable: true,
    });
    expect(closure.promotionEligible).toBe(false);
    expect(closure.promotionStatus).toBe("ineligible");
    expect(closure.recommendation).toBe("hold");
    expect(closure.recordsPromotionCompleted).toBe(false);
    expect(closure.userVisibleStatus).toBe("已验证，进化未完成");
    expect(closure.userVisibleStatus).not.toContain("进化完成");
  });

  it("sends REGRESSED to rollback", () => {
    expect(
      projectDiagnosisM1Closure({
        applicationVerified: true,
        diagnosisRecheckOutcome: "REGRESSED",
        sotReadable: true,
      }),
    ).toMatchObject({
      promotionEligible: false,
      promotionStatus: "ineligible",
      recommendation: "rollback",
      recordsPromotionCompleted: false,
    });
  });

  it("sends INCONCLUSIVE to observe", () => {
    expect(
      projectDiagnosisM1Closure({
        applicationVerified: false,
        diagnosisRecheckOutcome: "INCONCLUSIVE",
        sotReadable: true,
      }),
    ).toMatchObject({
      promotionEligible: false,
      recommendation: "observe",
      userVisibleStatus: "继续观察",
    });
  });

  it("fail-closes BLOCKED and unreadable SoT", () => {
    expect(
      projectDiagnosisM1Closure({
        applicationVerified: true,
        diagnosisRecheckOutcome: "BLOCKED",
        sotReadable: true,
      }).recommendation,
    ).toBe("fail-closed");
    expect(
      projectDiagnosisM1Closure({
        applicationVerified: true,
        diagnosisRecheckOutcome: "RESOLVED",
        sotReadable: false,
      }),
    ).toMatchObject({
      promotionEligible: false,
      recommendation: "fail-closed",
      userVisibleStatus: "无法确认，已停止",
    });
  });

  it("can mark promotion eligible only after the shared contract, without a promotion event", () => {
    const closure = projectDiagnosisM1Closure({
      applicationVerified: true,
      diagnosisRecheckOutcome: "RESOLVED",
      sotReadable: true,
      completionLedger: closedLoopLedger(false),
    });
    expect(closure.promotionEligible).toBe(true);
    expect(closure.promotionStatus).toBe("eligible");
    expect(closure.recommendation).toBe("promote");
    expect(closure.recordsPromotionCompleted).toBe(false);
    expect(closure.userVisibleStatus).toBe("可进入晋升门禁，进化未完成");
    expect(closure.userVisibleStatus).not.toBe("已完成进化");
  });

  it("does not call an unverified RESOLVED result eligible", () => {
    expect(
      projectDiagnosisM1Closure({
        applicationVerified: false,
        diagnosisRecheckOutcome: "RESOLVED",
        sotReadable: true,
      }).promotionEligible,
    ).toBe(false);
  });

  it("reloads a recheck receipt by id from the control directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a10-receipt-"));
    try {
      seedReceiptChain(dir);
      const closure = projectDiagnosisM1Closure({
        applicationVerified: true,
        diagnosisRecheckOutcome: "STILL_OPEN",
        sotReadable: true,
      });
      persistDiagnosisRecheckReceipt(dir, {
        receiptId: "recheck:app-1",
        proposalId: "evo:diag:1",
        experimentId: "exp-1",
        applicationId: "app-1",
        verificationId: "ver-1",
        tenantId: "001",
        target: "agent:a8-m1-isolated",
        operatorId: "operator-1",
        commandId: "cmd-1",
        candidateVersion: "abc",
        result: receiptResult(),
        closure,
      });
      resetDiagnosisM1ReceiptsForTests();
      const loaded = loadDiagnosisRecheckReceipt(dir, {
        tenantId: "001",
        proposalId: "evo:diag:1",
        receiptId: "recheck:app-1",
      });
      expect(loaded?.schemaVersion).toBe(1);
      expect(loaded?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(loaded?.closure.promotionEligible).toBe(false);
      expect(loaded?.result.outcome).toBe("STILL_OPEN");
      expect(loaded?.commandId).toBe("cmd-1");
      expect(loaded?.recheckEvidenceRefs).toEqual(["obs:recheck:style"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never uses 进化完成 as a visible status", () => {
    for (const recommendation of [
      "promote",
      "hold",
      "rollback",
      "observe",
      "fail-closed",
    ] as const) {
      for (const promotionStatus of ["ineligible", "eligible", "completed"] as const) {
        expect(
          userVisibleStatus({
            applicationVerified: true,
            promotionStatus,
            recommendation,
          }),
        ).not.toBe("已完成进化");
      }
    }
  });
});

describe("A11 receipt contract", () => {
  it("replays a receipt after the process cache is cleared", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-restart-"));
    try {
      seedReceiptChain(dir);
      const written = persistDiagnosisRecheckReceipt(dir, draft());
      resetDiagnosisM1ReceiptsForTests();
      const loaded = loadDiagnosisRecheckReceipt(dir, {
        tenantId: TENANT,
        proposalId: PROPOSAL,
        receiptId: written.receiptId,
      });
      expect(loaded).toEqual(written);
      expect(readDiagnosisM1Status(dir, { tenantId: TENANT, proposalId: PROPOSAL })).toMatchObject({
        recommendation: "hold",
        promotionEligible: false,
        userVisibleStatus: "已验证，进化未完成",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fail-closes a tenant, proposal, application, or verification mismatch", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-bind-"));
    try {
      seedReceiptChain(dir);
      persistDiagnosisRecheckReceipt(dir, draft());
      for (const query of [
        { tenantId: "002", proposalId: PROPOSAL, receiptId: "recheck:app-1" },
        { tenantId: TENANT, proposalId: "evo:other", receiptId: "recheck:app-1" },
        {
          tenantId: TENANT,
          proposalId: PROPOSAL,
          receiptId: "recheck:app-1",
          applicationId: "app-other",
        },
        {
          tenantId: TENANT,
          proposalId: PROPOSAL,
          receiptId: "recheck:app-1",
          verificationId: "ver-other",
        },
      ]) {
        expect(() => loadDiagnosisRecheckReceipt(dir, query)).toThrow(
          DiagnosisReceiptFailClosedError,
        );
      }
      expect(() => lookupDiagnosisM1Closure({ tenantId: "", proposalId: PROPOSAL })).toThrow(
        /tenantId is required/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fail-closes a tampered hash and does not return the cached receipt", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-hash-"));
    try {
      seedReceiptChain(dir);
      persistDiagnosisRecheckReceipt(dir, draft());
      const filePath = path.join(dir, "diagnosis-recheck-receipts.json");
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
        receipts: Record<string, DiagnosisM1ReceiptRecord>;
      };
      parsed.receipts["recheck:app-1"].operatorId = "operator-tampered";
      writeFileSync(filePath, JSON.stringify(parsed));
      expect(() =>
        loadDiagnosisRecheckReceipt(dir, {
          tenantId: TENANT,
          proposalId: PROPOSAL,
          receiptId: "recheck:app-1",
        }),
      ).toThrow(/payload hash/);
      expect(lookupDiagnosisM1Closure({ tenantId: TENANT, proposalId: PROPOSAL })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fail-closes a truncated file instead of the in-memory receipt", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-trunc-"));
    try {
      seedReceiptChain(dir);
      persistDiagnosisRecheckReceipt(dir, draft());
      const filePath = path.join(dir, "diagnosis-recheck-receipts.json");
      const raw = readFileSync(filePath, "utf8");
      writeFileSync(filePath, raw.slice(0, Math.floor(raw.length / 2)));
      expect(() =>
        loadDiagnosisRecheckReceipt(dir, {
          tenantId: TENANT,
          proposalId: PROPOSAL,
          receiptId: "recheck:app-1",
        }),
      ).toThrow(DiagnosisReceiptFailClosedError);
      expect(lookupDiagnosisM1Closure({ tenantId: TENANT, proposalId: PROPOSAL })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fail-closes an unknown schema", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-schema-"));
    try {
      writeFileSync(
        path.join(dir, "diagnosis-recheck-receipts.json"),
        `${JSON.stringify({ schemaVersion: 2, receipts: {} })}\n`,
      );
      expect(() => readDiagnosisM1Status(dir, { tenantId: TENANT, proposalId: PROPOSAL })).toThrow(
        /schema/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the previous file when the atomic write fails", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-atomic-"));
    try {
      seedReceiptChain(dir);
      const first = persistDiagnosisRecheckReceipt(dir, draft());
      setDiagnosisReceiptAtomicWriteForTests(() => {
        throw new Error("disk full");
      });
      expect(() =>
        persistDiagnosisRecheckReceipt(
          dir,
          draft({ receiptId: "recheck:app-2", commandId: "cmd-2" }),
        ),
      ).toThrow(/disk full/);
      resetDiagnosisM1ReceiptsForTests();
      const loaded = loadDiagnosisRecheckReceipt(dir, {
        tenantId: TENANT,
        proposalId: PROPOSAL,
        receiptId: first.receiptId,
      });
      expect(loaded?.commandId).toBe("cmd-1");
      expect(loaded?.payloadHash).toBe(first.payloadHash);
    } finally {
      setDiagnosisReceiptAtomicWriteForTests(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a second commandId that changes the bound receipt", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-dup-"));
    try {
      seedReceiptChain(dir);
      const first = persistDiagnosisRecheckReceipt(dir, draft());
      expect(
        persistDiagnosisRecheckReceipt(dir, draft({ createdAt: "2026-09-22T00:00:00.000Z" }))
          .receiptId,
      ).toBe(first.receiptId);
      expect(() => persistDiagnosisRecheckReceipt(dir, draft({ candidateVersion: "fff" }))).toThrow(
        /commandId/,
      );
      const loaded = loadDiagnosisRecheckReceipt(dir, {
        tenantId: TENANT,
        proposalId: PROPOSAL,
        receiptId: first.receiptId,
      });
      expect(loaded?.candidateVersion).toBe("abc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not treat VERIFIED without a recheck as evolution completed", () => {
    const closure = projectDiagnosisM1Closure({
      applicationVerified: true,
      diagnosisRecheckOutcome: null,
      sotReadable: false,
    });
    expect(closure.recommendation).toBe("fail-closed");
    expect(closure.userVisibleStatus).toBe("无法确认，已停止");
    const dir = mkdtempSync(path.join(tmpdir(), "a11-empty-"));
    try {
      expect(readDiagnosisM1Status(dir, { tenantId: TENANT, proposalId: PROPOSAL })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows 已完成进化 only for a bound promotion.completed event", () => {
    const binding = {
      tenantId: TENANT,
      proposalId: PROPOSAL,
      applicationId: "app-1",
      verificationId: "ver-1",
    };
    const resolved = receiptResult({
      outcome: "RESOLVED",
      reasonCode: "sot_confirmed",
    });
    const withoutEvent = projectDiagnosisM1Closure({
      applicationVerified: true,
      diagnosisRecheckOutcome: "RESOLVED",
      sotReadable: true,
      receiptBinding: binding,
    });
    expect(withoutEvent.userVisibleStatus).not.toBe("已完成进化");
    const wrongEvent = projectDiagnosisM1Closure({
      applicationVerified: true,
      diagnosisRecheckOutcome: "RESOLVED",
      sotReadable: true,
      receiptBinding: binding,
      promotionEvent: {
        type: "promotion.completed",
        tenantScope: TENANT,
        proposalId: PROPOSAL,
        applicationId: "app-1",
        verificationId: "ver-other",
      },
    });
    expect(wrongEvent.promotionStatus).toBe("ineligible");
    expect(wrongEvent.promotionEligible).toBe(false);
    expect(wrongEvent.userVisibleStatus).not.toBe("已完成进化");
    const thinEvent = projectDiagnosisM1Closure({
      applicationVerified: true,
      diagnosisRecheckOutcome: "RESOLVED",
      sotReadable: true,
      receiptBinding: binding,
      promotionEvent: {
        type: "promotion.completed",
        tenantScope: TENANT,
        proposalId: PROPOSAL,
        applicationId: "app-1",
        verificationId: "ver-1",
      },
    });
    expect(thinEvent.promotionStatus).not.toBe("completed");
    expect(thinEvent.userVisibleStatus).not.toBe("已完成进化");
    const bound = projectDiagnosisM1Closure({
      applicationVerified: true,
      diagnosisRecheckOutcome: "RESOLVED",
      sotReadable: true,
      completionLedger: closedLoopLedger(true),
    });
    expect(bound.promotionStatus).toBe("completed");
    expect(bound.userVisibleStatus).toBe("已完成进化");
    expect(bound.recordsPromotionCompleted).toBe(false);
    const dir = mkdtempSync(path.join(tmpdir(), "a11-promote-"));
    try {
      seedReceiptChain(dir);
      persistDiagnosisRecheckReceipt(dir, draft({ result: resolved, commandId: "cmd-resolved" }));
      // With ledger application.approved (seed) + RESOLVED, status reaches promote_gate
      // without a promotion.completed event — eligible but not completed.
      expect(readDiagnosisM1Status(dir, { tenantId: TENANT, proposalId: PROPOSAL })).toMatchObject({
        promotionEligible: true,
        promotionStatus: "eligible",
        userVisibleStatus: "可进入晋升门禁，进化未完成",
      });
      expect(() =>
        readDiagnosisM1Status(dir, { tenantId: TENANT, proposalId: PROPOSAL }, {
          type: "promotion.completed",
          tenantScope: TENANT,
          proposalId: PROPOSAL,
          applicationId: "app-1",
          verificationId: "ver-1",
        } as { promotionEventId?: string }),
      ).toThrow(/ledger by eventId/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("projects completed status after promote without false-negatives", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-post-promote-"));
    try {
      seedReceiptChain(dir);
      const resolved = receiptResult({
        outcome: "RESOLVED",
        reasonCode: "sot_confirmed",
      });
      persistDiagnosisRecheckReceipt(
        dir,
        draft({ result: resolved, commandId: "cmd-post-promote" }),
      );
      const ledger = createFileEvolutionLedger(path.join(dir, "ledger.jsonl"));
      const promotedAt = new Date(Date.now() + 60_000).toISOString();
      ledger.append({
        eventId: "evt-promotion-001",
        type: "promotion.completed",
        timestamp: promotedAt,
        proposalId: PROPOSAL,
        target: { domain: "agent", agentId: "a8-m1-isolated" },
        surfaceId: "agent.working-dna",
        tenantScope: TENANT,
        principalRef: "operator-1",
        grantId: "grant-promote",
        evidenceRefs: [],
        experimentId: "exp-1",
        applicationId: "app-1",
        verificationId: "ver-1",
      });
      writeFileSync(
        path.join(dir, "proposals.json"),
        JSON.stringify({
          [PROPOSAL]: {
            proposalId: PROPOSAL,
            status: "PROMOTED",
            tenantScope: TENANT,
            surfaceId: "agent.working-dna",
            candidateRef: "abc",
            target: { domain: "agent", agentId: "a8-m1-isolated" },
          },
        }),
      );
      resetDiagnosisM1ReceiptsForTests();
      expect(readDiagnosisM1Status(dir, { tenantId: TENANT, proposalId: PROPOSAL })).toMatchObject({
        applicationVerified: true,
        diagnosisRecheckOutcome: "RESOLVED",
        promotionEligible: true,
        promotionStatus: "completed",
        userVisibleStatus: "已完成进化",
        recordsPromotionCompleted: false,
      });
      expect(lookupDiagnosisM1Closure({ tenantId: TENANT, proposalId: PROPOSAL })).toMatchObject({
        applicationVerified: true,
        promotionStatus: "completed",
        userVisibleStatus: "已完成进化",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps historical recheck receipt readable after a later application.approved", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-later-approve-"));
    try {
      writeFileSync(
        path.join(dir, "proposals.json"),
        JSON.stringify({
          [PROPOSAL]: {
            proposalId: PROPOSAL,
            status: "VERIFIED",
            tenantScope: TENANT,
            surfaceId: "agent.working-dna",
            candidateRef: "abc",
            target: { domain: "agent", agentId: "a8-m1-isolated" },
          },
        }),
      );
      writeFileSync(
        path.join(dir, "experiments.json"),
        JSON.stringify({
          "exp-1": {
            experimentId: "exp-1",
            proposalId: PROPOSAL,
            surfaceId: "agent.working-dna",
            tenantScope: TENANT,
            candidateRef: "abc",
            result: "improved",
          },
        }),
      );
      writeFileSync(
        path.join(dir, "applications.json"),
        JSON.stringify({
          "app-1": {
            applicationId: "app-1",
            proposalId: PROPOSAL,
            experimentId: "exp-1",
            status: "applied",
          },
        }),
      );
      writeFileSync(
        path.join(dir, "verifications.json"),
        JSON.stringify({
          "ver-1": {
            verificationId: "ver-1",
            applicationId: "app-1",
            outcome: "improved",
            verifiedAt: "2026-09-22T09:00:00.000Z",
            sampleSize: 20,
            confidence: 0.95,
            guardrailResults: [],
          },
        }),
      );
      const ledgerPath = path.join(dir, "ledger.jsonl");
      const seedLedger = createFileEvolutionLedger(ledgerPath);
      seedLedger.append({
        eventId: "evt-external",
        type: "external_effect.recorded",
        timestamp: "2026-09-22T09:10:00.000Z",
        proposalId: PROPOSAL,
        target: { domain: "agent", agentId: "a8-m1-isolated" },
        surfaceId: "agent.working-dna",
        tenantScope: TENANT,
        principalRef: "operator-1",
        grantId: "grant-1",
        evidenceRefs: [],
        experimentId: "exp-1",
        applicationId: "app-1",
        externalEffectOutcome: "verified",
      });
      seedLedger.append({
        eventId: "evt-drill",
        type: "rollback_drill.completed",
        timestamp: "2026-09-22T09:15:00.000Z",
        proposalId: PROPOSAL,
        target: { domain: "agent", agentId: "a8-m1-isolated" },
        surfaceId: "agent.working-dna",
        tenantScope: TENANT,
        principalRef: "operator-1",
        grantId: "grant-1",
        evidenceRefs: [],
        experimentId: "exp-1",
        applicationId: "app-1",
        drillId: "drill-1",
      });
      const resolved = receiptResult({
        outcome: "RESOLVED",
        reasonCode: "sot_confirmed",
      });
      const written = persistDiagnosisRecheckReceipt(
        dir,
        draft({ result: resolved, commandId: "cmd-before-approve" }),
        { ledger: seedLedger },
      );
      expect(written.closure.promotionEligible).toBe(false);
      seedLedger.append({
        eventId: "evt-approved-later",
        type: "application.approved",
        timestamp: "2026-09-22T11:00:00.000Z",
        proposalId: PROPOSAL,
        target: { domain: "agent", agentId: "a8-m1-isolated" },
        surfaceId: "agent.working-dna",
        tenantScope: TENANT,
        principalRef: "operator-1",
        grantId: "grant-1",
        evidenceRefs: [],
        experimentId: "exp-1",
        applicationId: "app-1",
      });
      resetDiagnosisM1ReceiptsForTests();
      expect(
        loadDiagnosisRecheckReceipt(dir, {
          tenantId: TENANT,
          proposalId: PROPOSAL,
          receiptId: written.receiptId,
        })?.receiptId,
      ).toBe(written.receiptId);
      expect(readDiagnosisM1Status(dir, { tenantId: TENANT, proposalId: PROPOSAL })).toMatchObject({
        applicationVerified: true,
        diagnosisRecheckOutcome: "RESOLVED",
        promotionEligible: true,
        promotionStatus: "eligible",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps ledger hash chain intact when recheck and approve share one tip", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-shared-tip-"));
    try {
      seedReceiptChain(dir);
      const ledgerPath = path.join(dir, "ledger.jsonl");
      const planeLedger = createFileEvolutionLedger(ledgerPath);
      const resolved = receiptResult({
        outcome: "RESOLVED",
        reasonCode: "sot_confirmed",
      });
      persistDiagnosisRecheckReceipt(
        dir,
        draft({ result: resolved, commandId: "cmd-shared-tip" }),
        { ledger: planeLedger },
      );
      planeLedger.append({
        eventId: "evt-approved-same-tip",
        type: "application.approved",
        timestamp: "2026-09-22T12:00:00.000Z",
        proposalId: PROPOSAL,
        target: { domain: "agent", agentId: "a8-m1-isolated" },
        surfaceId: "agent.working-dna",
        tenantScope: TENANT,
        principalRef: "operator-1",
        grantId: "grant-1",
        evidenceRefs: [],
        experimentId: "exp-1",
        applicationId: "app-1",
      });
      expect(() => createFileEvolutionLedger(ledgerPath)).not.toThrow();
      const types = createFileEvolutionLedger(ledgerPath)
        .list()
        .map((row) => row.type);
      expect(types).toContain("receipt.created");
      expect(types.filter((type) => type === "application.approved").length).toBeGreaterThanOrEqual(
        2,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an internally mismatched receipt even when its hash matches", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "a11-internal-"));
    try {
      seedReceiptChain(dir);
      const written = persistDiagnosisRecheckReceipt(dir, draft());
      const tampered: DiagnosisM1ReceiptRecord = {
        ...written,
        proposalId: "evo:other",
        payloadHash: "",
      };
      const { payloadHash: _ignored, ...payload } = tampered;
      tampered.payloadHash = hashDiagnosisM1ReceiptPayload(payload);
      writeFileSync(
        path.join(dir, "diagnosis-recheck-receipts.json"),
        `${JSON.stringify({ schemaVersion: 1, receipts: { [tampered.receiptId]: tampered } }, null, 2)}\n`,
      );
      resetDiagnosisM1ReceiptsForTests();
      expect(() =>
        loadDiagnosisRecheckReceipt(dir, {
          tenantId: TENANT,
          proposalId: "evo:other",
          receiptId: tampered.receiptId,
        }),
      ).toThrow(/verification ref/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
