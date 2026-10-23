import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  issueOguiDecisionFromText,
  OGUI_WAIT_PAUSE_TEXT,
  type OguiDecisionRunBinding,
} from "../../config/sessions/ogui-decision-engine.js";
import { clearOguiWaitRegistryForTests } from "../../config/sessions/ogui-decision-wait-registry.js";
import { loadSessionStore, updateSessionStore } from "../../config/sessions/store.js";
import type { FollowupRun } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const runEmbeddedPiAgentMock = vi.fn();

vi.mock(
  "../../agents/model-fallback.js",
  async () => await import("../../test-utils/model-fallback.mock.js"),
);

vi.mock("../../agents/pi-embedded.js", () => ({
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

import { createFollowupRunner } from "./followup-runner.js";

afterEach(() => {
  clearOguiWaitRegistryForTests();
  runEmbeddedPiAgentMock.mockReset();
});

describe("follow-up drain OGUI WAIT (Ev10)", () => {
  it("does not start the embedded agent while a decision is waiting", async () => {
    const previous = process.env.OPENBOT_OGUI_DECISION_LIFECYCLE;
    process.env.OPENBOT_OGUI_DECISION_LIFECYCLE = "1";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ogui-followup-"));
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:followup-wait";
    try {
      await updateSessionStore(storePath, (store) => {
        store[sessionKey] = { sessionId: "sid-followup", updatedAt: 1 };
      });
      const binding: OguiDecisionRunBinding = {
        lifecycleEnabled: true,
        cfg: { collaboration: { task: { oguiDecisionLifecycle: true } } },
        storePath,
        sessionKey,
        userId: "user-1",
        originRunId: "run-origin",
        ingress: "chat",
        allowIssue: true,
      };
      await issueOguiDecisionFromText({
        text: [
          "```ogui-form",
          JSON.stringify({
            schema_version: "ogui/v1",
            component_id: "cmp-q",
            title: "选口径",
            fields: [
              {
                id: "choice",
                label: "口径",
                type: "single_select",
                options: [
                  { value: "a", label: "甲" },
                  { value: "b", label: "乙" },
                ],
              },
            ],
          }),
          "```",
        ].join("\n"),
        binding,
        env: { OPENBOT_OGUI_DECISION_LIFECYCLE: "1" },
      });
      runEmbeddedPiAgentMock.mockResolvedValue({ payloads: [], meta: {} });
      const onBlockReply = vi.fn(async () => {});
      const runner = createFollowupRunner({
        opts: { onBlockReply },
        typing: createMockTypingController(),
        typingMode: "instant",
        sessionKey,
        storePath,
        defaultModel: "anthropic/claude",
      });
      const queued = {
        prompt: "继续做后面独立的部分",
        summaryLine: "继续",
        enqueuedAt: 1,
        run: {
          sessionId: "sid-followup",
          sessionKey,
          config: {},
          provider: "anthropic",
          model: "claude",
          oguiDecisionRun: binding,
        },
      } as FollowupRun;
      await runner(queued);
      await runner(queued);
      expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
      expect(onBlockReply).toHaveBeenCalledTimes(2);
      const calls = onBlockReply.mock.calls as unknown as Array<Array<{ text?: string }>>;
      expect(calls[0]?.[0]?.text).toBe(OGUI_WAIT_PAUSE_TEXT);
      expect(calls[1]?.[0]?.text).toBe(OGUI_WAIT_PAUSE_TEXT);
      const stored = Object.values(
        loadSessionStore(storePath, { skipCache: true })[sessionKey]?.oguiDecisions ?? {},
      )[0];
      expect(stored?.decisionStatus).toBe("waiting");
      expect(stored?.resumeStatus).toBe("pending");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_OGUI_DECISION_LIFECYCLE;
      } else {
        process.env.OPENBOT_OGUI_DECISION_LIFECYCLE = previous;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
