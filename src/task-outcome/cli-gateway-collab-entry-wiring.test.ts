/**
 * askOutcome W1: CLI / gateway_agent / collab production entry wiring.
 * Tests go through real agentCommand / agentCommandFromIngress / claim+apply,
 * not bare ensure/adapter helpers alone.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../cron/isolated-agent.mocks.js";
import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import { runCliAgent } from "../agents/cli-runner.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import * as modelSelectionModule from "../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { agentCommand, agentCommandFromIngress } from "../commands/agent.js";
import type { OpenBotConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/config.js";
import {
  applyCollaborationBoardClaim,
  claimCollaborationBoardItem,
  publishCollaborationBoardItem,
} from "../gateway/collaboration-learning/claim-contract-entry.js";
import { createWorkspaceCollaborationStores } from "../gateway/collaboration-learning/shared.js";
import type { RuntimeEnv } from "../runtime.js";
import { cliTurnTaskId, collabTurnTaskId, gatewayAgentTurnTaskId } from "./entrypoint-ensure.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

const { tryAcquireEnterpriseAgentRun, releaseEnterpriseAgentRun } = vi.hoisted(() => ({
  tryAcquireEnterpriseAgentRun: vi.fn(),
  releaseEnterpriseAgentRun: vi.fn(async () => {}),
}));

vi.mock("../gateway/billing/agent-run-governance.js", () => ({
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
}));

vi.mock("../gateway/billing/usage-outbox-store.js", () => ({
  enqueueUsageOutbox: vi.fn(async () => ({ id: "u" })),
}));
vi.mock("../gateway/billing/usage-outbox-drain.js", () => ({
  drainUsageOutboxRecord: vi.fn(async () => ({})),
}));

vi.mock("../agents/cli-runner.js", () => ({ runCliAgent: vi.fn() }));
vi.mock("../agents/auth-profiles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/auth-profiles.js")>()),
  ensureAuthProfileStore: vi.fn(() => ({ version: 1, profiles: {} })),
}));
vi.mock("../agents/workspace.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/workspace.js")>()),
  ensureAgentWorkspace: vi.fn(async ({ dir }: { dir: string }) => ({ dir })),
}));
vi.mock("../agents/skills.js", () => ({ buildWorkspaceSkillSnapshot: vi.fn(() => undefined) }));
vi.mock("../agents/skills/refresh.js", () => ({ getSkillsSnapshotVersion: vi.fn(() => 0) }));

const recordRunnerTurnOutcomeMock = vi.fn();
vi.mock("./runtime-from-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime-from-runner.js")>();
  return {
    ...actual,
    recordRunnerTurnOutcome: (...args: unknown[]) => recordRunnerTurnOutcomeMock(...args),
  };
});

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(() => {
    throw new Error("exit");
  }),
};

const EMBEDDED = "openai/gpt-5.2";

function runResult() {
  return {
    payloads: [{ text: "ok" }],
    meta: {
      durationMs: 7,
      agentMeta: {
        sessionId: "s",
        provider: "openai",
        model: "gpt-5.2",
        usage: { input: 1, output: 1 },
      },
    },
  } as never;
}

function mockAgentConfig(home: string, agentDir: string) {
  const cfg = {
    agents: {
      defaults: {
        model: { primary: EMBEDDED },
        models: { [EMBEDDED]: {} },
        workspace: path.join(home, "openclaw"),
      },
      list: [{ id: "main", default: true, agentDir }],
    },
    session: { store: path.join(home, "sessions.json"), mainKey: "main" },
  } as OpenBotConfig;
  vi.spyOn(configModule, "loadConfig").mockReturnValue(cfg);
  return cfg;
}

describe("askOutcome W1 CLI / gateway_agent entry wiring via agentCommand*", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    recordRunnerTurnOutcomeMock.mockReset();
    recordRunnerTurnOutcomeMock.mockResolvedValue({
      record: { taskId: "t", entrypoint: "cli" },
      evolution: { written: false, reason: "test" },
    });
    configModule.clearRuntimeConfigSnapshot();
    vi.mocked(loadModelCatalog).mockResolvedValue([]);
    vi.mocked(modelSelectionModule.isCliProvider).mockReturnValue(false);
    vi.spyOn(configModule, "readConfigFileSnapshotForWrite").mockResolvedValue({
      snapshot: { valid: false, resolved: {} as OpenBotConfig },
      writeOptions: {},
    } as Awaited<ReturnType<typeof configModule.readConfigFileSnapshotForWrite>>);
    vi.mocked(runEmbeddedPiAgent).mockImplementation(async () => runResult());
    vi.mocked(runCliAgent).mockImplementation(async () => runResult());
    tryAcquireEnterpriseAgentRun.mockResolvedValue({ acquired: false, skipped: true });
  });

  it("agentCommand (CLI) ensures tip entrypoint=cli and records success closeout", async () => {
    await withTempHomeBase(
      async (home) => {
        const agentDir = path.join(home, "agent-main");
        fs.mkdirSync(agentDir, { recursive: true });
        mockAgentConfig(home, agentDir);
        const runId = "cli-run-w1-1";
        await agentCommand(
          {
            message: "hello cli",
            to: "+15550001",
            agentId: "main",
            runId,
            gatewayClientUser: "ops@example.com",
          },
          runtime,
        );
        expect(recordRunnerTurnOutcomeMock).toHaveBeenCalled();
        const call = recordRunnerTurnOutcomeMock.mock.calls.find(
          (c) => (c[2] as { entrypoint?: string }).entrypoint === "cli",
        );
        expect(call).toBeTruthy();
        expect(call![2]).toMatchObject({
          success: true,
          runId,
          taskId: cliTurnTaskId({ agentId: "main", runId }),
          entrypoint: "cli",
        });
        const tip = new DurableTaskOutcomeStore(
          path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME),
        ).loadTask(cliTurnTaskId({ agentId: "main", runId }));
        expect(tip?.entrypoint).toBe("cli");
      },
      { prefix: "w1-cli-entry-" },
    );
  });

  it("agentCommandFromIngress ensures tip entrypoint=gateway_agent and records success", async () => {
    await withTempHomeBase(
      async (home) => {
        const agentDir = path.join(home, "agent-main");
        fs.mkdirSync(agentDir, { recursive: true });
        mockAgentConfig(home, agentDir);
        const runId = "gw-run-w1-1";
        await agentCommandFromIngress(
          {
            message: "hello gateway",
            to: "+15550002",
            agentId: "main",
            runId,
            senderIsOwner: false,
            gatewayClientUser: "alice@example.com",
            gatewayClientPlatformUserId: "platform-user:alice",
          },
          runtime,
        );
        const call = recordRunnerTurnOutcomeMock.mock.calls.find(
          (c) => (c[2] as { entrypoint?: string }).entrypoint === "gateway_agent",
        );
        expect(call).toBeTruthy();
        expect(call![2]).toMatchObject({
          success: true,
          runId,
          taskId: gatewayAgentTurnTaskId({ agentId: "main", runId }),
          entrypoint: "gateway_agent",
        });
        const tip = new DurableTaskOutcomeStore(
          path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME),
        ).loadTask(gatewayAgentTurnTaskId({ agentId: "main", runId }));
        expect(tip?.entrypoint).toBe("gateway_agent");
      },
      { prefix: "w1-gw-entry-" },
    );
  });

  it("commercial deny closeout records authz_denied through agentCommand", async () => {
    await withTempHomeBase(
      async (home) => {
        const agentDir = path.join(home, "agent-main");
        fs.mkdirSync(agentDir, { recursive: true });
        mockAgentConfig(home, agentDir);
        tryAcquireEnterpriseAgentRun.mockResolvedValue({
          acquired: false,
          skipped: false,
          message: "quota exceeded",
        });
        const runId = "cli-deny-1";
        await expect(
          agentCommand(
            {
              message: "nope",
              to: "+15550003",
              agentId: "main",
              runId,
              gatewayClientUser: "ops@example.com",
            },
            runtime,
          ),
        ).rejects.toThrow(/quota exceeded/);
        const call = recordRunnerTurnOutcomeMock.mock.calls.find(
          (c) => (c[2] as { taskId?: string }).taskId === cliTurnTaskId({ agentId: "main", runId }),
        );
        expect(call).toBeTruthy();
        expect(call![2]).toMatchObject({
          success: false,
          failureReason: "authz_denied",
          entrypoint: "cli",
        });
      },
      { prefix: "w1-cli-deny-" },
    );
  });
});

describe("askOutcome W1 collab claim/apply entry wiring", () => {
  const tempDirs: string[] = [];
  const savedStateDir = process.env.OPENBOT_STATE_DIR;
  const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
  const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

  afterEach(async () => {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    if (savedStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = savedStateDir;
    }
    if (savedOpenbotConfigPath === undefined) {
      delete process.env.OPENBOT_CONFIG_PATH;
    } else {
      process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
    }
    if (savedOpenclawConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // CLI describe spies loadConfig; restore so seed/authority use the collab snapshot.
    vi.restoreAllMocks();
    recordRunnerTurnOutcomeMock.mockReset();
    recordRunnerTurnOutcomeMock.mockResolvedValue({
      record: { taskId: "t", entrypoint: "collab" },
      evolution: { written: false, reason: "test" },
    });
  });

  async function useCollabConfig(): Promise<{
    root: string;
    cfg: OpenBotConfig;
    agentDir: string;
  }> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "w1-collab-entry-"));
    tempDirs.push(root);
    const agentDir = path.join(root, "agent-ws");
    fs.mkdirSync(agentDir, { recursive: true });
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    const cfg = {
      agents: {
        defaults: { workspace: agentDir },
        list: [{ id: "main", default: true, agentDir }],
      },
      gateway: { security: { profile: "personal_local" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
        runtimeNamespace: true,
        task: { claimContract: true },
      },
    } as OpenBotConfig;
    const configPath = path.join(root, "openbot.json");
    fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();
    return { root, cfg, agentDir };
  }

  it("claim+apply through production entry persist collab tip and record apply closeout", async () => {
    const { cfg, agentDir } = await useCollabConfig();
    const groupId = "grp_w1";
    const taskId = "task_w1";
    const seed: Task = {
      taskId,
      groupId,
      title: "W1",
      status: "in_progress",
      ownerMemberId: "lead",
      assignedMemberIds: ["lead"],
      createdBy: "lead",
      updatedBy: "lead",
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    } as Task;
    const { objectStorage } = createWorkspaceCollaborationStores();
    await objectStorage.writeObject(groupId, "task", taskId, seed);

    const published = await publishCollaborationBoardItem({
      groupId,
      taskId,
      title: "item",
      remainingWork: "do it",
      acceptanceCriteria: ["done"],
      intendedClaimantIds: ["member-a"],
      actor: "lead",
      cfg,
    });
    const claimed = await claimCollaborationBoardItem({
      groupId,
      taskId,
      itemId: published.itemId,
      claimantId: "member-a",
      cfg,
    });
    expect(claimed.claimantId).toBe("member-a");

    const expectedTaskId = collabTurnTaskId({
      groupId,
      boardItemId: published.itemId,
      claimId: "member-a",
    });
    const tipAfterClaim = new DurableTaskOutcomeStore(
      path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME),
    ).loadTask(expectedTaskId);
    expect(tipAfterClaim?.entrypoint).toBe("collab");

    await applyCollaborationBoardClaim({
      groupId,
      taskId,
      itemId: published.itemId,
      actor: "member-a",
      cfg,
    });
    const applyCall = recordRunnerTurnOutcomeMock.mock.calls.find(
      (c) => (c[2] as { taskId?: string }).taskId === expectedTaskId,
    );
    expect(applyCall).toBeTruthy();
    expect(applyCall![2]).toMatchObject({
      success: true,
      entrypoint: "collab",
      taskId: expectedTaskId,
    });
  });
});
