import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { createFileWorkingDnaObservationPort } from "../gateway/evolution-control/adapters/working-dna.js";
import {
  CHAT_TURN_CONTRACT_V1,
  resolveChatTurnCloseGates,
  resolveTurnTaskContract,
} from "./chat-entry.js";
import {
  publishEvolutionFromTaskOutcome,
  readEffectiveEvolutionTaskOutcomes,
} from "./growth-bridge.js";
import {
  clearAwaitingDeliveriesForTests,
  registerAwaitingDelivery,
  takeAwaitingDelivery,
} from "./pending-delivery.js";
import { confirmRunnerTurnDelivery, recordRunnerTurnOutcome } from "./runtime-from-runner.js";
import {
  JUDGEMENT_POLICY_VERSION,
  TASK_OUTCOME_SCHEMA_VERSION,
  type TaskOutcomeRecord,
  type TrustedScope,
} from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:u1",
  subjectRef: "u1",
  authzScopeRef: "chat-entry",
};

function baseRecord(
  partial: Partial<TaskOutcomeRecord> &
    Pick<TaskOutcomeRecord, "taskId" | "outcomeVersion" | "taskJudgement" | "lifecycle">,
): TaskOutcomeRecord {
  return {
    schemaVersion: TASK_OUTCOME_SCHEMA_VERSION,
    taskContractVersion: "1",
    judgementPolicyVersion: JUDGEMENT_POLICY_VERSION,
    scope,
    entrypoint: "chat",
    decisiveRunStatus: "succeeded",
    acceptance: { status: "not_required", reason: "test" },
    delivery: { status: "not_required", reason: "test" },
    attempts: [],
    runs: [],
    submittedBy: "t",
    decidedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    decisiveRunId: "r1",
    ...partial,
  };
}

