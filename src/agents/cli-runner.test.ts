import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { runCliAgent } from "./cli-runner.js";
import { resolveCliNoOutputTimeoutMs } from "./cli-runner/helpers.js";

const supervisorSpawnMock = vi.fn();
const enqueueSystemEventMock = vi.fn();
const requestHeartbeatNowMock = vi.fn();

vi.mock("../process/supervisor/index.js", () => ({
  getProcessSupervisor: () => ({
    spawn: (...args: unknown[]) => supervisorSpawnMock(...args),
    cancel: vi.fn(),
    cancelScope: vi.fn(),
    reconcileOrphans: vi.fn(),
    getRecord: vi.fn(),
  }),
}));

vi.mock("../infra/system-events.js", () => ({
  enqueueSystemEvent: (...args: unknown[]) => enqueueSystemEventMock(...args),
}));

vi.mock("../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: (...args: unknown[]) => requestHeartbeatNowMock(...args),
}));

type MockRunExit = {
  reason:
    | "manual-cancel"
    | "overall-timeout"
    | "no-output-timeout"
    | "spawn-error"
    | "signal"
    | "exit";
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  noOutputTimedOut: boolean;
};

function createManagedRun(exit: MockRunExit, pid = 1234) {
  return {
    runId: "run-supervisor",
    pid,
    startedAtMs: Date.now(),
    stdin: undefined,
    wait: vi.fn().mockResolvedValue(exit),
    cancel: vi.fn(),
  };
}

