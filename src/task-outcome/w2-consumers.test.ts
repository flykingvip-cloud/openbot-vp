/**
 * W2: skill/mode unified consumption + attempt positive backfill + cancelled projections.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { patternTmp } = vi.hoisted(() => ({
  patternTmp: `/tmp/openbot-w2-${Date.now()}`,
}));

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return { ...actual, CONFIG_DIR: patternTmp };
});

vi.mock("../gateway/evolution-control/pattern-proposal.js", () => ({
  registerNamedPatternCandidateProposal: vi.fn(),
}));

import type { OpenBotConfig } from "../config/config.js";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import {
  confirmPatternOutcomeByRunId,
  listPatternSamples,
  resetPatternDetectionStoreForTests,
} from "../gateway/pattern-detection/index.js";
import { ingestPatternSampleFromRun } from "../gateway/pattern-detection/ingest-from-run.js";
import { backfillAttemptSamplesFromTaskOutcome } from "./attempt-backfill.js";
import {
  GROWTH_EVOLUTION_CONSUMER_ID,
  MODE_CONSUMER_ID,
  OutcomeConsumerRuntime,
  SKILL_CONSUMER_ID,
} from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import {
  createModeQualityHandler,
  createSkillQualityHandler,
  rebuildQualityProjectionFromContributions,
} from "./quality-handlers.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { recordRunnerTurnOutcome, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:w2",
  subjectRef: "u",
  authzScopeRef: "s",
};

describe("W2 consumers A–C", () => {
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "w2-agent-"));
    fs.mkdirSync(patternTmp, { recursive: true });
    resetPatternDetectionStoreForTests();
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    resetPatternDetectionStoreForTests();
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(patternTmp, { recursive: true, force: true });
  });

  function openStore(): {
    store: DurableTaskOutcomeStore;
    chat: ChatTaskOutcomeAdapter;
  } {
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store, submittedBy: "w2" });
    return { store, chat: new ChatTaskOutcomeAdapter(service) };
  }

  it("A: skill/mode handlers consume tip+eligibility, not run alone", async () => {
    const { store, chat } = openStore();
    const opened = chat.createOrRestore({
      taskId: "t-skill",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    // Run succeeded but tip still incomplete — must NOT count skill/mode success.
    let r = chat.recordAttempt(
      "t-skill",
      opened.record.outcomeVersion,
      opened.fencingToken,
      {
        attemptId: "a1",
        runId: "run-skill",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      {
        runId: "run-skill",
        attemptIds: ["a1"],
        effectiveAttemptId: "a1",
        fencingToken: opened.fencingToken,
        status: "succeeded",
      },
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    expect(r.record.lifecycle).not.toBe("closed");

    const runtimeIncomplete = new OutcomeConsumerRuntime(store, {
      consumerId: GROWTH_EVOLUTION_CONSUMER_ID,
      handlers: [
        createSkillQualityHandler(store, { backfillAttempt: false }),
        createModeQualityHandler(store),
      ],
    });
    await runtimeIncomplete.drain((id) => store.loadTask(id));
    expect(store.loadProjection(SKILL_CONSUMER_ID).successCount).toBe(0);
    expect(store.loadProjection(MODE_CONSUMER_ID).successCount).toBe(0);

    r = chat.setAcceptance(
      "t-skill",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "test" },
      { allowRetry: true, scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    r = chat.setDelivery(
      "t-skill",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "test" },
      "d1",
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    expect(r.record.lifecycle).toBe("closed");
    expect(r.record.taskJudgement).toBe("success");

    const runtimeClosed = new OutcomeConsumerRuntime(store, {
      consumerId: GROWTH_EVOLUTION_CONSUMER_ID,
      handlers: [
        createSkillQualityHandler(store, { backfillAttempt: false }),
        createModeQualityHandler(store),
      ],
    });
    await runtimeClosed.drain((id) => store.loadTask(id));
    expect(store.loadProjection(SKILL_CONSUMER_ID).successCount).toBe(1);
    expect(store.loadProjection(SKILL_CONSUMER_ID).failureCount).toBe(0);
    expect(store.loadProjection(MODE_CONSUMER_ID).successCount).toBe(1);
  });

  it("B: attempt positive backfill only when tip closed + eligible", () => {
    ingestPatternSampleFromRun({
      agentId: "bot",
      runId: "run-backfill",
      toolsUsed: ["read_file", "write_file"],
      success: null,
    });
    expect(listPatternSamples().find((s) => s.runId === "run-backfill")?.success).toBeNull();

    const { chat } = openStore();
    const opened = chat.createOrRestore({
      taskId: "t-bf",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    let r = chat.recordAttempt(
      "t-bf",
      opened.record.outcomeVersion,
      opened.fencingToken,
      {
        attemptId: "a1",
        runId: "run-backfill",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      {
        runId: "run-backfill",
        attemptIds: ["a1"],
        effectiveAttemptId: "a1",
        fencingToken: opened.fencingToken,
        status: "succeeded",
      },
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    const early = backfillAttemptSamplesFromTaskOutcome(r.record, { agentId: "bot" });
    expect(early.patternPatched).toBe(0);
    expect(early.reason).toBe("not_closed");
    expect(listPatternSamples().find((s) => s.runId === "run-backfill")?.success).toBeNull();

    r = chat.setAcceptance(
      "t-bf",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "test" },
      { allowRetry: true, scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    r = chat.setDelivery(
      "t-bf",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "test" },
      "d1",
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }

    const filled = backfillAttemptSamplesFromTaskOutcome(r.record, { agentId: "bot" });
    expect(filled.patternPatched).toBe(1);
    expect(filled.reason).toBe("tip_success_eligible");
    expect(listPatternSamples().find((s) => s.runId === "run-backfill")?.success).toBe(true);

    expect(confirmPatternOutcomeByRunId("run-backfill", false)).toHaveLength(0);
    expect(listPatternSamples().find((s) => s.runId === "run-backfill")?.success).toBe(true);
  });

  it("C: cancelled → countedCancelled only; not skill/mode/growth failure", async () => {
    const { store, chat } = openStore();
    const opened = chat.createOrRestore({
      taskId: "t-cancel",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const cancelled = chat.cancel("t-cancel", opened.record.outcomeVersion, opened.fencingToken, {
      scope,
    });
    if (!cancelled.ok) {
      throw new Error("cancel");
    }
    expect(cancelled.record.taskJudgement).toBe("cancelled");

    const runtime = new OutcomeConsumerRuntime(store, {
      consumerId: GROWTH_EVOLUTION_CONSUMER_ID,
      handlers: [
        createSkillQualityHandler(store, { agentId: "bot", backfillAttempt: true }),
        createModeQualityHandler(store),
      ],
    });
    await runtime.drain((id) => store.loadTask(id));

    const growth = runtime.getProjection();
    expect(growth.cancelledCount).toBe(1);
    expect(growth.successCount).toBe(0);
    expect(growth.failureCount).toBe(0);

    const skill = store.loadProjection(SKILL_CONSUMER_ID);
    expect(skill.cancelledCount).toBe(1);
    expect(skill.successCount).toBe(0);
    expect(skill.failureCount).toBe(0);

    const mode = store.loadProjection(MODE_CONSUMER_ID);
    expect(mode.cancelledCount).toBe(1);
    expect(mode.successCount).toBe(0);
    expect(mode.failureCount).toBe(0);

    const rebuiltGrowth = new OutcomeConsumerRuntime(store).getProjection();
    expect(rebuiltGrowth.cancelledCount).toBe(1);
    expect(rebuiltGrowth.failureCount).toBe(0);
    expect(rebuildQualityProjectionFromContributions(store, SKILL_CONSUMER_ID).cancelledCount).toBe(
      1,
    );
    expect(rebuildQualityProjectionFromContributions(store, MODE_CONSUMER_ID).failureCount).toBe(0);

    const bf = backfillAttemptSamplesFromTaskOutcome(cancelled.record, { agentId: "bot" });
    expect(bf.reason).toBe("cancelled_excluded");
    expect(bf.patternPatched).toBe(0);
  });

  it("C e2e: recordRunnerTurnOutcome user_cancelled → projections + no evolution negative", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-cancel-e2e",
      taskId: "chat:bot:sess:run-cancel-e2e",
      failureReason: "user_cancelled",
      scope,
    });
    expect(out.record.taskJudgement).toBe("cancelled");
    expect(out.evolution.written).toBe(false);

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const skill = store.loadProjection(SKILL_CONSUMER_ID);
    const mode = store.loadProjection(MODE_CONSUMER_ID);
    const growth = store.loadProjection(GROWTH_EVOLUTION_CONSUMER_ID);

    expect(growth.cancelledCount).toBeGreaterThanOrEqual(1);
    expect(growth.failureCount).toBe(0);
    expect(skill.cancelledCount).toBeGreaterThanOrEqual(1);
    expect(skill.failureCount).toBe(0);
    expect(mode.cancelledCount).toBeGreaterThanOrEqual(1);
    expect(mode.failureCount).toBe(0);

    expect(readEvolutionTaskOutcomes(cfg, "bot").filter((r) => !r.succeeded)).toHaveLength(0);
  });

  it("prepare_failed failure does not count skill success/failure rates", async () => {
    const { store, chat } = openStore();
    const opened = chat.createOrRestore({
      taskId: "t-prep",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const failed = chat.failClosed("t-prep", opened.record.outcomeVersion, "prepare_failed", {
      fencingToken: opened.fencingToken,
      scope,
      reasonDetail: "preflight",
    });
    if (!failed.ok) {
      throw new Error(failed.code);
    }
    const runtime = new OutcomeConsumerRuntime(store, {
      handlers: [
        createSkillQualityHandler(store, { backfillAttempt: false }),
        createModeQualityHandler(store),
      ],
    });
    await runtime.drain((id) => store.loadTask(id));
    expect(store.loadProjection(SKILL_CONSUMER_ID).failureCount).toBe(0);
    expect(store.loadProjection(SKILL_CONSUMER_ID).successCount).toBe(0);
    expect(store.loadProjection(MODE_CONSUMER_ID).failureCount).toBe(0);
  });

  it("provider_fault counts mode stability failure, not skill rate", async () => {
    const { store, chat } = openStore();
    const opened = chat.createOrRestore({
      taskId: "t-prov",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const failed = chat.failClosed("t-prov", opened.record.outcomeVersion, "provider_fault", {
      fencingToken: opened.fencingToken,
      scope,
      reasonDetail: "upstream",
    });
    if (!failed.ok) {
      throw new Error(failed.code);
    }
    const runtime = new OutcomeConsumerRuntime(store, {
      handlers: [
        createSkillQualityHandler(store, { backfillAttempt: false }),
        createModeQualityHandler(store),
      ],
    });
    await runtime.drain((id) => store.loadTask(id));
    expect(store.loadProjection(SKILL_CONSUMER_ID).failureCount).toBe(0);
    expect(store.loadProjection(MODE_CONSUMER_ID).failureCount).toBe(1);
    expect(store.loadProjection(MODE_CONSUMER_ID).cancelledCount).toBe(0);
  });
});