describe("R85c: contract gates + delivery confirm + effective DNA", () => {
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "r85c-agent-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    clearAwaitingDeliveriesForTests();
  });

  afterEach(() => {
    clearAwaitingDeliveriesForTests();
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("execution contract on same gates entry does NOT waive acceptance", () => {
    const contract = resolveTurnTaskContract({
      validatorsRequired: true,
      requiredValidators: ["artifact_sha"],
      kind: "execution",
    });
    expect(contract.kind).toBe("execution");
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:exec-1",
      contract,
      deliveryPhase: "awaiting",
    });
    expect(gates.acceptance.status).toBe("pending");
    expect(gates.delivery.status).toBe("pending");
  });

  it("missing/unknown contract stays pending (never auto chat waive)", () => {
    const contract = resolveTurnTaskContract({});
    expect(contract.kind).toBe("unknown");
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:unk",
      contract,
      deliveryPhase: "awaiting",
    });
    expect(gates.acceptance.status).toBe("pending");
  });

  it("chat_turn contract may waive acceptance but prepare leaves delivery pending", () => {
    const contract = resolveTurnTaskContract({
      explicitChatTurn: true,
      contractId: CHAT_TURN_CONTRACT_V1,
    });
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:chat-await",
      contract,
      deliveryPhase: "awaiting",
    });
    expect(gates.acceptance.status).toBe("not_required");
    expect(gates.delivery.status).toBe("pending");
  });

  it("prepare awaiting + send confirm delivered → closed/success", async () => {
    const contract = resolveTurnTaskContract({
      explicitChatTurn: true,
      contractId: CHAT_TURN_CONTRACT_V1,
    });
    const deliveryId = "delivery:run-ok:visible";
    const gates = resolveChatTurnCloseGates({
      deliveryId,
      contract,
      deliveryPhase: "awaiting",
    });
    const prepared = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-ok",
      taskId: "chat:bot:sess:run-ok",
      scope,
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId: gates.deliveryId,
    });
    expect(prepared.record.lifecycle).toBe("awaiting_delivery");
    expect(prepared.record.taskJudgement).toBe("incomplete");
    expect(prepared.evolution.written).toBe(false);

    registerAwaitingDelivery({
      taskId: "chat:bot:sess:run-ok",
      deliveryId,
      agentId: "bot",
      runId: "run-ok",
    });

    const confirmed = await confirmRunnerTurnDelivery(cfg, "bot", {
      taskId: "chat:bot:sess:run-ok",
      deliveryId,
      status: "delivered",
      scope,
    });
    takeAwaitingDelivery("run-ok");
    expect(confirmed.record.lifecycle).toBe("closed");
    expect(confirmed.record.taskJudgement).toBe("success");
    expect(confirmed.record.delivery.status).toBe("delivered");
    expect(confirmed.evolution.written).toBe(true);
  });

  it("acceptance passed + send confirm failed → no closed/success, no positive sample", async () => {
    const deliveryId = "delivery:run-sendfail:visible";
    const prepared = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-sendfail",
      taskId: "chat:bot:sess:run-sendfail",
      scope,
      acceptance: { status: "passed" },
      delivery: { status: "pending" },
      deliveryId,
      acceptanceEvidence: [
        {
          validatorId: "t",
          validatorVersion: "1",
          scope: "personal:u1",
          artifactDigestOrReceiptRef: "artifact:1",
          taskContractVersion: "1",
          executionVersion: "1",
        },
      ],
    });
    expect(prepared.record.lifecycle).toBe("awaiting_delivery");
    expect(prepared.evolution.written).toBe(false);

    const confirmed = await confirmRunnerTurnDelivery(cfg, "bot", {
      taskId: "chat:bot:sess:run-sendfail",
      deliveryId,
      status: "failed",
      scope,
      failureDetail: "channel_send_threw",
    });
    // Delivery failed may close as failure — must not be success / positive sample.
    expect(confirmed.record.taskJudgement).not.toBe("success");
    expect(confirmed.record.delivery.status).toBe("failed");
    expect(confirmed.evolution.written).toBe(false);

    const effective = readEffectiveEvolutionTaskOutcomes(cfg, "bot");
    expect(effective.filter((r) => r.succeeded)).toHaveLength(0);

    const port = createFileWorkingDnaObservationPort(cfg);
    const dna = port.listTaskOutcomes({
      agentId: "bot",
      startedAtMs: 0,
      endedAtMs: Date.now() + 60_000,
    });
    expect(dna.filter((r) => r.succeeded)).toHaveLength(0);
  });

  it("Working DNA observation port reads effective projection after failure→success", () => {
    const failRec = baseRecord({
      taskId: "dna-fix",
      outcomeVersion: 2,
      lifecycle: "closed",
      taskJudgement: "failure",
      reasonCode: "run_failed",
      acceptance: { status: "pending" },
      delivery: { status: "pending" },
      decisiveRunStatus: "failed",
    });
    const okRec = baseRecord({
      taskId: "dna-fix",
      outcomeVersion: 4,
      lifecycle: "closed",
      taskJudgement: "success",
    });
    expect(publishEvolutionFromTaskOutcome(cfg, "bot", failRec).written).toBe(true);
    expect(publishEvolutionFromTaskOutcome(cfg, "bot", okRec).written).toBe(true);

    const effective = readEffectiveEvolutionTaskOutcomes(cfg, "bot");
    expect(effective).toHaveLength(1);
    expect(effective[0]?.succeeded).toBe(true);
    expect(effective[0]?.outcomeVersion).toBe(4);

    const port = createFileWorkingDnaObservationPort(cfg);
    const dna = port
      .listTaskOutcomes({ agentId: "bot", startedAtMs: 0, endedAtMs: Date.now() + 60_000 })
      .filter((r) => r.taskId === "dna-fix");
    expect(dna).toHaveLength(1);
    expect(dna[0]?.succeeded).toBe(true);
  });

  it("newer version first then older replay does not re-contribute failure", () => {
    const okRec = baseRecord({
      taskId: "dna-order",
      outcomeVersion: 3,
      lifecycle: "closed",
      taskJudgement: "success",
    });
    const failRec = baseRecord({
      taskId: "dna-order",
      outcomeVersion: 1,
      lifecycle: "closed",
      taskJudgement: "failure",
      reasonCode: "run_failed",
      acceptance: { status: "pending" },
      delivery: { status: "pending" },
      decisiveRunStatus: "failed",
    });
    expect(publishEvolutionFromTaskOutcome(cfg, "bot", okRec).written).toBe(true);
    const pub = publishEvolutionFromTaskOutcome(cfg, "bot", failRec);
    expect(pub.written).toBe(false);
    expect(pub.reason).toBe("superseded_by_newer");

    const effective = readEffectiveEvolutionTaskOutcomes(cfg, "bot");
    expect(effective.filter((r) => r.taskId === "dna-order")).toHaveLength(1);
    expect(effective[0]?.succeeded).toBe(true);

    const port = createFileWorkingDnaObservationPort(cfg);
    const dna = port
      .listTaskOutcomes({ agentId: "bot", startedAtMs: 0, endedAtMs: Date.now() + 60_000 })
      .filter((r) => r.taskId === "dna-order");
    expect(dna).toHaveLength(1);
    expect(dna[0]?.succeeded).toBe(true);
  });

  it("failure corrected to cancel revokes old negative sample", () => {
    const failRec = baseRecord({
      taskId: "dna-cancel",
      outcomeVersion: 1,
      lifecycle: "closed",
      taskJudgement: "failure",
      reasonCode: "run_failed",
      acceptance: { status: "pending" },
      delivery: { status: "pending" },
      decisiveRunStatus: "failed",
    });
    const cancelRec = baseRecord({
      taskId: "dna-cancel",
      outcomeVersion: 2,
      lifecycle: "closed",
      taskJudgement: "cancelled",
      reasonCode: "user_cancelled",
      acceptance: { status: "pending" },
      delivery: { status: "pending" },
      decisiveRunStatus: "cancelled",
    });
    expect(publishEvolutionFromTaskOutcome(cfg, "bot", failRec).written).toBe(true);
    const pub = publishEvolutionFromTaskOutcome(cfg, "bot", cancelRec);
    expect(pub.written).toBe(false);
    expect(pub.reason).toMatch(/cancelled_excluded/);
    expect(pub.reason).toMatch(/revoked_older/);

    const effective = readEffectiveEvolutionTaskOutcomes(cfg, "bot");
    expect(effective.filter((r) => r.taskId === "dna-cancel")).toHaveLength(0);

    const port = createFileWorkingDnaObservationPort(cfg);
    const dna = port
      .listTaskOutcomes({ agentId: "bot", startedAtMs: 0, endedAtMs: Date.now() + 60_000 })
      .filter((r) => r.taskId === "dna-cancel");
    expect(dna).toHaveLength(0);
  });
});
