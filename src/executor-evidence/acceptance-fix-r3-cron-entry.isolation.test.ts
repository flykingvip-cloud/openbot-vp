/**
 * Real cron entry: candidate A fails after usage, candidate B succeeds.
 * The embedded runner is stubbed so this stays isolation-only (no external model).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FailoverError } from "../agents/failover-error.js";

vi.mock("../agents/bootstrap-budget.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/bootstrap-budget.js")>();
  return {
    ...actual,
    resolveBootstrapWarningSignaturesSeen: (
      report?: Parameters<typeof actual.resolveBootstrapWarningSignaturesSeen>[0],
    ) => {
      if (process.env.OPENBOT_TEST_CRON_BOOTSTRAP_THROW === "1") {
        const seen = Number(process.env.OPENBOT_TEST_CRON_BOOTSTRAP_SEEN ?? "0") + 1;
        process.env.OPENBOT_TEST_CRON_BOOTSTRAP_SEEN = String(seen);
        if (seen > 1) {
          throw new Error("bootstrap after model");
        }
      }
      return actual.resolveBootstrapWarningSignaturesSeen(report);
    },
  };
});
import { makeIsolatedAgentParamsFixture } from "../cron/isolated-agent/job-fixtures.js";
import {
  clearFastTestEnv,
  loadRunCronIsolatedAgentTurn,
  resetRunCronIsolatedAgentTurnHarness,
  resolveAgentConfigMock,
  resolveAgentDirMock,
  resolveConfiguredModelRefMock,
  restoreFastTestEnv,
  runEmbeddedPiAgentMock,
  runWithModelFallbackMock,
} from "../cron/isolated-agent/run.test-harness.js";
import { loadPersistedAssociations } from "./association.js";
import { readExecutorEvidence } from "./read-port.js";

vi.mock("../gateway/enterprise-model/embedded-transport.js", () => ({
  resolveEnterpriseEmbeddedTransport: vi.fn(
    async (params: { provider: string; model: string }) => ({
      provider: params.provider,
      model: params.model,
    }),
  ),
}));

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();
const roots: string[] = [];

describe("R3 cron entry keeps failed and successful candidates", () => {
  let previousFast: string | undefined;

  beforeEach(() => {
    previousFast = clearFastTestEnv();
    process.env.OPENCLAW_TEST_FAST = "1";
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    resetRunCronIsolatedAgentTurnHarness();
  });

  afterEach(() => {
    delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
    restoreFastTestEnv(previousFast);
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("links both the failed primary and the successful fallback", async () => {
    const actual = await vi.importActual<typeof import("../agents/model-fallback.js")>(
      "../agents/model-fallback.js",
    );
    runWithModelFallbackMock.mockImplementation((params) => actual.runWithModelFallback(params));
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-cron-"));
    roots.push(agentDir);
    resolveAgentDirMock.mockReturnValue(agentDir);
    resolveAgentConfigMock.mockReturnValue({ agentDir });
    resolveConfiguredModelRefMock.mockReturnValue({ provider: "local", model: "a" });
    let calls = 0;
    runEmbeddedPiAgentMock.mockImplementation(async (params: { model?: string }) => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(
          new FailoverError("primary failed after usage", {
            reason: "rate_limit",
            provider: "local",
            model: params.model ?? "a",
          }),
          { usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
        );
      }
      return {
        payloads: [{ text: "fallback completed the cron task with a real summary" }],
        meta: {
          agentMeta: {
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
            model: params.model,
          },
        },
      };
    });
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentParamsFixture({
        cfg: {
          agents: {
            defaults: { workspace: agentDir },
            list: [{ id: "default", agentDir, workspace: agentDir }],
          },
          models: {
            providers: {
              local: {
                models: [
                  {
                    id: "a",
                    cost: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
                  },
                  {
                    id: "b",
                    cost: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
              },
            },
          },
        },
        job: {
          id: "r3-cron-fallback",
          payload: {
            kind: "agentTurn",
            message: "finish the isolated evidence check",
            fallbacks: ["local/b"],
          },
        },
        message: "finish the isolated evidence check",
        sessionKey: "cron:r3-cron-fallback",
      }) as never,
    );
    expect(result.status).toBe("ok");
    expect(calls).toBe(2);
    const storeRoot = path.join(agentDir, "task-outcomes");
    const finals = loadPersistedAssociations(storeRoot).filter(
      (row) => row.finalOutcomeVersion != null && row.callId,
    );
    expect(new Set(finals.map((row) => row.callId)).size).toBe(2);
    const taskId = finals[0]?.chain.taskId;
    expect(taskId).toBeTruthy();
    const droppedCall = finals[0]?.callId;
    const callDir = path.join(storeRoot, "executor-evidence", "calls");
    for (const name of fs.readdirSync(callDir)) {
      const file = path.join(callDir, name);
      const body = JSON.parse(fs.readFileSync(file, "utf8")) as { callId?: string };
      if (body.callId === droppedCall) {
        fs.rmSync(file);
      }
    }
    const scope = finals[0]?.trustedScope;
    if (!taskId || !scope) {
      throw new Error("missing final association");
    }
    const partial = readExecutorEvidence({
      agentId: "default",
      scope,
      taskId,
      storeRoot,
      outcomeVersion: finals[0]?.finalOutcomeVersion ?? undefined,
    });
    expect(partial.completeness).not.toBe("complete");
    expect(partial.callChainCompleteness).not.toBe("complete");
  });

  it("keeps a failed cron candidate unknown and does not open a second call sequence", async () => {
    const actual = await vi.importActual<typeof import("../agents/model-fallback.js")>(
      "../agents/model-fallback.js",
    );
    runWithModelFallbackMock.mockImplementation((params) => actual.runWithModelFallback(params));
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r4-cron-unknown-"));
    roots.push(agentDir);
    resolveAgentDirMock.mockReturnValue(agentDir);
    resolveAgentConfigMock.mockReturnValue({ agentDir });
    resolveConfiguredModelRefMock.mockReturnValue({ provider: "local", model: "a" });
    let calls = 0;
    runEmbeddedPiAgentMock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw new FailoverError("primary failed without usage", {
          reason: "rate_limit",
          provider: "local",
          model: "a",
        });
      }
      return {
        payloads: [{ text: "fallback completed the cron task with a real summary" }],
        meta: { agentMeta: { usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } } },
      };
    });
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentParamsFixture({
        cfg: {
          agents: {
            defaults: { workspace: agentDir },
            list: [{ id: "default", agentDir, workspace: agentDir }],
          },
          models: {
            providers: {
              local: {
                models: [
                  {
                    id: "a",
                    cost: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
                  },
                  {
                    id: "b",
                    cost: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
              },
            },
          },
        },
        job: {
          id: "r4-cron-unknown",
          payload: {
            kind: "agentTurn",
            message: "finish the isolated evidence check",
            fallbacks: ["local/b"],
          },
        },
        message: "finish the isolated evidence check",
        sessionKey: "cron:r4-cron-unknown",
      }) as never,
    );
    expect(result.status).toBe("ok");
    const spends = fs
      .readdirSync(path.join(agentDir, "task-outcomes", "command-log"))
      .map((name) =>
        JSON.parse(
          fs.readFileSync(path.join(agentDir, "task-outcomes", "command-log", name), "utf8"),
        ),
      )
      .filter(
        (row: {
          commandId?: string;
          committedSpend?: { costUsd: number | null; costEvidence?: string };
        }) => typeof row.commandId === "string" && row.commandId.includes("budget-spend"),
      );
    expect(spends).toHaveLength(2);
    const unknown = spends.find(
      (row: { committedSpend?: { costUsd: number | null; costEvidence?: string } }) =>
        row.committedSpend?.costUsd == null,
    );
    expect(unknown?.committedSpend?.costEvidence).not.toBe("known");
  });

  it("keeps the model usage when cron post-processing throws after the result", async () => {
    process.env.OPENBOT_TEST_CRON_BOOTSTRAP_THROW = "1";
    process.env.OPENBOT_TEST_CRON_BOOTSTRAP_SEEN = "0";
    const actual = await vi.importActual<typeof import("../agents/model-fallback.js")>(
      "../agents/model-fallback.js",
    );
    runWithModelFallbackMock.mockImplementation((params) => actual.runWithModelFallback(params));
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r6-cron-usage-"));
    roots.push(agentDir);
    resolveAgentDirMock.mockReturnValue(agentDir);
    resolveAgentConfigMock.mockReturnValue({ agentDir });
    resolveConfiguredModelRefMock.mockReturnValue({ provider: "local", model: "a" });
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "model finished before bootstrap" }],
      meta: { agentMeta: { usage: { input: 4, output: 1, cacheRead: 0, cacheWrite: 0 } } },
    });
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentParamsFixture({
        cfg: {
          agents: {
            defaults: { workspace: agentDir },
            list: [{ id: "default", agentDir, workspace: agentDir }],
          },
          models: {
            providers: {
              local: {
                models: [
                  {
                    id: "a",
                    cost: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
              },
            },
          },
        },
        job: {
          id: "r6-cron-bootstrap",
          payload: { kind: "agentTurn", message: "finish then fail bootstrap" },
        },
        message: "finish then fail bootstrap",
        sessionKey: "cron:r6-cron-bootstrap",
      }) as never,
    );
    delete process.env.OPENBOT_TEST_CRON_BOOTSTRAP_THROW;
    delete process.env.OPENBOT_TEST_CRON_BOOTSTRAP_SEEN;
    expect(result.status).toBe("error");
    const spends = fs
      .readdirSync(path.join(agentDir, "task-outcomes", "command-log"))
      .map((name) =>
        JSON.parse(
          fs.readFileSync(path.join(agentDir, "task-outcomes", "command-log", name), "utf8"),
        ),
      )
      .filter(
        (row: {
          commandId?: string;
          committedSpend?: { costUsd: number | null; costEvidence?: string };
        }) => typeof row.commandId === "string" && row.commandId.includes("budget-spend"),
      );
    expect(spends).toHaveLength(1);
    const calls = fs
      .readdirSync(path.join(agentDir, "task-outcomes", "executor-evidence", "calls"))
      .map((name) =>
        JSON.parse(
          fs.readFileSync(
            path.join(agentDir, "task-outcomes", "executor-evidence", "calls", name),
            "utf8",
          ),
        ),
      ) as Array<{ usage?: { input?: number; output?: number } }>;
    expect(calls.some((row) => row.usage?.input === 4 && row.usage?.output === 1)).toBe(true);
  });
});
