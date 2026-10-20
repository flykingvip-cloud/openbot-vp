import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completionEventsFromEvolutionLedger,
  createMemoryCompletionLedger,
  decideEvolutionCompletionFromLedger,
  projectC6M1Status,
  type CompletionLedgerFile,
  type CompletionLedgerQuery,
  type CompletionLedgerRecord,
  type EvolutionLedgerEvent,
} from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import { projectDiagnosisM1Closure } from "./diagnosis-m1-status.js";
import { createMemoryEvolutionLedger } from "./evolution-ledger.js";

const here = dirname(fileURLToPath(import.meta.url));
const core = join(here, "../../../packages/evolution-core/src");
const TARGET = { domain: "agent" as const, agentId: "a8-m1-isolated" };
const SURFACE = "agent.working-dna";
const CANDIDATE = "c5fda4dba439f8c00084c650da491f0c450c7976a9c16a0644d90e1e2aceb255";

type Snapshot = CompletionLedgerFile & {
  realQuery: CompletionLedgerQuery;
  closedLoopQuery: CompletionLedgerQuery;
};

function loadSnapshot(): Snapshot {
  return JSON.parse(readFileSync(join(core, "c8-ledger-replay.json"), "utf8")) as Snapshot;
}

function loadChain(): EvolutionLedgerEvent[] {
  return readFileSync(join(core, "c8-ledger-replay.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EvolutionLedgerEvent);
}

describe("C8 control-plane ledger replay", () => {
  it("loads the hash-chained jsonl and agrees with the structured snapshot", () => {
    const file = loadSnapshot();
    const ledger = createMemoryEvolutionLedger(loadChain());
    const mapped = completionEventsFromEvolutionLedger(ledger.replay("evo:diag:8bee2c37b1f39478"));
    expect(mapped.some((event) => event.eventId === "evt-a10-verification-ok")).toBe(true);
    expect(
      mapped.some(
        (event) =>
          event.type === "promotion.completed" &&
          event.tenantScope === "001" &&
          event.proposalId === file.realQuery.proposalId &&
          event.applicationId === file.realQuery.applicationId,
      ),
    ).toBe(false);

    const objects = file.records.filter((record) => record.kind !== "event");
    const fromChain: CompletionLedgerRecord[] = [
      ...objects,
      ...completionEventsFromEvolutionLedger(ledger.list()).map((event) => ({
        kind: "event" as const,
        event,
      })),
    ];
    const reader = createMemoryCompletionLedger(fromChain);
    const judge = decideEvolutionCompletionFromLedger({
      reader,
      query: file.realQuery,
      target: TARGET,
      surfaceId: SURFACE,
      candidateVersion: CANDIDATE,
      authorityOk: true,
      guardrailDegraded: false,
    });
    const diagnosis = projectDiagnosisM1Closure({
      applicationVerified: true,
      diagnosisRecheckOutcome: "STILL_OPEN",
      sotReadable: true,
      completionLedger: {
        reader,
        query: file.realQuery,
        target: TARGET,
        surfaceId: SURFACE,
        candidateVersion: CANDIDATE,
        authorityOk: true,
        guardrailDegraded: false,
      },
    });
    const audit = reader.read(file.realQuery);
    const c6 = projectC6M1Status({
      tenantId: file.realQuery.tenantId,
      target: TARGET,
      surfaceId: SURFACE,
      candidateVersion: CANDIDATE,
      commandId: "cmd-a9-verify-ok",
      observationWindow: {
        startedAt: "2026-09-22T09:53:14.997Z",
        endedAt: "2026-09-29T09:53:14.979Z",
        sampleCount: 20,
      },
      proposal: audit.proposal!,
      experiment: { ...audit.experiment!, result: "improved" },
      application: audit.application!,
      verification: audit.verification,
      recheck: audit.recheck,
      recheckRecordedAt: audit.recheckRecordedAt,
      ledgerEvents: [],
      ledger: reader,
      sampleSize: 20,
      confidence: 0.95,
      rollbackDrillPassed: true,
      authorityOk: true,
      guardrailDegraded: false,
    });
    expect(diagnosis.userVisibleStatus).toBe(judge.userVisibleStatus);
    expect(diagnosis.promotionEligible).toBe(judge.promotionEligible);
    expect(diagnosis.promotionStatus).not.toBe("completed");
    expect(diagnosis.recordsPromotionCompleted).toBe(false);
    expect(c6.userVisibleStatus).toBe(judge.userVisibleStatus);
    expect(c6.promotionCompleted).toBe(judge.promotionCompleted);
    expect(c6.executedConsumer).toBe(false);
    expect(c6.directMutatorsRetired).toBe(false);
    expect(c6.e52SwitchAllowed).toBe(false);
    expect(c6.singleTrack).toBe(false);
    expect(judge.userVisibleStatus).toBe("已验证，进化未完成");
  });
});
