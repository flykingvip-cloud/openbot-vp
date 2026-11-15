import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import type { FollowupRun } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const resolveExecutionWorkspace = vi.fn();

vi.mock("../../gateway/workspace-resolver/execution-workspace.js", () => ({
  resolveExecutionWorkspace: (...args: unknown[]) => resolveExecutionWorkspace(...args),
}));

const { createFollowupRunner } = await import("./followup-runner.js");

function queuedRun(workspaceDir: string): FollowupRun {
  return {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    originatingTo: "channel:C1",
    run: {
      sessionId: "session",
      sessionKey: "main",
      agentId: "robot",
      messageProvider: "whatsapp",
      agentAccountId: "primary",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir,
      config: {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as FollowupRun;
}

beforeEach(() => {
  resolveExecutionWorkspace.mockReset();
});

it("blocks a followup when the queued workspace no longer matches the canonical binding", async () => {
  const root = path.resolve("/tmp/canonical-followup-root");
  resolveExecutionWorkspace.mockResolvedValue({
    resourceId: "ws:tenant:seat:seat:asset:asset",
    bindingId: "binding",
    contentVersion: "2",
    rootPath: root,
  });
  const runner = createFollowupRunner({
    typing: createMockTypingController(),
    typingMode: "instant",
    defaultModel: "anthropic/claude-opus-4-5",
  });
  await expect(runner(queuedRun("/tmp/old-queued-workspace"))).rejects.toThrow(
    /workspace_binding_changed/,
  );
  expect(resolveExecutionWorkspace).toHaveBeenCalled();
});
