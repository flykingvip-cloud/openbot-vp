import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OBJECTIVE_SHADOW_FLAG_ENV,
  OBJECTIVE_SHADOW_HMAC_KEY_ENV,
} from "../objective-shadow/feature.js";
import { readShadowRecords } from "../objective-shadow/log.js";
import {
  enableObjectiveShadowForTest,
  resolveShadowTestLogPath,
} from "../objective-shadow/test-env.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { spawnSubagentDirect } from "./subagent-spawn.js";

const OBJECTIVE_SHADOW_LOG_ENV = "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_LOG";

const { callGatewayMock } = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      session: { mainKey: "main", scope: "per-sender" },
      agents: { defaults: { workspace: os.tmpdir() } },
    }),
  };
});

vi.mock("./subagent-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-registry.js")>();
  return {
    ...actual,
    countActiveRunsForSession: () => 0,
    registerSubagentRun: () => {},
  };
});

vi.mock("./subagent-announce.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./subagent-announce.js")>();
  return {
    ...actual,
    buildSubagentSystemPrompt: () => "system-prompt",
  };
});

vi.mock("./agent-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-scope.js")>();
  return {
    ...actual,
    resolveAgentWorkspaceDir: () => path.join(os.tmpdir(), "agent-workspace"),
  };
});

vi.mock("./subagent-depth.js", () => ({
  getSubagentDepthFromSessionStore: () => 0,
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({ hasHooks: () => false }),
}));

const HMAC_KEY = "subagent-shadow-hmac";

function setupGatewayMock() {
  callGatewayMock.mockImplementation(async (opts: { method?: string }) => {
    if (opts.method === "sessions.patch") {
      return { ok: true };
    }
    if (opts.method === "agent") {
      return { runId: "child-run-1" };
    }
    return {};
  });
}

describe("spawnSubagentDirect objective shadow wiring", () => {
  let root: string;
  let logPath: string;
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockClear();
    setupGatewayMock();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-obj-shadow-"));
    logPath = resolveShadowTestLogPath(path.join(root, "objective-shadow.jsonl"));
    previous = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: process.env[OBJECTIVE_SHADOW_FLAG_ENV],
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV],
      [OBJECTIVE_SHADOW_LOG_ENV]: process.env[OBJECTIVE_SHADOW_LOG_ENV],
    };
    process.env[OBJECTIVE_SHADOW_LOG_ENV] = logPath;
    if (logPath === path.join(root, "objective-shadow.jsonl")) {
      delete process.env[OBJECTIVE_SHADOW_FLAG_ENV];
      delete process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("OFF does not write JSONL; spawn still accepts", async () => {
    const result = await spawnSubagentDirect(
      { task: "summarize", agentId: "main" },
      { agentSessionKey: "agent:main:main" },
    );
    expect(result.status).toBe("accepted");
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("ON records inherit_violation when parent snapshot is missing and does not change spawn result", async () => {
    enableObjectiveShadowForTest(HMAC_KEY);
    const result = await spawnSubagentDirect(
      { task: "summarize", agentId: "main" },
      {
        agentSessionKey: "agent:main:main",
        parentRunId: "agent:main:main",
      },
    );
    expect(result.status).toBe("accepted");
    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(1);
    expect(records[0]?.correlation.ingress).toBe("subagent");
    expect(records[0]?.conflictCodes).toContain("inherit_violation");
    expect(records[0]?.correlation.parentRunId).toBeUndefined();
    expect(records[0]?.proposed).toEqual([]);
    expect(result.childSessionKey).toBeTruthy();
  });

  it("ON inherits parent snapshot when parentRunId matches a prior chat record", async () => {
    if (!process.env.OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_EVIDENCE_LOG?.trim()) {
      return;
    }
    enableObjectiveShadowForTest(HMAC_KEY);
    const result = await spawnSubagentDirect(
      { task: "summarize", agentId: "main" },
      {
        agentSessionKey: "agent:main:main",
        parentRunId: "run-chat-1",
        tenantId: "tenant-chat",
      },
    );
    expect(result.status).toBe("accepted");
    const records = readShadowRecords(logPath);
    const inherited = records.filter(
      (record) =>
        record.correlation.ingress === "subagent" &&
        record.correlation.parentRunId === "run-chat-1",
    );
    expect(inherited.length).toBeGreaterThan(0);
    expect(inherited[0]?.resolveStatus).toBe("resolved");
    expect(inherited[0]?.metrics.inheritViolation).toBe(0);
    expect(inherited[0]?.correlation.objectiveId).toBeTruthy();
    expect(inherited[0]?.correlation.objectiveId).not.toBe(inherited[0]?.correlation.runId);
  });
});
