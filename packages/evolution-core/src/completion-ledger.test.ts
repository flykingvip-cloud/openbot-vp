import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { projectC6M1Status } from "./c6-m1-promotion.js";
import { createFileCompletionLedger } from "./completion-ledger-file.js";
import {
  completionEventsFromEvolutionLedger,
  createMemoryCompletionLedger,
  decideEvolutionCompletionFromLedger,
  type CompletionLedgerFile,
  type CompletionLedgerQuery,
  type CompletionLedgerReader,
} from "./completion-ledger.js";
import { decideEvolutionCompletion } from "./evolution-completion.js";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "c8-ledger-replay.json");

const TARGET = { domain: "agent" as const, agentId: "a8-m1-isolated" };
const SURFACE = "agent.working-dna";
const CANDIDATE = "c5fda4dba439f8c00084c650da491f0c450c7976a9c16a0644d90e1e2aceb255";

type Snapshot = CompletionLedgerFile & {
  realQuery: CompletionLedgerQuery;
  closedLoopQuery: CompletionLedgerQuery;
};

function snapshot(): Snapshot {
  return JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
}

function decide(reader: CompletionLedgerReader, query: CompletionLedgerQuery) {
  return decideEvolutionCompletionFromLedger({
    reader,
    query,
    target: TARGET,
    surfaceId: SURFACE,
    candidateVersion: CANDIDATE,
    authorityOk: true,
    guardrailDegraded: false,
  });
}

function projectB(reader: CompletionLedgerReader, query: CompletionLedgerQuery, commandId: string) {
  const read = reader.read(query);
  return projectC6M1Status({
    tenantId: query.tenantId,
    target: TARGET,
    surfaceId: SURFACE,
    candidateVersion: CANDIDATE,
    commandId,
    observationWindow: {
      startedAt: "2026-09-22T09:53:14.997Z",
      endedAt: "2026-09-29T09:53:14.979Z",
      sampleCount: 20,
    },
    proposal: read.proposal!,
    experiment: { ...read.experiment!, result: "improved" },
    application: read.application!,
    verification: read.verification,
    recheck: read.recheck,
    recheckRecordedAt: read.recheckRecordedAt,
    ledgerEvents: [],
    ledger: reader,
    sampleSize: 20,
    confidence: 0.95,
    rollbackDrillPassed: true,
    authorityOk: true,
    guardrailDegraded: false,
    executedConsumer: true,
    directMutatorsRetired: true,
    e52SwitchAllowed: true,
    cutoverReady: true,
  });
}

function sharedFields(decision: ReturnType<typeof decide>) {
  return {
    applicationVerified: decision.applicationVerified,
    recheckOutcome: decision.recheckOutcome,
    promotionEligible: decision.promotionEligible,
    promotionCompleted: decision.promotionCompleted,
    recommendation: decision.recommendation,
    reasonCode: decision.reasonCode,
    userVisibleStatus: decision.userVisibleStatus,
  };
}

