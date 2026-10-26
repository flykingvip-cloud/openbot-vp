import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  drainAllAgentsPendingGrowth,
  recoverTaskOutcomeConsumersAtGatewayBoot,
  stopTaskOutcomeRuntimeDrainForTests,
} from "./consumer-boot.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:boot",
  subjectRef: "u",
  authzScopeRef: "s",
};

describe("task-outcome consumer boot / runtime drain", () => {
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "to-boot-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    stopTaskOutcomeRuntimeDrainForTests();
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("drains pending outbox without a subsequent user turn", () => {
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store, submittedBy: "t" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "boot-1",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    let r = chat.recordAttempt(
      "boot-1",
      opened.record.outcomeVersion,
      opened.fencingToken,
      {
        attemptId: "a1",
        runId: "r1",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      {
        runId: "r1",
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
    r = chat.setAcceptance(
      "boot-1",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "t" },
      { allowRetry: true, scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    r = chat.setDelivery(
      "boot-1",
      r.record.outcomeVersion,
      opened.fencingToken,
      { status: "not_required", reason: "t" },
      "d",
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    expect(store.listPendingOutbox().length).toBeGreaterThan(0);

    const boot = recoverTaskOutcomeConsumersAtGatewayBoot({
      cfg,
      startRuntimeDrain: false,
    });
    expect(boot.agentsScanned).toBe(1);
    expect(boot.processed).toBeGreaterThan(0);
    expect(store.listPendingOutbox()).toHaveLength(0);

    // Second drain is a no-op without new events (proves independent of user messages).
    const again = drainAllAgentsPendingGrowth(cfg);
    expect(again.processed).toBe(0);
  });
});
