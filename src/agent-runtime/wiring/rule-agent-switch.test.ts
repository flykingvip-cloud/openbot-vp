import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type { AgentTurnExecutionParams } from "../execution/runner/turn-contract.js";
import { bindAdmittedTurnHost } from "./admitted-turn-host.js";
import { replyTurnRuntime } from "./reply-turn.js";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), create: vi.fn() }));
vi.mock("../execution/runner/admitted-candidate.js", () => ({
  createAdmittedCandidateInvoker: (...args: unknown[]) => {
    mocks.create(...args);
    return mocks.invoke;
  },
}));

function setup(mode: "legacy" | "dynamic" | "off") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-agent-switch-"));
  const sessionFile = path.join(dir, "session.jsonl");
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "test",
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  host.model.rememberRunModelSet = vi.fn();
  host.model.runWithModelFallback = vi.fn(async (options) => ({
    result: await options.run("test", "model"),
    provider: "test",
    model: "model",
    attempts: [],
  }));
  const config =
    mode === "off"
      ? {}
      : {
          agents: {
            defaults: {
              contextWindowRuleDecision: {
                mode,
                fallback: "legacy" as const,
              },
            },
          },
        };
  const params = {
    commandBody: "请回复这封短消息",
    followupRun: {
      prompt: "请回复这封短消息",
      run: {
        config,
        provider: "test",
        model: "model",
        sessionId: "session",
        sessionFile,
        agentId: "fixture",
        workspaceDir: dir,
      },
    },
    sessionCtx: {},
    opts: { runId: "test-turn" },
    isHeartbeat: true,
    getActiveSessionEntry: () => undefined,
  } as AgentTurnExecutionParams;
  return { host, params, sessionFile, dir };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.create.mockReset();
  mocks.invoke.mockResolvedValue({ payloads: [{ text: "done" }] });
});

it("keeps the executor on the admitted turn when the rule agent switch is off", async () => {
  const off = setup("off");
  const legacy = setup("legacy");
  try {
    expect((await replyTurnRuntime.execution.runAdmittedTurn(off.params, off.host)).kind).toBe(
      "success",
    );
    expect(
      (await replyTurnRuntime.execution.runAdmittedTurn(legacy.params, legacy.host)).kind,
    ).toBe("success");
    for (const call of mocks.create.mock.calls) {
      const request = call[0] as { resolveExecutionConstraints?: unknown };
      expect(request.resolveExecutionConstraints).toBeUndefined();
    }
    expect(fs.existsSync(`${off.sessionFile}.rule-library.json`)).toBe(false);
    expect(fs.existsSync(`${legacy.sessionFile}.rule-library.json`)).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  } finally {
    fs.rmSync(off.dir, { recursive: true, force: true });
    fs.rmSync(legacy.dir, { recursive: true, force: true });
  }
});

it("attaches the rule agent inside the same admitted turn when the switch is on", async () => {
  const { host, params, sessionFile, dir } = setup("dynamic");
  try {
    expect((await replyTurnRuntime.execution.runAdmittedTurn(params, host)).kind).toBe("success");
    const request = mocks.create.mock.calls[0]?.[0] as {
      resolveExecutionConstraints?: unknown;
    };
    expect(typeof request.resolveExecutionConstraints).toBe("function");
    expect(fs.existsSync(`${sessionFile}.rule-library.json`)).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledOnce();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("does not restore the employee rule-advice compose surface", () => {
  expect(fs.existsSync(path.resolve("ui/src/ui/chat/rule-adaptation-advice-panel.ts"))).toBe(false);
  expect(fs.existsSync(path.resolve("ui/src/ui/controllers/rule-adaptation-advice.ts"))).toBe(
    false,
  );
});
