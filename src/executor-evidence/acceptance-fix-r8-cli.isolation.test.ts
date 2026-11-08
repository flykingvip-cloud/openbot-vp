/**
 * CLI entry: model returns, then a post-processing step throws.
 * The embedded runner is stubbed. No external model call.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../cron/isolated-agent.mocks.js";
import * as cliRun from "../agent-runtime/execution/runner/cli-run.js";
import * as commercialGate from "../agent-runtime/model/command-commercial-gate.js";
import * as credentialModule from "../agents/cli-backend-credential-resolve.js";
import * as usageAttribution from "../agents/cli-backend-usage-attribution.js";
import { FailoverError } from "../agents/failover-error.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import * as modelSelection from "../agents/model-selection.js";
import { agentCommand } from "../commands/agent.js";
import * as configModule from "../config/config.js";
import * as scopeModule from "../gateway/model-entitlement/resolve-agent-run-scope.js";
import type { RuntimeEnv } from "../runtime.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(() => {
    throw new Error("exit");
  }),
};
const rates = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
const roots: string[] = [];

function usageResult() {
  return {
    payloads: [{ text: "cli finished" }],
    meta: {
      durationMs: 5,
      agentMeta: {
        sessionId: "cli-session",
        provider: "local",
        model: "fake",
        usage: { input: 4, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
  vi.mocked(loadModelCatalog).mockResolvedValue([]);
  vi.mocked(modelSelection.isCliProvider).mockReturnValue(true);
  vi.spyOn(configModule, "readConfigFileSnapshotForWrite").mockResolvedValue({
    snapshot: { valid: false, resolved: {} as never },
    writeOptions: {},
  } as Awaited<ReturnType<typeof configModule.readConfigFileSnapshotForWrite>>);
  vi.spyOn(scopeModule, "resolveAgentRunEntitlementScope").mockResolvedValue({
    tenantId: "tenant-a",
    employeeId: "emp-1",
    seatId: "seat-1",
  } as never);
  vi.spyOn(credentialModule, "resolveCredentialForRun").mockResolvedValue({
    env: { FAKE_CLI_TOKEN: "token" },
    credentialId: "cred-1",
  } as never);
  vi.spyOn(commercialGate, "acquireAgentCommandCommercialRun").mockResolvedValue({
    status: "skipped",
  } as never);
  vi.spyOn(commercialGate, "releaseAgentCommandCommercialRun").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  delete process.env.OPENBOT_TEST_CLI_PERSIST_THROW;
  configModule.clearRuntimeConfigSnapshot();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function configFor(agentDir: string, storePath: string) {
  vi.spyOn(configModule, "loadConfig").mockReturnValue({
    agents: {
      defaults: {
        workspace: agentDir,
        model: { primary: "local/fake" },
      },
      list: [{ id: "main", default: true, agentDir, workspace: agentDir }],
    },
    session: { store: storePath, mainKey: "main" },
    models: { providers: { local: { models: [{ id: "fake", cost: rates }] } } },
  } as never);
}

function budgetSpends(agentDir: string) {
  const dir = path.join(agentDir, "task-outcomes", "command-log");
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .map(
      (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { commandId?: string },
    )
    .filter((row) => typeof row.commandId === "string" && row.commandId.includes("budget-spend"));
}

function callUsages(agentDir: string) {
  const dir = path.join(agentDir, "task-outcomes", "executor-evidence", "calls");
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).map(
    (name) =>
      JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as {
        usage?: { input?: number; output?: number };
      },
  );
}

describe("R8 CLI entry keeps usage after post-processing failure", () => {
  it("keeps usage when attribution throws after the model returns", async () => {
    vi.spyOn(usageAttribution, "recordCliBackendUsage").mockImplementation(() => {
      throw new Error("attribution after model");
    });
    vi.spyOn(cliRun, "runCliAgent").mockResolvedValue(usageResult() as never);
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r8-cli-"));
    roots.push(agentDir);
    const storePath = path.join(agentDir, "sessions.json");
    configFor(agentDir, storePath);
    let failure = "";
    await agentCommand({ message: "ping", sessionKey: "main" }, runtime).catch((err: unknown) => {
      failure = err instanceof Error ? err.message : String(err);
    });
    expect(callUsages(agentDir), failure).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ usage: expect.objectContaining({ input: 4, output: 1 }) }),
      ]),
    );
    expect(budgetSpends(agentDir)).toHaveLength(1);
  });

  it("keeps usage when the session-expired retry fails while saving the session", async () => {
    vi.spyOn(usageAttribution, "recordCliBackendUsage").mockImplementation(() => undefined);
    process.env.OPENBOT_TEST_CLI_PERSIST_THROW = "1";
    vi.spyOn(cliRun, "runCliAgent")
      .mockRejectedValueOnce(
        new FailoverError("session expired", {
          reason: "session_expired",
          provider: "local",
          model: "fake",
        }),
      )
      .mockResolvedValueOnce(usageResult() as never);
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r8-cli-retry-"));
    roots.push(agentDir);
    const storePath = path.join(agentDir, "sessions.json");
    fs.writeFileSync(
      storePath,
      JSON.stringify({
        main: {
          sessionId: "sess-1",
          updatedAt: Date.now(),
          cliSessionIds: { local: "old-cli-session" },
        },
      }),
    );
    configFor(agentDir, storePath);
    await agentCommand({ message: "ping", sessionKey: "main" }, runtime).catch(() => undefined);
    expect(
      callUsages(agentDir).some((row) => row.usage?.input === 4 && row.usage?.output === 1),
    ).toBe(true);
    expect(budgetSpends(agentDir)).toHaveLength(1);
  });
});
