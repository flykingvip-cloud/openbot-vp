import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { projectInteractionHistory } from "../agent-runtime/context/index.js";
import {
  CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
  INTERACTION_RECORD_UNAVAILABLE_TEXT,
  INTERACTION_TIMEOUT_TEXT,
} from "../agent-runtime/model/index.js";
import { persistInteractionMessage } from "../agent-runtime/state/index.js";
import { openSessionManager } from "../agents/pi-sdk/session.js";
import {
  BILLING_BLOCKED_INTERACTION_TEXT,
  formatChatTurnTerminalText,
  persistRejectedInteractionTurn,
  readChatTurnTerminal,
  reconcileChatTurnTerminal,
  REJECTED_INTERACTION_TURN_TEXT,
  shortChatRunId,
} from "./chat-interaction-failure.js";
it("persists only governed billing failures as a pre-execution blocked interaction", async () => {
  const append = vi.fn(async () => ({ ok: true }));
  const error = Object.assign(new Error("402: PRIVATE PROVIDER DETAIL"), {
    name: "FailoverError",
    reason: "billing",
    interactionPhase: "interpretation",
  });
  expect(await persistRejectedInteractionTurn({ error, runId: "billing", append })).toEqual({
    persisted: true,
    text: BILLING_BLOCKED_INTERACTION_TEXT,
  });
  expect(append).toHaveBeenCalledWith(
    BILLING_BLOCKED_INTERACTION_TEXT,
    "billing:interaction-rejected",
  );
  expect(BILLING_BLOCKED_INTERACTION_TEXT).not.toContain("PRIVATE");
  const executionError = Object.assign(new Error("402"), {
    name: "FailoverError",
    reason: "billing",
  });
  const later = await persistRejectedInteractionTurn({
    error: executionError,
    runId: "later",
    append,
  });
  expect(later.persisted).toBe(true);
  expect(later.text).toBe(CHAT_TURN_ERROR_UNCONFIRMED_TEXT);
  expect(later.text).not.toBe(BILLING_BLOCKED_INTERACTION_TEXT);
  expect(later.text).not.toContain("没有启动新任务");
});

