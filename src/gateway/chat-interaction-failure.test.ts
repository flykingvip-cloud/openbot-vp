import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { projectInteractionHistory } from "../agent-runtime/context/index.js";
import { persistInteractionMessage } from "../agent-runtime/state/index.js";
import { openSessionManager } from "../agents/pi-sdk/session.js";
import {
  BILLING_BLOCKED_INTERACTION_TEXT,
  persistRejectedInteractionTurn,
  REJECTED_INTERACTION_TURN_TEXT,
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
  expect(
    await persistRejectedInteractionTurn({ error: executionError, runId: "later", append }),
  ).toEqual({ persisted: false });
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
  const append = vi.fn();
  expect(
    await persistRejectedInteractionTurn({
      error: new Error("tool failed after send"),
      runId: "run",
      append,
    }),
  ).toEqual({ persisted: false });
  expect(append).not.toHaveBeenCalled();
});
it("does not claim durable closure when the transcript write fails", async () => {
  const append = vi.fn(async () => {
    throw new Error("disk error");
  });
  expect(
    await persistRejectedInteractionTurn({
      error: new Error("Invalid interaction task decision"),
      runId: "run",
      append,
    }),
  ).toEqual({ persisted: false });
});
