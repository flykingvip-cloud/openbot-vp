/**
 * Learning-contribution revoke against an injected collaboration store.
 * createWorkspaceCollaborationStores() without cfg calls loadConfig(); this file never does that.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { resolveEvolutionTaskOutcomesPath } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { createWorkspaceCollaborationStores } from "../gateway/collaboration-learning/shared.js";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import {
  createExperienceVerifiedHandler,
  loadExperienceVerifiedContribution,
} from "./experience-verified-handler.js";
import { publishEvolutionFromTaskOutcome } from "./growth-bridge.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type { TrustedScope } from "./types.js";

const childPath = fileURLToPath(
  new URL("./closed-loop-isolation-restart-child.ts", import.meta.url),
);

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:subject-alice",
  subjectRef: "subject:alice",
  authzScopeRef: "scope:isolation",
};

const dirs: string[] = [];
const previousStateDir = process.env.OPENBOT_STATE_DIR;

afterEach(() => {
  if (previousStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = previousStateDir;
  }
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function asset(scopeId: string): AgentLearningAsset {
  return {
    assetId: "asset-1",
    botId: "bot",
    sourceGroupId: scopeId,
    sourceCapsuleId: "cap-1",
    assetType: "lesson",
    status: "active",
    abstractedContent: { lesson: "先核对归属再改结果" },
    injectedCount: 1,
    outcomeVerifiedCount: 0,
    updatedAt: 1,
  };
}

async function runChild(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", childPath, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return await new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

describe("isolated experience contribution revoke", () => {
  it("revokes an adopted success once across correction, retry, and process restart", async () => {
    const stateDir = tempDir("learn-state-");
    process.env.OPENBOT_STATE_DIR = stateDir;
    const agentDir = path.join(stateDir, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const stores = createWorkspaceCollaborationStores(cfg);
    expect(stores.groupRootDir.startsWith(stateDir)).toBe(true);
    const scopeId = scopeIdOf(scope);
    await stores.learningStorage.writeLearningAssets(scopeId, [asset(scopeId)]);

    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store, submittedBy: "learn" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "task-learn",
      scope,
      taskContractVersion: "1.0.0",
    });
    if (!opened.ok) {
      throw new Error(opened.message);
    }
    const fencing = opened.fencingToken;
    let version = opened.record.outcomeVersion;
    const exposed = service.submit(
      "task-learn",
      {
        type: "set_experience_exposure",
        experienceExposure: {
          scopes: [{ scopeId, botId: "bot", assetIds: ["asset-1"] }],
          attachedAt: "2026-11-01T00:00:00.000Z",
          adoptedAssetIds: ["asset-1"],
        },
        expectedVersion: version,
        fencingToken: fencing,
      },
      { requiredScope: scope },
    );
    expect(exposed.ok).toBe(true);
    if (!exposed.ok) {
      return;
    }
    version = exposed.record.outcomeVersion;
    const accepted = service.submit(
      "task-learn",
      {
        type: "set_acceptance",
        acceptance: { status: "passed" },
        allowRetry: false,
        expectedVersion: version,
        fencingToken: fencing,
      },
      { requiredScope: scope },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    version = accepted.record.outcomeVersion;
    const delivered = service.submit(
      "task-learn",
      {
        type: "set_delivery",
        delivery: { status: "delivered" },
        deliveryId: "d1",
        expectedVersion: version,
        fencingToken: fencing,
      },
      { requiredScope: scope },
    );
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) {
      return;
    }
    expect(delivered.record.taskJudgement).toBe("success");

    const boom = path.join(stateDir, "allow-experience");
    const runtime = new OutcomeConsumerRuntime(store, {
      handlers: [
        {
          consumerId: "experience-gate",
          onEvent: () => {
            if (!fs.existsSync(boom)) {
              throw new Error("experience handler not acked");
            }
          },
        },
        createExperienceVerifiedHandler(store, { stores }),
      ],
    });
    const blocked = await runtime.drain((taskId) => store.loadTask(taskId));
    expect(blocked.deferred).toBeGreaterThan(0);
    expect(store.listPendingOutbox().length).toBeGreaterThan(0);
    expect(
      (await stores.learningStorage.readLearningAssets(scopeId))[0]?.outcomeVerifiedCount ?? 0,
    ).toBe(0);

    fs.writeFileSync(boom, "go");
    const applied = await runtime.drain((taskId) => store.loadTask(taskId));
    expect(applied.deferred).toBe(0);
    expect(
      (await stores.learningStorage.readLearningAssets(scopeId))[0]?.outcomeVerifiedCount,
    ).toBe(1);
    const contribution = loadExperienceVerifiedContribution(store, scopeId, "task-learn");
    expect(contribution?.status).toBe("applied");
    expect(contribution?.assetIds).toEqual(["asset-1"]);

    const again = await runtime.drain((taskId) => store.loadTask(taskId));
    expect(again.processed).toBe(0);
    expect(
      (await stores.learningStorage.readLearningAssets(scopeId))[0]?.outcomeVerifiedCount,
    ).toBe(1);

    store.close();
    const raced = await Promise.all(
      ["reject-learn-a", "reject-learn-b"].map(async (commandId, index) => {
        const outFile = path.join(stateDir, `race-${index}.json`);
        const child = await runChild(
          [
            "reject",
            agentDir,
            "task-learn",
            String(delivered.record.outcomeVersion),
            "alice",
            commandId,
            outFile,
          ],
          { ...process.env, OPENBOT_STATE_DIR: stateDir },
        );
        const body = fs.readFileSync(outFile, "utf8");
        expect(child.code, `${child.stderr}\n${body}`).toBe(0);
        return JSON.parse(body) as {
          ok: boolean;
          code?: string;
          version?: number;
          replayed?: boolean;
        };
      }),
    );
    const winners = raced.filter((row) => row.ok && row.replayed !== true);
    expect(winners).toHaveLength(1);
    expect(raced.some((row) => row.code === "version_conflict")).toBe(true);
    const winnerVersion = winners[0]?.version;
    expect(winnerVersion).toBe(delivered.record.outcomeVersion + 1);

    const afterRace = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const tip = afterRace.loadTask("task-learn");
    expect(tip?.taskJudgement).toBe("failure");
    expect(tip?.outcomeVersion).toBe(winnerVersion);
    expect(tip?.revisionKind).toBe("correction");
    const prior = afterRace.loadTaskVersion("task-learn", delivered.record.outcomeVersion);
    afterRace.close();
    if (!tip || !prior) {
      throw new Error("missing tip");
    }
    publishEvolutionFromTaskOutcome(cfg, "bot", prior);
    const published = publishEvolutionFromTaskOutcome(cfg, "bot", tip);
    expect(published.written || published.reason.includes("revoked")).toBe(true);
    const lines = fs
      .readFileSync(resolveEvolutionTaskOutcomesPath(cfg, "bot"), "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as { revoked?: boolean; succeeded?: boolean; outcomeVersion?: number },
      );
    expect(lines.some((line) => line.revoked === true)).toBe(true);
    expect(
      lines.find((line) => !line.revoked && line.outcomeVersion === tip.outcomeVersion)?.succeeded,
    ).toBe(false);

    const drainedChild = path.join(stateDir, "drain.json");
    const firstRestart = await runChild(
      ["experience-drain", agentDir, stateDir, scopeId, drainedChild],
      { ...process.env, OPENBOT_STATE_DIR: stateDir },
    );
    const firstBody = fs.readFileSync(drainedChild, "utf8");
    expect(firstRestart.code, firstRestart.stderr + firstBody).toBe(0);
    const firstResult = JSON.parse(firstBody) as {
      counts: Array<{ outcomeVerifiedCount: number }>;
      groupRootDir: string;
    };
    expect(firstResult.groupRootDir.startsWith(stateDir)).toBe(true);
    expect(firstResult.counts[0]?.outcomeVerifiedCount).toBe(0);
    const revoked = loadExperienceVerifiedContribution(
      new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes")),
      scopeId,
      "task-learn",
    );
    expect(revoked?.status).toBe("revoked");

    const secondBodyPath = path.join(stateDir, "drain-2.json");
    const secondRestart = await runChild(
      ["experience-drain", agentDir, stateDir, scopeId, secondBodyPath],
      { ...process.env, OPENBOT_STATE_DIR: stateDir },
    );
    expect(secondRestart.code, secondRestart.stderr).toBe(0);
    const secondResult = JSON.parse(fs.readFileSync(secondBodyPath, "utf8")) as {
      counts: Array<{ outcomeVerifiedCount: number }>;
    };
    expect(secondResult.counts[0]?.outcomeVerifiedCount).toBe(0);
  });
});