describe("runCliAgent with process supervisor", () => {
  beforeEach(() => {
    supervisorSpawnMock.mockClear();
    enqueueSystemEventMock.mockClear();
    requestHeartbeatNowMock.mockClear();
  });

  it("runs CLI through supervisor and returns payload", async () => {
    supervisorSpawnMock.mockResolvedValueOnce(
      createManagedRun({
        reason: "exit",
        exitCode: 0,
        exitSignal: null,
        durationMs: 50,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        noOutputTimedOut: false,
      }),
    );

    const result = await runCliAgent({
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "codex-cli",
      model: "gpt-5.2-codex",
      timeoutMs: 1_000,
      runId: "run-1",
      cliSessionId: "thread-123",
    });

    expect(result.payloads?.[0]?.text).toBe("ok");
    expect(supervisorSpawnMock).toHaveBeenCalledTimes(1);
    const input = supervisorSpawnMock.mock.calls[0]?.[0] as {
      argv?: string[];
      mode?: string;
      timeoutMs?: number;
      noOutputTimeoutMs?: number;
      replaceExistingScope?: boolean;
      scopeKey?: string;
    };
    expect(input.mode).toBe("child");
    expect(input.argv?.[0]).toBe("codex");
    expect(input.timeoutMs).toBe(1_000);
    expect(input.noOutputTimeoutMs).toBeGreaterThanOrEqual(1_000);
    expect(input.replaceExistingScope).toBe(true);
    expect(input.scopeKey).toContain("thread-123");
  });

  it("injects credentialEnv into the child env (cli-backend-onboarding Task 6)", async () => {
    supervisorSpawnMock.mockResolvedValueOnce(
      createManagedRun({
        reason: "exit",
        exitCode: 0,
        exitSignal: null,
        durationMs: 10,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        noOutputTimedOut: false,
      }),
    );

    await runCliAgent({
      sessionId: "s1",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "codex-cli",
      model: "gpt-5.2-codex",
      timeoutMs: 1_000,
      runId: "run-cred",
      credentialEnv: { OPENAI_API_KEY: "resolved-secret-value" },
    });

    const input = supervisorSpawnMock.mock.calls[0]?.[0] as { env?: Record<string, string> };
    expect(input.env?.OPENAI_API_KEY).toBe("resolved-secret-value");
  });

  it("fails with timeout when no-output watchdog trips", async () => {
    supervisorSpawnMock.mockResolvedValueOnce(
      createManagedRun({
        reason: "no-output-timeout",
        exitCode: null,
        exitSignal: "SIGKILL",
        durationMs: 200,
        stdout: "",
        stderr: "",
        timedOut: true,
        noOutputTimedOut: true,
      }),
    );

    await expect(
      runCliAgent({
        sessionId: "s1",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        prompt: "hi",
        provider: "codex-cli",
        model: "gpt-5.2-codex",
        timeoutMs: 1_000,
        runId: "run-2",
        cliSessionId: "thread-123",
      }),
    ).rejects.toThrow("produced no output");
  });

  it("enqueues a system event and heartbeat wake on no-output watchdog timeout for session runs", async () => {
    supervisorSpawnMock.mockResolvedValueOnce(
      createManagedRun({
        reason: "no-output-timeout",
        exitCode: null,
        exitSignal: "SIGKILL",
        durationMs: 200,
        stdout: "",
        stderr: "",
        timedOut: true,
        noOutputTimedOut: true,
      }),
    );

    await expect(
      runCliAgent({
        sessionId: "s1",
        sessionKey: "agent:main:main",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        prompt: "hi",
        provider: "codex-cli",
        model: "gpt-5.2-codex",
        timeoutMs: 1_000,
        runId: "run-2b",
        cliSessionId: "thread-123",
      }),
    ).rejects.toThrow("produced no output");

    expect(enqueueSystemEventMock).toHaveBeenCalledTimes(1);
    const [notice, opts] = enqueueSystemEventMock.mock.calls[0] ?? [];
    expect(String(notice)).toContain("produced no output");
    expect(String(notice)).toContain("interactive input or an approval prompt");
    expect(opts).toMatchObject({ sessionKey: "agent:main:main" });
    expect(requestHeartbeatNowMock).toHaveBeenCalledWith({
      reason: "cli:watchdog:stall",
      sessionKey: "agent:main:main",
    });
  });

  it("fails with timeout when overall timeout trips", async () => {
    supervisorSpawnMock.mockResolvedValueOnce(
      createManagedRun({
        reason: "overall-timeout",
        exitCode: null,
        exitSignal: "SIGKILL",
        durationMs: 200,
        stdout: "",
        stderr: "",
        timedOut: true,
        noOutputTimedOut: false,
      }),
    );

    await expect(
      runCliAgent({
        sessionId: "s1",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        prompt: "hi",
        provider: "codex-cli",
        model: "gpt-5.2-codex",
        timeoutMs: 1_000,
        runId: "run-3",
        cliSessionId: "thread-123",
      }),
    ).rejects.toThrow("exceeded timeout");
  });

  it("rethrows the retry failure when session-expired recovery retry also fails", async () => {
    supervisorSpawnMock.mockResolvedValueOnce(
      createManagedRun({
        reason: "exit",
        exitCode: 1,
        exitSignal: null,
        durationMs: 150,
        stdout: "",
        stderr: "session expired",
        timedOut: false,
        noOutputTimedOut: false,
      }),
    );
    supervisorSpawnMock.mockResolvedValueOnce(
      createManagedRun({
        reason: "exit",
        exitCode: 1,
        exitSignal: null,
        durationMs: 150,
        stdout: "",
        stderr: "rate limit exceeded",
        timedOut: false,
        noOutputTimedOut: false,
      }),
    );

    await expect(
      runCliAgent({
        sessionId: "s1",
        sessionKey: "agent:main:subagent:retry",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        prompt: "hi",
        provider: "codex-cli",
        model: "gpt-5.2-codex",
        timeoutMs: 1_000,
        runId: "run-retry-failure",
        cliSessionId: "thread-123",
      }),
    ).rejects.toThrow("rate limit exceeded");

    expect(supervisorSpawnMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to per-agent workspace when workspaceDir is missing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cli-runner-"));
    const fallbackWorkspace = path.join(tempDir, "workspace-main");
    await fs.mkdir(fallbackWorkspace, { recursive: true });
    const cfg = {
      agents: {
        defaults: {
          workspace: fallbackWorkspace,
        },
      },
    } satisfies OpenBotConfig;

    supervisorSpawnMock.mockResolvedValueOnce(
      createManagedRun({
        reason: "exit",
        exitCode: 0,
        exitSignal: null,
        durationMs: 25,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        noOutputTimedOut: false,
      }),
    );

    try {
      await runCliAgent({
        sessionId: "s1",
        sessionKey: "agent:main:subagent:missing-workspace",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: undefined as unknown as string,
        config: cfg,
        prompt: "hi",
        provider: "codex-cli",
        model: "gpt-5.2-codex",
        timeoutMs: 1_000,
        runId: "run-4",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    const input = supervisorSpawnMock.mock.calls[0]?.[0] as { cwd?: string };
    expect(input.cwd).toBe(path.resolve(fallbackWorkspace));
  });

  it("blocks free-chat codex-cli when development supervisor is enabled", async () => {
    const prev = process.env.OPENBOT_SUPERVISOR_ENABLED;
    process.env.OPENBOT_SUPERVISOR_ENABLED = "1";
    try {
      await expect(
        runCliAgent({
          sessionId: "s1",
          sessionFile: "/tmp/session.jsonl",
          workspaceDir: "/tmp",
          prompt: "refactor ui",
          provider: "codex-cli",
          model: "gpt-5.2-codex",
          timeoutMs: 1_000,
          runId: "run-blocked",
        }),
      ).rejects.toThrow(/开发监督已启用/);
      expect(supervisorSpawnMock).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_SUPERVISOR_ENABLED;
      } else {
        process.env.OPENBOT_SUPERVISOR_ENABLED = prev;
      }
    }
  });
});

describe("resolveCliNoOutputTimeoutMs", () => {
  it("uses backend-configured resume watchdog override", () => {
    const timeoutMs = resolveCliNoOutputTimeoutMs({
      backend: {
        command: "codex",
        reliability: {
          watchdog: {
            resume: {
              noOutputTimeoutMs: 42_000,
            },
          },
        },
      },
      timeoutMs: 120_000,
      useResume: true,
    });
    expect(timeoutMs).toBe(42_000);
  });
});

it("does not spawn CLI when the host signal was already cancelled", async () => {
  supervisorSpawnMock.mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(
    runCliAgent({
      sessionId: "cancelled",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "codex-cli",
      model: "gpt-5.2-codex",
      timeoutMs: 1000,
      runId: "cancelled-run",
      abortSignal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(supervisorSpawnMock).not.toHaveBeenCalled();
});

it("cancels the supervisor handle if stop arrives while spawn is pending and removes the listener", async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const managed = createManagedRun({
    reason: "manual-cancel",
    exitCode: null,
    exitSignal: "SIGTERM",
    durationMs: 1,
    stdout: "",
    stderr: "",
    timedOut: false,
    noOutputTimedOut: false,
  });
  supervisorSpawnMock.mockImplementationOnce(async () => {
    controller.abort();
    return managed;
  });
  await expect(
    runCliAgent({
      sessionId: "cancel-during-spawn",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      prompt: "hi",
      provider: "codex-cli",
      model: "gpt-5.2-codex",
      timeoutMs: 1000,
      runId: "cancel-spawn-run",
      abortSignal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(managed.cancel).toHaveBeenCalledWith("manual-cancel");
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it.each([false, true])(
  "stops a running CLI without late success even if cancel throws (%s)",
  async (cancelThrows) => {
    const controller = new AbortController();
    const managed = createManagedRun({
      reason: "exit",
      exitCode: 0,
      exitSignal: null,
      durationMs: 1,
      stdout: "late success",
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    });
    if (cancelThrows) {
      managed.cancel.mockImplementationOnce(() => {
        throw new Error("cancel failure");
      });
    }
    managed.wait.mockImplementationOnce(async () => {
      controller.abort();
      return {
        reason: "exit",
        exitCode: 0,
        exitSignal: null,
        durationMs: 1,
        stdout: "late success",
        stderr: "",
        timedOut: false,
        noOutputTimedOut: false,
      };
    });
    supervisorSpawnMock.mockResolvedValueOnce(managed);
    await expect(
      runCliAgent({
        sessionId: "cancel-running",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        prompt: "hi",
        provider: "codex-cli",
        model: "gpt-5.2-codex",
        timeoutMs: 1000,
        runId: "cancel-running-run",
        abortSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(managed.cancel).toHaveBeenCalledTimes(1);
  },
);