it("keeps the rejected turn terminal on the authoritative transcript branch after reopening", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-reject-history-"));
  const sessionFile = path.join(dir, "session.jsonl");
  const common = { sessionFile, sessionId: "test", cwd: dir };
  try {
    persistInteractionMessage({ ...common, messageId: "D", role: "user", text: "send D" });
    const append = async (text: string, key: string) => {
      persistInteractionMessage({ ...common, messageId: key, role: "assistant", text });
      return { ok: true };
    };
    await persistRejectedInteractionTurn({
      error: new Error("Invalid interaction decision"),
      runId: "D",
      append,
    });
    await persistRejectedInteractionTurn({
      error: new Error("Invalid interaction decision"),
      runId: "D",
      append,
    });
    persistInteractionMessage({ ...common, messageId: "F", role: "user", text: "only send F" });
    const messages = openSessionManager(sessionFile).buildSessionContext().messages;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const history = projectInteractionHistory(messages, "F");
    expect(history).toEqual([
      { role: "user", content: "send D" },
      { role: "assistant", content: REJECTED_INTERACTION_TURN_TEXT },
    ]);
    expect(fs.existsSync(`${sessionFile}.task-board.json`)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("persists the failed request terminal with stable identity instead of leaving a pending instruction", async () => {
  const written = new Map<string, string>();
  const append = vi.fn(async (text: string, key: string) => {
    written.set(key, text);
    return { ok: true };
  });
  const input = { error: new Error("Invalid interaction decision"), runId: "failed-D", append };
  expect(await persistRejectedInteractionTurn(input)).toEqual({
    persisted: true,
    text: REJECTED_INTERACTION_TURN_TEXT,
  });
  await persistRejectedInteractionTurn(input);
  expect(written.size).toBe(1);
  expect(written.get("failed-D:interaction-rejected")).toContain("不会自动补做");
});
it("never mislabels a tool/execution failure as no execution", async () => {
  const append = vi.fn(async () => ({ ok: true }));
  const result = await persistRejectedInteractionTurn({
    error: new Error("tool failed after send"),
    runId: "run",
    append,
  });
  expect(result).toEqual({ persisted: true, text: CHAT_TURN_ERROR_UNCONFIRMED_TEXT });
  expect(append).toHaveBeenCalledWith(CHAT_TURN_ERROR_UNCONFIRMED_TEXT, "run:interaction-rejected");
  expect(result.text).not.toMatch(/没有启动新任务|没有启动或修改任务/);
});
it("does not claim durable closure when the transcript write fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-reject-undurable-"));
  const append = vi.fn(async () => {
    throw new Error("disk error");
  });
  try {
    const result = await persistRejectedInteractionTurn({
      error: new Error("Invalid interaction task decision"),
      runId: "run",
      sessionKey: "sess",
      storeDir: dir,
      append,
    });
    expect(result.persisted).toBe(false);
    expect(result.recordTemporarilyUnavailable).toBe(true);
    expect(result.text).toContain(REJECTED_INTERACTION_TURN_TEXT);
    expect(result.text).toContain(INTERACTION_RECORD_UNAVAILABLE_TEXT);
    expect(readChatTurnTerminal("run", dir, "sess")).toMatchObject({
      persistedToTranscript: false,
      recordTemporarilyUnavailable: true,
      businessExecution: "none",
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("checkpoint A remediations: concurrent conflicting terminals keep one fact and one visible settlement", async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-terminal-race-"));
  const written: string[] = [];
  let entered = 0;
  let firstEntered!: () => void;
  const firstAppendEntered = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  let proceed!: () => void;
  const mayAppend = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  const append = async (text: string) => {
    entered += 1;
    if (entered === 1) {
      firstEntered();
    }
    await mayAppend;
    written.push(text);
    return { ok: true };
  };
  try {
    const timeoutErr = Object.assign(new Error("timeout"), {
      interactionPhase: "interpretation" as const,
      reason: "timeout",
    });
    const lateErr = new Error("tool failed after send");
    const first = persistRejectedInteractionTurn({
      error: timeoutErr,
      runId: "run-race",
      sessionKey: "sess-race",
      storeDir,
      append,
    });
    const second = persistRejectedInteractionTurn({
      error: lateErr,
      runId: "run-race",
      sessionKey: "sess-race",
      storeDir,
      append,
    });
    await firstAppendEntered;
    // If the critical section is unlocked, the peer should also reach append
    // before either settlement is written.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    proceed();
    const [left, right] = await Promise.all([first, second]);
    expect(written).toHaveLength(1);
    const sidecar = readChatTurnTerminal("run-race", storeDir, "sess-race");
    expect(sidecar).toBeTruthy();
    expect([INTERACTION_TIMEOUT_TEXT, CHAT_TURN_ERROR_UNCONFIRMED_TEXT]).toContain(sidecar?.text);
    expect(left.text).toBe(sidecar?.text);
    expect(right.text).toBe(sidecar?.text);
    expect(left.persisted).toBe(true);
    expect(right.persisted).toBe(true);
    if (sidecar?.text === INTERACTION_TIMEOUT_TEXT) {
      expect(sidecar.businessExecution).toBe("none");
    } else {
      expect(sidecar?.businessExecution).toBe("unknown");
    }
    expect(entered).toBe(1);
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

it("R2: an execution-phase tool timeout is not attested as no business, and history/sidecar keep that fact", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-exec-timeout-"));
  const sessionFile = path.join(dir, "session.jsonl");
  const storeDir = path.join(dir, "terminals");
  const common = { sessionFile, sessionId: "test", cwd: dir };
  try {
    persistInteractionMessage({ ...common, messageId: "U", role: "user", text: "修改任务" });
    const append = async (text: string, key: string) => {
      persistInteractionMessage({ ...common, messageId: key, role: "assistant", text });
      return { ok: true };
    };
    const error = Object.assign(new Error("tool timed out after an external write"), {
      interactionPhase: "execution",
      reason: "timeout",
    });
    const result = await persistRejectedInteractionTurn({
      error,
      runId: "run-exec-timeout",
      sessionKey: "sess-exec-timeout",
      storeDir,
      append,
    });
    expect(result.persisted).toBe(true);
    expect(result.text).toBe(CHAT_TURN_ERROR_UNCONFIRMED_TEXT);
    expect(result.text).not.toMatch(/没有启动新任务|没有启动或修改任务/);
    expect(readChatTurnTerminal("run-exec-timeout", storeDir, "sess-exec-timeout")).toMatchObject({
      businessExecution: "unknown",
      persistedToTranscript: true,
      text: CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
    });
    const messages = openSessionManager(sessionFile).buildSessionContext().messages;
    const history = projectInteractionHistory(messages, "next");
    expect(history).toEqual([
      { role: "user", content: "修改任务" },
      { role: "assistant", content: CHAT_TURN_ERROR_UNCONFIRMED_TEXT },
    ]);
    expect(fs.existsSync(`${sessionFile}.task-board.json`)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("R2: a tool or process timeout without phase information cannot be guaranteed as no business", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-nophase-timeout-"));
  const sessionFile = path.join(dir, "session.jsonl");
  const storeDir = path.join(dir, "terminals");
  const common = { sessionFile, sessionId: "test", cwd: dir };
  try {
    persistInteractionMessage({ ...common, messageId: "U", role: "user", text: "继续执行" });
    const append = async (text: string, key: string) => {
      persistInteractionMessage({ ...common, messageId: key, role: "assistant", text });
      return { ok: true };
    };
    const result = await persistRejectedInteractionTurn({
      error: Object.assign(new Error("process timed out after 30s"), { reason: "timeout" }),
      runId: "run-nophase-timeout",
      sessionKey: "sess-nophase-timeout",
      storeDir,
      append,
    });
    expect(result.persisted).toBe(true);
    expect(result.text).toBe(CHAT_TURN_ERROR_UNCONFIRMED_TEXT);
    expect(result.text).not.toMatch(/没有启动新任务|没有启动或修改任务/);
    expect(
      readChatTurnTerminal("run-nophase-timeout", storeDir, "sess-nophase-timeout"),
    ).toMatchObject({
      businessExecution: "unknown",
      persistedToTranscript: true,
      text: CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
    });
    const messages = openSessionManager(sessionFile).buildSessionContext().messages;
    const history = projectInteractionHistory(messages, "next");
    expect(history).toEqual([
      { role: "user", content: "继续执行" },
      { role: "assistant", content: CHAT_TURN_ERROR_UNCONFIRMED_TEXT },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps only the first sealed fact when a second persist arrives after the first append has entered", async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-terminal-reentry-"));
  const written: string[] = [];
  let firstEntered!: () => void;
  const firstAppendEntered = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const append = async (text: string) => {
    firstEntered();
    await barrier;
    written.push(text);
    return { ok: true };
  };
  const common = {
    storeDir,
    sessionKey: "sess-reentry",
    runId: "run-reentry",
    append,
  };
  try {
    const first = persistRejectedInteractionTurn({
      ...common,
      error: Object.assign(new Error("timeout"), {
        interactionPhase: "interpretation" as const,
        reason: "timeout",
      }),
    });
    await firstAppendEntered;
    const second = persistRejectedInteractionTurn({
      ...common,
      error: Object.assign(new Error("tool timeout after send"), {
        interactionPhase: "execution" as const,
        reason: "timeout",
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(INTERACTION_TIMEOUT_TEXT);
    const sidecar = readChatTurnTerminal("run-reentry", storeDir, "sess-reentry");
    expect(sidecar).toMatchObject({
      text: INTERACTION_TIMEOUT_TEXT,
      businessExecution: "none",
      persistedToTranscript: true,
    });
    expect(left.text).toBe(INTERACTION_TIMEOUT_TEXT);
    expect(right.text).toBe(INTERACTION_TIMEOUT_TEXT);
    expect(left.persisted).toBe(true);
    expect(right.persisted).toBe(true);
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

it("appends a concurrent same-fact persist only once after the first append has entered", async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-terminal-same-fact-"));
  const written: string[] = [];
  let firstEntered!: () => void;
  const firstAppendEntered = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const append = async (text: string) => {
    firstEntered();
    await barrier;
    written.push(text);
    return { ok: true };
  };
  const error = Object.assign(new Error("timeout"), {
    interactionPhase: "interpretation" as const,
    reason: "timeout",
  });
  const common = {
    storeDir,
    sessionKey: "sess-same-fact",
    runId: "run-same-fact",
    error,
    append,
  };
  try {
    const first = persistRejectedInteractionTurn(common);
    await firstAppendEntered;
    const second = persistRejectedInteractionTurn(common);
    await new Promise((resolve) => setTimeout(resolve, 25));
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(INTERACTION_TIMEOUT_TEXT);
    expect(left).toEqual({ persisted: true, text: INTERACTION_TIMEOUT_TEXT });
    expect(right).toEqual({ persisted: true, text: INTERACTION_TIMEOUT_TEXT });
    expect(readChatTurnTerminal("run-same-fact", storeDir, "sess-same-fact")).toMatchObject({
      text: INTERACTION_TIMEOUT_TEXT,
      persistedToTranscript: true,
      businessExecution: "none",
    });
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

it("releases the terminal path lock after an append failure so a later same-fact persist can retry", async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-terminal-lock-release-"));
  const error = Object.assign(new Error("timeout"), {
    interactionPhase: "interpretation" as const,
    reason: "timeout",
  });
  try {
    const first = await persistRejectedInteractionTurn({
      error,
      runId: "run-lock-release",
      sessionKey: "sess-lock-release",
      storeDir,
      append: async () => {
        throw new Error("disk error");
      },
    });
    expect(first.persisted).toBe(false);
    expect(first.recordTemporarilyUnavailable).toBe(true);
    const retried: string[] = [];
    const second = await persistRejectedInteractionTurn({
      error,
      runId: "run-lock-release",
      sessionKey: "sess-lock-release",
      storeDir,
      append: async (text: string) => {
        retried.push(text);
        return { ok: true };
      },
    });
    expect(retried).toEqual([INTERACTION_TIMEOUT_TEXT]);
    expect(second).toEqual({ persisted: true, text: INTERACTION_TIMEOUT_TEXT });
    expect(readChatTurnTerminal("run-lock-release", storeDir, "sess-lock-release")).toMatchObject({
      text: INTERACTION_TIMEOUT_TEXT,
      persistedToTranscript: true,
      recordTemporarilyUnavailable: false,
    });
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

it("lets a different run enter append while another run still holds its terminal critical section", async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-terminal-independent-run-"));
  const error = Object.assign(new Error("timeout"), {
    interactionPhase: "interpretation" as const,
    reason: "timeout",
  });
  let firstEntered!: () => void;
  const firstAppendEntered = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  let releaseFirst!: () => void;
  const holdFirst = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let secondEntered!: () => void;
  const secondAppendEntered = new Promise<void>((resolve) => {
    secondEntered = resolve;
  });
  try {
    const first = persistRejectedInteractionTurn({
      error,
      runId: "run-independent-a",
      sessionKey: "sess-independent",
      storeDir,
      append: async (_text: string) => {
        firstEntered();
        await holdFirst;
        return { ok: true };
      },
    });
    await firstAppendEntered;
    const second = persistRejectedInteractionTurn({
      error,
      runId: "run-independent-b",
      sessionKey: "sess-independent",
      storeDir,
      append: async (_text: string) => {
        secondEntered();
        return { ok: true };
      },
    });
    await Promise.race([
      secondAppendEntered,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("independent run was blocked by another run's terminal lock"));
        }, 1000);
      }),
    ]);
    releaseFirst();
    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual({ persisted: true, text: INTERACTION_TIMEOUT_TEXT });
    expect(right).toEqual({ persisted: true, text: INTERACTION_TIMEOUT_TEXT });
    expect(readChatTurnTerminal("run-independent-a", storeDir, "sess-independent")).toBeTruthy();
    expect(readChatTurnTerminal("run-independent-b", storeDir, "sess-independent")).toBeTruthy();
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

it("serializes reconcile and persist on the same terminal path so a late conflict cannot append", async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-terminal-reconcile-mutex-"));
  const written: string[] = [];
  let firstEntered!: () => void;
  const firstAppendEntered = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const first = persistRejectedInteractionTurn({
      error: Object.assign(new Error("timeout"), {
        interactionPhase: "interpretation" as const,
        reason: "timeout",
      }),
      runId: "run-reconcile-mutex",
      sessionKey: "sess-reconcile-mutex",
      storeDir,
      append: async (text: string) => {
        firstEntered();
        await barrier;
        written.push(text);
        return { ok: true };
      },
    });
    await firstAppendEntered;
    let reconcileSettledBeforeRelease = false;
    const reconciled = reconcileChatTurnTerminal({
      runId: "run-reconcile-mutex",
      sessionKey: "sess-reconcile-mutex",
      storeDir,
      append: async (text: string) => {
        written.push(text);
        return { ok: true };
      },
    }).then((result) => {
      reconcileSettledBeforeRelease = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(reconcileSettledBeforeRelease).toBe(false);
    expect(written).toHaveLength(0);
    release();
    const [left, recovered] = await Promise.all([first, reconciled]);
    expect(written).toEqual([INTERACTION_TIMEOUT_TEXT]);
    expect(left).toEqual({ persisted: true, text: INTERACTION_TIMEOUT_TEXT });
    expect(reconcileSettledBeforeRelease).toBe(true);
    expect(recovered.reconciled).toBe(false);
    expect(recovered.receipt).toMatchObject({
      text: INTERACTION_TIMEOUT_TEXT,
      businessExecution: "none",
      persistedToTranscript: true,
    });
    expect(
      readChatTurnTerminal("run-reconcile-mutex", storeDir, "sess-reconcile-mutex"),
    ).toMatchObject({
      text: INTERACTION_TIMEOUT_TEXT,
      businessExecution: "none",
      persistedToTranscript: true,
    });
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

it("persists a broken JSON / SyntaxError as a neutral Chinese bubble without leaking internals", async () => {
  const append = vi.fn(async (text: string) => ({ ok: true, text }));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const rawFragment = '{"kind":"reply"';
  try {
    const error = new SyntaxError(`Unexpected end of JSON input near ${rawFragment}`);
    const formatted = formatChatTurnTerminalText(error);
    expect(formatted.businessExecution).toBe("none");
    expect(formatted.text).toBe(REJECTED_INTERACTION_TURN_TEXT);
    expect(formatted.text).not.toMatch(/SyntaxError|Unexpected|kind":"reply/);
    const result = await persistRejectedInteractionTurn({
      error,
      runId: "syntax-run",
      append,
    });
    expect(result).toEqual({ persisted: true, text: REJECTED_INTERACTION_TURN_TEXT });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).toBe(REJECTED_INTERACTION_TURN_TEXT);
    const logged = warn.mock.calls.map((call) => JSON.stringify(call)).join("\n");
    expect(logged).toContain("[interaction-rejection-source]");
    expect(logged).toContain(shortChatRunId("syntax-run"));
    expect(logged).toContain("SyntaxError");
    expect(logged).not.toContain(rawFragment);
    expect(logged).not.toContain("Unexpected end of JSON input");
  } finally {
    warn.mockRestore();
  }
});

it("persists a missing-text interaction decision as a durable pre-admission notice", async () => {
  const append = vi.fn(async () => ({ ok: true }));
  const error = Object.assign(new Error("本轮未取得有效的交互决定，没有启动或修改任务。"), {
    interactionPhase: "interpretation" as const,
    reason: "empty",
    usageRecorded: true,
  });
  const result = await persistRejectedInteractionTurn({
    error,
    runId: "empty-decision",
    append,
  });
  expect(result.persisted).toBe(true);
  expect(result.text).toContain("模型未返回有效的交互决定");
  expect(result.text).not.toBe(INTERACTION_TIMEOUT_TEXT);
  expect(result.text).not.toMatch(/SyntaxError|stack|\\{/);
  expect(append).toHaveBeenCalledTimes(1);
});

it("persists workspace binding failures as confirmed pre-admission errors", () => {
  const error = new Error("workspace_binding_required:resource_missing_or_ambiguous");
  expect(formatChatTurnTerminalText(error)).toEqual({
    text: "workspace_binding_required:resource_missing_or_ambiguous",
    businessExecution: "none",
  });
});
