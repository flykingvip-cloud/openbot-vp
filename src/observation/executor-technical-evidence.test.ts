import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  publishFinalEvidenceLink,
  resetEvidenceAssociations,
} from "../executor-evidence/association.js";
import { snapshotIdentityFingerprint } from "../executor-evidence/identity.js";
import {
  observeModelCandidate,
  resetModelCallsForTests,
} from "../executor-evidence/model-call-evidence.js";
import { readExecutorEvidence } from "../executor-evidence/read-port.js";
import {
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
  type ModelCallCloseoutLink,
} from "../task-outcome/runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import { createExecutionJournalRuntime } from "./execution-journal-runtime.js";
import { createExecutionJournal } from "./execution-journal.js";
import { readExecutorTechnicalEvidence } from "./executor-technical-evidence.js";
import { queryObservation, queryObservationWithJournal } from "./query.js";
const roots: string[] = [];
const scope = {
  kind: "enterprise" as const,
  enterpriseDomainId: "domain",
  tenantId: "tenant",
  subjectRef: "subject:alice",
  authzScopeRef: "private-authz",
};
afterEach(() => {
  resetModelCallsForTests();
  resetEvidenceAssociations();
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
async function setup(enabled = true) {
  process.env.OPENBOT_EXECUTOR_EVIDENCE = enabled ? "1" : "0";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "technical-adapter-"));
  roots.push(root);
  const cfg = {
    agents: { list: [{ id: "bot", agentDir: root, workspace: root }] },
    models: {
      providers: {
        local: {
          baseUrl: "http://127.0.0.1:1",
          models: [
            {
              id: "a",
              name: "test",
              reasoning: false,
              input: ["text"],
              cost: { input: 1000000, output: 1000000, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
        },
      },
    },
  } satisfies OpenBotConfig;
  let link: ModelCallCloseoutLink | null = null;
  await observeModelCandidate({
    context: {
      agentId: "bot",
      scope,
      taskId: "task",
      runId: "run",
      storeRoot: path.join(root, "task-outcomes"),
      provenance: "injected",
      collector: "isolation",
    },
    attemptIndex: 0,
    provider: "local",
    model: "a",
    run: async () => {
      const charged = chargeModelCallAgainstTip(cfg, "bot", {
        taskId: "task",
        scope,
        runId: "run",
        callSeq: 1,
        provider: "local",
        model: "a",
        usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
        budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
      });
      link = charged.modelCallLink;
      return "ok";
    },
  });
  const closed = await recordRunnerTurnOutcome(cfg, "bot", {
    success: true,
    runId: "run",
    taskId: "task",
    scope,
    skipBudgetCharge: true,
    modelCallLink: link,
    acceptance: { status: "passed" },
    delivery: { status: "delivered" },
    deliveryId: "delivery",
  });
  return {
    cfg,
    root,
    caller: { subjectRef: "subject:alice", tenantId: "tenant" },
    agentId: "bot",
    taskId: "task",
    outcomeVersion: closed.record.outcomeVersion,
  };
}
describe("real executor technical query adapter", () => {
  it("reads durable real ResultService records independently of L3 and redacts identity", async () => {
    const input = await setup();
    resetModelCallsForTests();
    resetEvidenceAssociations();
    const result = queryObservation({
      ...input,
      from: Date.now() - 60000,
      to: Date.now(),
      projectedAt: Date.now(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("query_failed");
    }
    const tech = result.executorTechnicalEvidence;
    expect(tech.calls).toHaveLength(1);
    expect(tech.calls[0].provenance).toBe("injected");
    expect(tech.associations[0].candidateAttemptId).not.toBe(tech.associations[0].taskAttemptId);
    expect(tech.runTotalCost).toBeNull();
    expect(result.samples.every((s) => !s.improvementEligible)).toBe(true);
    expect(JSON.stringify(tech)).not.toContain("private-authz");
    expect(JSON.stringify(tech)).not.toContain(input.root);
    expect(JSON.stringify(tech)).not.toContain("subject:alice");
  });
  it("denies wrong caller and rejects a changed identity after the actual disk read", async () => {
    const input = await setup();
    expect(
      readExecutorTechnicalEvidence({
        ...input,
        caller: { subjectRef: "other", tenantId: "tenant" },
      }).ok,
    ).toBe(false);
    const result = readExecutorTechnicalEvidence(input, (q) => {
      const view = readExecutorEvidence(q);
      const tip = path.join(input.root, "task-outcomes/tips/task.json");
      const row = JSON.parse(fs.readFileSync(tip, "utf8"));
      row.scope.subjectRef = "other";
      fs.writeFileSync(tip, JSON.stringify(row));
      return view;
    });
    expect(result.ok).toBe(false);
  });
  it("keeps disabled collection unknown and never supplies run cost", async () => {
    const input = await setup(false);
    const result = readExecutorTechnicalEvidence(input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("read_failed");
    }
    expect(result.technicalEvidence.state).toBe("unknown");
    expect(result.technicalEvidence.calls).toEqual([]);
    expect(result.technicalEvidence.runTotalCost).toBeNull();
  });
  it("returns unknown when the real read port cannot read and rechecks ACL", async () => {
    const input = await setup();
    const result = readExecutorTechnicalEvidence(input, () => {
      throw new Error("disk");
    });
    expect(result).toMatchObject({
      ok: true,
      technicalEvidence: { state: "unknown", reasons: ["executor_read_failed"] },
    });
  });
});

describe("executor exact version and journal compatibility", () => {
  it("keeps exact versions and windows separate and preserves the DTO through journal-disabled query", async () => {
    const input = await setup();
    const before = readExecutorTechnicalEvidence({ ...input, outcomeVersion: 1 });
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(before.technicalEvidence.calls).toEqual([]);
    }
    const now = Date.now();
    const outside = queryObservation({
      ...input,
      from: now + 1,
      to: now + 2,
      projectedAt: now + 2,
    });
    expect(outside.ok).toBe(true);
    if (outside.ok) {
      expect(outside.executorTechnicalEvidence.calls).toEqual([]);
    }
    const journal = createExecutionJournalRuntime({
      journal: createExecutionJournal({
        rootDir: path.join(input.root, "journal"),
        enabled: () => false,
      }),
      enabled: () => false,
    });
    const result = await queryObservationWithJournal(
      { ...input, from: now - 60000, to: now, projectedAt: now },
      journal,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.executorTechnicalEvidence.calls).toHaveLength(1);
      expect(result.executorTechnicalEvidence.runTotalCost).toBeNull();
    }
  });
  it("rejects a replaced immutable version and degrades corrupt evidence to unknown", async () => {
    const input = await setup();
    const dir = path.join(input.root, "task-outcomes/executor-evidence/calls");
    for (const name of fs.readdirSync(dir)) {
      fs.writeFileSync(path.join(dir, name), "{");
    }
    const damaged = readExecutorTechnicalEvidence(input);
    expect(damaged.ok).toBe(true);
    if (damaged.ok) {
      expect(damaged.technicalEvidence.state).toBe("unknown");
      expect(damaged.technicalEvidence.calls).toEqual([]);
    }
    const file = path.join(
      input.root,
      "task-outcomes/versions",
      "task__v" + input.outcomeVersion + ".json",
    );
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    record.scope.authzScopeRef = "replaced";
    fs.writeFileSync(file, JSON.stringify(record));
    expect(readExecutorTechnicalEvidence(input).ok).toBe(false);
  });
});

describe("technical projection source and gap semantics", () => {
  it("does not promote a window-clipped source to complete", async () => {
    const input = await setup();
    const now = Date.now();
    const result = queryObservation({ ...input, from: now + 1, to: now + 2, projectedAt: now + 2 });
    if (!result.ok) {
      throw new Error("query_failed");
    }
    expect(result.executorTechnicalEvidence.completeness).toBe("unknown");
    expect(result.executorTechnicalEvidence.reasons).toContain("window_filtered");
    expect(result.executorTechnicalEvidence.reasons).toContain(
      "source_watermark_is_not_window_coverage",
    );
  });
  it("preserves no-call charge reasons from a real persisted final link", async () => {
    const input = await setup();
    const store = new DurableTaskOutcomeStore(path.join(input.root, "task-outcomes"));
    const record = store.loadTask("task");
    if (!record) {
      throw new Error("record_missing");
    }
    publishFinalEvidenceLink({
      storeRoot: store.rootDir,
      call: null,
      scope,
      agentId: "bot",
      taskId: "task",
      runId: "run",
      candidateAttemptId: "unavailable-candidate",
      taskAttemptId: record.attempts[0].attemptId,
      chargeOutcomeVersion: 1,
      finalOutcomeVersion: record.outcomeVersion,
      recordRuns: record.runs,
      recordAttempts: record.attempts.map((a) => a.attemptId),
      receiptReturned: true,
      snapshotFingerprint: snapshotIdentityFingerprint(record),
      budgetChargeReasons: ["charge_unknown"],
    });
    store.close();
    resetModelCallsForTests();
    resetEvidenceAssociations();
    const now = Date.now();
    const result = queryObservation({ ...input, from: now - 60000, to: now, projectedAt: now });
    if (!result.ok) {
      throw new Error("query_failed");
    }
    expect(
      result.executorTechnicalEvidence.attributionGaps?.some((row) =>
        row.reasons.includes("charge_unknown"),
      ),
    ).toBe(true);
    expect(result.executorTechnicalEvidence.runTotalCost).toBeNull();
  });
});
