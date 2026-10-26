import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import {
  publishEvolutionFromTaskOutcome,
  readEffectiveEvolutionTaskOutcomes,
} from "./growth-bridge.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import {
  JUDGEMENT_POLICY_VERSION,
  TASK_OUTCOME_SCHEMA_VERSION,
  type TaskOutcomeRecord,
  type TrustedScope,
} from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:x",
  subjectRef: "u",
  authzScopeRef: "s",
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

function closeSuccess(chat: ChatTaskOutcomeAdapter, taskId: string): TaskOutcomeRecord {
  const opened = chat.createOrRestore({
    taskId,
    scope,
    taskContractVersion: "1",
  });
  if (!opened.ok) {
    throw new Error("open");
  }
  let r = chat.recordAttempt(
    taskId,
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
    taskId,
    r.record.outcomeVersion,
    opened.fencingToken,
    { status: "not_required", reason: "test" },
    { allowRetry: true, scope },
  );
  if (!r.ok) {
    throw new Error(r.code);
  }
  r = chat.setDelivery(
    taskId,
    r.record.outcomeVersion,
    opened.fencingToken,
    { status: "not_required", reason: "test" },
    "d1",
    { scope },
  );
  if (!r.ok) {
    throw new Error(r.code);
  }
  return r.record;
}

describe("growth-bridge", () => {
  let root = "";
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "to-bridge-"));
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "to-agent-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("does not publish incomplete awaiting tasks as success", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "g1",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const pub = publishEvolutionFromTaskOutcome(cfg, "bot", opened.record);
    expect(pub.written).toBe(false);
    expect(readEvolutionTaskOutcomes(cfg, "bot")).toHaveLength(0);
  });

  it("does not publish cancelled as capability failure", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "g2",
      scope,
      taskContractVersion: "1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const cancelled = chat.cancel("g2", opened.record.outcomeVersion, opened.fencingToken, {
      scope,
    });
    if (!cancelled.ok) {
      throw new Error("cancel");
    }
    const pub = publishEvolutionFromTaskOutcome(cfg, "bot", cancelled.record);
    expect(pub.written).toBe(false);
    expect(readEvolutionTaskOutcomes(cfg, "bot")).toHaveLength(0);
  });

  it("idempotent republish does not double-append", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const record = closeSuccess(chat, "g-idem");
    const first = publishEvolutionFromTaskOutcome(cfg, "bot", record);
    const second = publishEvolutionFromTaskOutcome(cfg, "bot", record);
    expect(first.written).toBe(true);
    expect(second.written).toBe(false);
    expect(second.reason).toBe("already_published");
    const effective = readEffectiveEvolutionTaskOutcomes(cfg, "bot");
    expect(effective).toHaveLength(1);
    expect(effective[0]?.succeeded).toBe(true);
  });

  it("failure then success correction keeps only effective success sample", () => {
    const failRec = baseRecord({
      taskId: "g-fix",
      outcomeVersion: 2,
      lifecycle: "closed",
      taskJudgement: "failure",
      reasonCode: "run_failed",
      acceptance: { status: "pending" },
      delivery: { status: "pending" },
      decisiveRunStatus: "failed",
    });
    const okRec = baseRecord({
      taskId: "g-fix",
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
    expect(effective[0]?.taskId).toBe("g-fix");
  });

  it("two OS processes publishing same closed event append once", async () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const record = closeSuccess(chat, "g-race");
    const recordPath = path.join(root, "race-record.json");
    const barrier = path.join(root, "race-barrier");
    fs.writeFileSync(recordPath, JSON.stringify(record), "utf8");

    const worker = fileURLToPath(new URL("./r85-growth-race-worker.mts", import.meta.url));
    const spawnOne = (id: string) =>
      spawn(process.execPath, ["--import", "tsx", worker, agentDir, recordPath, barrier, id], {
        stdio: ["ignore", "pipe", "pipe"],
      });

    const p1 = spawnOne("a");
    const p2 = spawnOne("b");
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(barrier, "go", "utf8");

    const wait = (child: ReturnType<typeof spawn>) =>
      new Promise<{ code: number; err: string }>((resolve) => {
        let err = "";
        child.stderr?.on("data", (d) => {
          err += String(d);
        });
        child.on("exit", (code) => resolve({ code: code ?? 1, err }));
      });
    const [c1, c2] = await Promise.all([wait(p1), wait(p2)]);
    expect(c1.code, c1.err).toBe(0);
    expect(c2.code, c2.err).toBe(0);

    const ra = JSON.parse(fs.readFileSync(path.join(root, "growth-race-a.json"), "utf8")) as {
      written: boolean;
    };
    const rb = JSON.parse(fs.readFileSync(path.join(root, "growth-race-b.json"), "utf8")) as {
      written: boolean;
    };
    expect([ra.written, rb.written].filter(Boolean)).toHaveLength(1);

    const effective = readEffectiveEvolutionTaskOutcomes(cfg, "bot");
    expect(effective).toHaveLength(1);
    const successes = readEvolutionTaskOutcomes(cfg, "bot").filter(
      (row) => row.taskId === "g-race" && row.succeeded && !(row as { revoked?: boolean }).revoked,
    );
    expect(successes).toHaveLength(1);
  });
});