describe("C8 completion ledger", () => {
  it("replays the real A10 chain without treating foreign promotions as complete", () => {
    const file = snapshot();
    const decision = decide(createFileCompletionLedger(snapshotPath), file.realQuery);
    expect(sharedFields(decision)).toEqual({
      applicationVerified: true,
      recheckOutcome: "STILL_OPEN",
      promotionEligible: false,
      promotionCompleted: false,
      recommendation: "hold",
      reasonCode: "finding_still_open",
      userVisibleStatus: "已验证，进化未完成",
    });
    expect(decision.userVisibleStatus).not.toBe("已完成进化");
    const read = createFileCompletionLedger(snapshotPath).read(file.realQuery);
    expect(read.events.map((event) => event.eventId)).toEqual(["evt-a10-verification-ok"]);
    expect(read.events.some((event) => event.type === "promotion.completed")).toBe(false);
  });

  it("makes A and B agree on the same structured snapshot", () => {
    const file = snapshot();
    const reader = createFileCompletionLedger(snapshotPath);
    const cases = [
      { query: file.realQuery, commandId: "cmd-a9-verify-ok" },
      { query: file.closedLoopQuery, commandId: "c8-closed-loop" },
    ];
    for (const { query, commandId } of cases) {
      const judge = decide(reader, query);
      const projected = projectB(reader, query, commandId);
      expect({
        applicationVerified: projected.applicationVerified,
        recheckOutcome: projected.recheckOutcome,
        promotionEligible: projected.promotionEligible,
        promotionCompleted: projected.promotionCompleted,
        userVisibleStatus: projected.userVisibleStatus,
      }).toEqual({
        applicationVerified: judge.applicationVerified,
        recheckOutcome: judge.recheckOutcome,
        promotionEligible: judge.promotionEligible,
        promotionCompleted: judge.promotionCompleted,
        userVisibleStatus: judge.userVisibleStatus,
      });
      expect(projected.executedConsumer).toBe(false);
      expect(projected.directMutatorsRetired).toBe(false);
      expect(projected.e52SwitchAllowed).toBe(false);
      expect(projected.singleTrack).toBe(false);
      expect(projected.isE52CutoverReceipt).toBe(false);
    }
    expect(decide(reader, file.closedLoopQuery)).toMatchObject({
      promotionCompleted: true,
      promotionEligible: true,
      recommendation: "promote",
      reasonCode: "completion_accepted",
      userVisibleStatus: "已完成进化",
    });
  });

  it("replays the same decision after a fresh file read", () => {
    const file = snapshot();
    const dir = mkdtempSync(join(tmpdir(), "c8-ledger-"));
    const copy = join(dir, "ledger.json");
    try {
      writeFileSync(copy, readFileSync(snapshotPath));
      const firstReader = createFileCompletionLedger(copy);
      const first = firstReader.read(file.realQuery);
      const firstEvent = first.events[0];
      expect(firstEvent).toBeDefined();
      if (firstEvent) {
        firstEvent.timestamp = "1999-01-01T00:00:00.000Z";
      }
      const second = createFileCompletionLedger(copy).read(file.realQuery);
      expect(second.events[0]?.timestamp).toBe("2026-09-22T09:53:14.997Z");
      const replayed = createFileCompletionLedger(copy);
      expect(decide(firstReader, file.realQuery)).toEqual(decide(replayed, file.realQuery));
      expect(decide(firstReader, file.closedLoopQuery)).toEqual(
        decide(replayed, file.closedLoopQuery),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a caller promotion.completed before reading the ledger", () => {
    const file = snapshot();
    const decision = decideEvolutionCompletionFromLedger({
      reader: {
        read() {
          throw new Error("ledger must not be read");
        },
      },
      query: file.realQuery,
      target: TARGET,
      surfaceId: SURFACE,
      candidateVersion: CANDIDATE,
      authorityOk: true,
      guardrailDegraded: false,
      callerPromotionEvents: [],
    });
    expect(decision).toMatchObject({
      promotionCompleted: false,
      promotionEligible: false,
      reasonCode: "caller_promotion_rejected",
      userVisibleStatus: "无法确认，已停止",
    });
  });

  it("rejects a raw promotion array passed to the judge", () => {
    const decision = decideEvolutionCompletion({
      tenantId: "001",
      target: TARGET,
      surfaceId: SURFACE,
      candidateVersion: CANDIDATE,
      proposal: null,
      experiment: null,
      application: null,
      verification: null,
      recheck: null,
      recheckRecordedAt: null,
      evaluation: null,
      promotionEvents: [] as never,
      authorityOk: true,
      guardrailDegraded: false,
    });
    expect(decision.reasonCode).toBe("caller_promotion_rejected");
    expect(decision.promotionCompleted).toBe(false);
  });

  it("fail-closes a reader that returns an event outside the query", () => {
    const file = snapshot();
    const base = createMemoryCompletionLedger(file.records).read(file.realQuery);
    const decision = decideEvolutionCompletionFromLedger({
      reader: {
        read() {
          return {
            ...base,
            events: [
              ...base.events,
              {
                eventId: "evt-smuggled",
                type: "promotion.completed",
                tenantScope: "999",
                proposalId: "evo:other",
                experimentId: "exp:other",
                applicationId: "app:other",
                verificationId: "ver:other",
                target: TARGET,
                surfaceId: SURFACE,
                candidateRef: "cand:diag:c5fda4dba439f8c00084c650da491f0c",
                principalRef: "operator",
                timestamp: "2026-09-22T10:00:00.000Z",
              },
            ],
          };
        },
      },
      query: file.realQuery,
      target: TARGET,
      surfaceId: SURFACE,
      candidateVersion: CANDIDATE,
      authorityOk: true,
      guardrailDegraded: false,
    });
    expect(decision.reasonCode).toBe("ledger_query_mismatch");
    expect(decision.userVisibleStatus).toBe("无法确认，已停止");
  });

  it("fail-closes duplicate objects, early promotions, and non-applied applications", () => {
    const file = snapshot();
    const records = file.records;
    const duplicated = decide(
      createMemoryCompletionLedger([
        ...records,
        records.find((record) => record.kind === "proposal")!,
      ]),
      file.realQuery,
    );
    expect(duplicated.reasonCode).toBe("ledger_duplicate_object");

    const early = decide(
      createMemoryCompletionLedger([
        ...records.filter(
          (record) => record.kind !== "event" || record.event.eventId !== "evt-c8-closed-promotion",
        ),
        {
          kind: "event",
          event: {
            eventId: "evt-c8-early",
            type: "promotion.completed",
            tenantScope: "001",
            proposalId: "evo:diag:8bee2c37b1f39478",
            experimentId: "exp:cmd-a9-exp-down",
            applicationId: "app:c8-closed-loop",
            verificationId: "ver:c8-closed-loop",
            target: TARGET,
            surfaceId: SURFACE,
            candidateRef: "cand:diag:c5fda4dba439f8c00084c650da491f0c",
            principalRef: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
            timestamp: "2026-09-22T09:00:00.000Z",
          },
        },
      ]),
      file.closedLoopQuery,
    );
    expect(early.reasonCode).toBe("promotion_event_early");

    for (const status of ["pending", "failed", "rolled_back"] as const) {
      const replaced = records.map((record) =>
        record.kind === "application" && record.body.applicationId === "app:c8-closed-loop"
          ? { ...record, body: { ...record.body, status } }
          : record,
      );
      expect(decide(createMemoryCompletionLedger(replaced), file.closedLoopQuery).reasonCode).toBe(
        "application_not_applied",
      );
    }
  });

  it("keeps candidate identity when mapping a control-plane ledger event", () => {
    const mapped = completionEventsFromEvolutionLedger([
      {
        eventId: "evt-a10-verification-ok",
        type: "verification.completed",
        timestamp: "2026-09-22T09:53:14.997Z",
        proposalId: "evo:diag:8bee2c37b1f39478",
        tenantScope: "001",
        principalRef: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        surfaceId: SURFACE,
        target: TARGET,
        evidenceRefs: ["cand:diag:c5fda4dba439f8c00084c650da491f0c"],
        experimentId: "exp:cmd-a9-exp-down",
        applicationId: "app:cmd-a9-active-up",
        verificationId: "ver:cmd-a9-verify-ok",
      },
    ]);
    expect(mapped[0]?.candidateRef).toBe("cand:diag:c5fda4dba439f8c00084c650da491f0c");
    expect(mapped[0]?.type).toBe("verification.completed");
  });
});
