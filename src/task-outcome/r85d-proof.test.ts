import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { appendEvolutionTaskOutcome } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { createFileWorkingDnaObservationPort } from "../gateway/evolution-control/adapters/working-dna.js";
import {
  CHAT_TURN_CONTRACT_V1,
  resolveChatTurnCloseGates,
  resolveTurnTaskContract,
} from "./chat-entry.js";
import { resolveRequiredDeliveryConfirmStatus } from "./delivery-confirm.js";
import { readEffectiveEvolutionTaskOutcomes } from "./growth-bridge.js";
import {
  clearAwaitingDeliveriesForTests,
  hydrateAwaitingDeliveriesFromDisk,
  peekAwaitingDelivery,
  registerAwaitingDelivery,
  resolveAndTakeAwaitingDelivery,
} from "./pending-delivery.js";
import { confirmRunnerTurnDelivery, recordRunnerTurnOutcome } from "./runtime-from-runner.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:u1",
  subjectRef: "u1",
  authzScopeRef: "chat-entry",
};

describe("R85d: deliver AND + execution pending + durable pending + DNA fields", () => {
  let agentDir = "";
  let storeRoot = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "r85d-agent-"));
    storeRoot = path.join(agentDir, "task-outcomes");
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    clearAwaitingDeliveriesForTests(storeRoot);
  });

  afterEach(() => {
    clearAwaitingDeliveriesForTests(storeRoot);
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("AND: any required deliver failure → failed (OR must not mask)", () => {
    expect(
      resolveRequiredDeliveryConfirmStatus([
        { source: "deliver", ok: true },
        { source: "deliver", ok: false, error: "channel_b_failed" },
      ]),
    ).toBe("failed");
  });

  it("enqueue_only success is NOT delivered", () => {
    expect(resolveRequiredDeliveryConfirmStatus([{ source: "enqueue_only", ok: true }])).toBe(
      "delivery_unknown",
    );
  });

  it("all required delivers ok → delivered", () => {
    expect(
      resolveRequiredDeliveryConfirmStatus([
        { source: "deliver", ok: true },
        { source: "deliver", ok: true },
      ]),
    ).toBe("delivered");
  });

  it("real send failure confirm → no closed/success, no positive evolution", async () => {
    const deliveryId = "delivery:run-r85d-fail:visible";
    const taskId = "chat:bot:sess:run-r85d-fail";
    const contract = resolveTurnTaskContract({
      explicitChatTurn: true,
      contractId: CHAT_TURN_CONTRACT_V1,
    });
    const gates = resolveChatTurnCloseGates({
      deliveryId,
      contract,
      deliveryPhase: "awaiting",
    });
    const prepared = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-r85d-fail",
      taskId,
      scope,
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId: gates.deliveryId,
    });
    expect(prepared.record.lifecycle).toBe("awaiting_delivery");
    expect(prepared.evolution.written).toBe(false);

    const confirmed = await confirmRunnerTurnDelivery(cfg, "bot", {
      taskId,
      deliveryId,
      status: "failed",
      scope,
      failureDetail: "routeReply threw",
    });
    expect(confirmed.record.taskJudgement).not.toBe("success");
    expect(confirmed.record.delivery.status).toBe("failed");
    expect(confirmed.evolution.written).toBe(false);
    expect(readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter((r) => r.succeeded)).toHaveLength(
      0,
    );
  });

  it("execution task with empty validators stays pending (not chat waive)", () => {
    const contract = resolveTurnTaskContract({
      kind: "execution",
      validatorsRequired: false,
      requiredValidators: [],
    });
    expect(contract.kind).toBe("execution");
    expect(contract.requiredValidators).toEqual([]);
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:exec-noval",
      contract,
      deliveryPhase: "awaiting",
    });
    expect(gates.acceptance.status).toBe("pending");
    expect(gates.delivery.status).toBe("pending");
  });

  it("absence of validators alone does NOT invent chat_turn waiver", () => {
    const contract = resolveTurnTaskContract({
      // no explicitChatTurn, no kind, no validators
    });
    expect(contract.kind).toBe("unknown");
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:no-class",
      contract,
      deliveryPhase: "awaiting",
    });
    expect(gates.acceptance.status).toBe("pending");
  });

  it("delivery intent survives restart and confirms without caller runId", async () => {
    const runId = "run-r85d-persist";
    const deliveryId = "delivery:run-r85d-persist:visible";
    const taskId = "chat:bot:sess:run-r85d-persist";

    const contract = resolveTurnTaskContract({
      explicitChatTurn: true,
      contractId: CHAT_TURN_CONTRACT_V1,
    });
    const gates = resolveChatTurnCloseGates({
      deliveryId,
      contract,
      deliveryPhase: "awaiting",
    });
    await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId,
      taskId,
      scope,
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId,
    });

    registerAwaitingDelivery({
      taskId,
      deliveryId,
      agentId: "bot",
      runId,
      persistRoot: storeRoot,
    });
    expect(fs.existsSync(path.join(storeRoot, "pending-deliveries"))).toBe(true);

    // Simulate process restart: wipe memory, rehydrate from disk.
    clearAwaitingDeliveriesForTests(); // memory only
    expect(peekAwaitingDelivery(runId)).toBeUndefined();
    const hydrated = hydrateAwaitingDeliveriesFromDisk(storeRoot);
    expect(hydrated).toBeGreaterThanOrEqual(1);

    // Caller omitted runId — resolve via deliveryId + persistRoot.
    const pending = peekAwaitingDelivery({ deliveryId, persistRoot: storeRoot });
    expect(pending?.taskId).toBe(taskId);
    expect(pending?.runId).toBe(runId);

    const confirmed = await confirmRunnerTurnDelivery(cfg, "bot", {
      taskId: pending!.taskId,
      deliveryId: pending!.deliveryId,
      status: "delivered",
      scope,
    });
    resolveAndTakeAwaitingDelivery({
      runId: pending!.runId,
      deliveryId: pending!.deliveryId,
      persistRoot: storeRoot,
    });
    expect(confirmed.record.lifecycle).toBe("closed");
    expect(confirmed.record.taskJudgement).toBe("success");
    expect(confirmed.evolution.written).toBe(true);
    // Durable file removed after take.
    expect(peekAwaitingDelivery({ runId, persistRoot: storeRoot })).toBeUndefined();
  });

  it("Working DNA port preserves cohort/latency/security/humanTakeover", () => {
    const occurredAt = Date.now();
    appendEvolutionTaskOutcome(cfg, {
      agentId: "bot",
      occurredAt,
      succeeded: true,
      taskId: "obs-fields",
      runId: "run-obs",
      cohortRef: "cohort-r85d",
      latencyMs: 42,
      securityViolation: false,
      humanTakeover: true,
      tenantId: "personal:u1",
    });

    const port = createFileWorkingDnaObservationPort(cfg);
    const rows = port
      .listTaskOutcomes({
        agentId: "bot",
        startedAtMs: occurredAt - 1000,
        endedAtMs: occurredAt + 1000,
      })
      .filter((r) => r.taskId === "obs-fields");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cohortRef: "cohort-r85d",
      latencyMs: 42,
      securityViolation: false,
      humanTakeover: true,
      succeeded: true,
    });
  });
});
