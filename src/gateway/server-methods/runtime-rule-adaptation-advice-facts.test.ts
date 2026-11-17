import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyEmployeeAdvicePolicyFactsFromBoard,
  createEmployeeAdvicePolicyFactSource,
  createOfficialEmployeeAdvicePolicyFactSource,
  resolveEmployeeAdviceApprovedTarget,
  resolveEmployeeAdviceProductionFacts,
  resolveEmployeeAdviceSessionFile,
  resolveEmployeeAdviceTargetAgentId,
} from "./runtime-rule-adaptation-advice-facts.ts";

const identity = {
  employeeId: "employee-server",
  principalId: "user:employee-server",
  tenantId: "tenant-1",
  seatId: "seat-1",
  authorizationStatus: "authorized" as const,
};

function configWithAgent() {
  return {
    agents: {
      defaults: { contextTokens: 32000 },
      list: [{ id: "personal-bot" }],
    },
    models: {
      providers: {
        deepseek: {
          models: [{ id: "deepseek-v4-flash", contextWindow: 64000 }],
        },
      },
    },
  } as never;
}

describe("resolveEmployeeAdviceTargetAgentId", () => {
  it("uses a parsed session key or a valid agentId and does not fall back to the default agent", () => {
    expect(resolveEmployeeAdviceTargetAgentId({ sessionKey: "agent:personal-bot:chat" })).toEqual({
      ok: true,
      agentId: "personal-bot",
      sessionKey: "agent:personal-bot:chat",
    });
    expect(resolveEmployeeAdviceTargetAgentId({ agentId: "personal-bot" })).toEqual({
      ok: true,
      agentId: "personal-bot",
    });
    expect(resolveEmployeeAdviceTargetAgentId({ sessionKey: "agent:real-chat" }).ok).toBe(false);
    expect(resolveEmployeeAdviceTargetAgentId({}).ok).toBe(false);
  });

  it("rejects a session key and agentId that do not agree", () => {
    const resolved = resolveEmployeeAdviceTargetAgentId({
      sessionKey: "agent:personal-bot:chat",
      agentId: "other-bot",
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toContain("不一致");
    }
  });
});

describe("resolveEmployeeAdviceApprovedTarget", () => {
  it("approves view-and-request-advice access without requiring activation rights", async () => {
    const resolved = await resolveEmployeeAdviceApprovedTarget({
      identity,
      targetRef: { agentId: "personal-bot" },
      config: configWithAgent(),
      checkAgentAccess: async () => ({
        ok: true,
        agentId: "personal-bot",
        tenantId: "tenant-1",
        userId: "employee-server",
        activationAuthorized: false,
      }),
    });
    expect(resolved.targetAuthorization).toBe("approved");
    expect(resolved.approvedTarget?.scopeId).toBe("personal-bot");
  });

  it("denies when view access is refused", async () => {
    const resolved = await resolveEmployeeAdviceApprovedTarget({
      identity,
      targetRef: { agentId: "personal-bot" },
      config: configWithAgent(),
      checkAgentAccess: async () => ({
        ok: false,
        denied: true,
        reason: "当前账号没有查看该目标并请求建议的权限。",
      }),
    });
    expect(resolved.targetAuthorization).toBe("denied");
  });
});

describe("resolveEmployeeAdviceProductionFacts", () => {
  it("leaves compatibility and policy state unset when the source has no record", async () => {
    const facts = await resolveEmployeeAdviceProductionFacts({
      identity,
      targetRef: { agentId: "personal-bot" },
      config: configWithAgent(),
      officialModel: { provider: "deepseek", model: "deepseek-v4-flash" },
      checkAgentAccess: async () => ({
        ok: true,
        agentId: "personal-bot",
        tenantId: "tenant-1",
        userId: "employee-server",
        activationAuthorized: false,
      }),
      policyFactSource: createEmployeeAdvicePolicyFactSource([]),
    });
    expect(facts.targetAuthorization).toBe("approved");
    expect(facts.compatibilityRecord).toBeUndefined();
    expect(facts.expectedPolicyState).toBeUndefined();
    expect(facts.currentContextTokens).toBe(32000);
    expect(facts.modelContextWindow).toBe(64000);
  });

  it("does not treat a config cap alone as the effective value", async () => {
    const facts = await resolveEmployeeAdviceProductionFacts({
      identity,
      targetRef: { agentId: "personal-bot" },
      config: {
        agents: { defaults: { contextTokens: 32000 }, list: [{ id: "personal-bot" }] },
      } as never,
      officialModel: { provider: "deepseek", model: "deepseek-v4-flash" },
      checkAgentAccess: async () => ({
        ok: true,
        agentId: "personal-bot",
        tenantId: "tenant-1",
        userId: "employee-server",
      }),
    });
    expect(facts.configContextTokenCap).toBe(32000);
    expect(facts.modelContextWindow).toBeUndefined();
    expect(facts.currentContextTokens).toBeUndefined();
  });
});

const BOARD_POLICY_VERSION = {
  policyHash: "board-policy-hash-aaaa",
  protocolVersion: "1.1",
  compilerRevision: "1.2.0",
};

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function openTempSessionsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t66-advice-facts-"));
  tmpDirs.push(dir);
  return dir;
}

function taskBoardPath(sessionFile: string): string {
  return `${sessionFile}.task-board.json`;
}

function writeTaskBoard(sessionFile: string, board: unknown): void {
  fs.writeFileSync(taskBoardPath(sessionFile), `${JSON.stringify(board, null, 2)}\n`, "utf8");
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: "effective",
    operation: "activate",
    taskId: "task:existing-1",
    policyHash: BOARD_POLICY_VERSION.policyHash,
    protocolVersion: BOARD_POLICY_VERSION.protocolVersion,
    compilerRevision: BOARD_POLICY_VERSION.compilerRevision,
    implementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
    ...overrides,
  };
}

describe("createOfficialEmployeeAdvicePolicyFactSource", () => {
  it("copies policy version from an existing board snapshot and does not invent approval constants", async () => {
    const sessionsDir = openTempSessionsDir();
    const sessionFile = resolveEmployeeAdviceSessionFile({
      agentId: "personal-bot",
      sessionKey: "agent:personal-bot:chat",
      sessionsDir,
    });
    expect(sessionFile).toBeTruthy();
    fs.mkdirSync(path.dirname(sessionFile!), { recursive: true });
    fs.writeFileSync(sessionFile!, "", "utf8");
    writeTaskBoard(sessionFile!, {
      current: {
        taskId: "task:existing-1",
        title: "Existing work",
        goalText: "Already admitted",
        unfinished: true,
        stop: { summary: "stop", workspacePaths: [] },
        createdAtMs: 1,
      },
      parked: [],
      focusRevision: 1,
      writeEpoch: 3,
      scope: { tenantId: "tenant-1", userId: "employee-server", sessionId: "chat" },
      runtimeRuleAdaptationByTaskId: {
        "task:existing-1": { current: snapshot(), history: [] },
      },
    });

    const source = createOfficialEmployeeAdvicePolicyFactSource({ sessionsDir });
    const facts = await source.read({
      tenantId: "tenant-1",
      employeeId: "employee-server",
      agentId: "personal-bot",
      sessionKey: "agent:personal-bot:chat",
    });
    expect(facts?.expectedPolicyVersion).toEqual(BOARD_POLICY_VERSION);
    expect(facts?.compatibilityRecord).toBeUndefined();
    expect(facts?.expectedPolicyState).toBeUndefined();
    expect(JSON.stringify(facts)).not.toContain("approved_compatible");
    expect(JSON.stringify(facts)).not.toContain('"active"');
  });

  it("returns no policy facts when the board has no snapshot, and does not create a task", async () => {
    const sessionsDir = openTempSessionsDir();
    const sessionFile = resolveEmployeeAdviceSessionFile({
      agentId: "personal-bot",
      sessionKey: "agent:personal-bot:chat",
      sessionsDir,
    });
    expect(sessionFile).toBeTruthy();
    fs.mkdirSync(path.dirname(sessionFile!), { recursive: true });
    fs.writeFileSync(sessionFile!, "", "utf8");
    const before = taskBoardPath(sessionFile!);
    expect(fs.existsSync(before)).toBe(false);

    const source = createOfficialEmployeeAdvicePolicyFactSource({ sessionsDir });
    const facts = await source.read({
      tenantId: "tenant-1",
      employeeId: "employee-server",
      agentId: "personal-bot",
      sessionKey: "agent:personal-bot:chat",
    });
    expect(facts).toBeUndefined();
    expect(fs.existsSync(before)).toBe(false);
  });

  it("does not copy facts when the board scope belongs to another tenant", () => {
    const facts = copyEmployeeAdvicePolicyFactsFromBoard(
      {
        current: {
          taskId: "task:existing-1",
          title: "Existing work",
          goalText: "Already admitted",
          unfinished: true,
          stop: { summary: "stop", workspacePaths: [] },
          createdAtMs: 1,
        },
        parked: [],
        focusRevision: 1,
        scope: { tenantId: "other-tenant", userId: "employee-server" },
        runtimeRuleAdaptationByTaskId: {
          "task:existing-1": { current: snapshot(), history: [] },
        },
      },
      { tenantId: "tenant-1", employeeId: "employee-server" },
    );
    expect(facts).toBeUndefined();
  });
});
