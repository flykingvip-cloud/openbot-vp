import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CRON_TASK_FOCUS_FLAG_ENV } from "../task-focus.js";
import {
  makeIsolatedAgentTurnJob,
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";
import {
  loadRunCronIsolatedAgentTurn,
  makeCronSession,
  resolveCronSessionMock,
  runEmbeddedPiAgentMock,
  runWithModelFallbackMock,
} from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

function personalCronDescription(): string {
  const meta = {
    intentText: "写巡检日报",
    goal: "完成巡检日报",
    acceptanceRules: ["发出摘要"],
  };
  return `巡检\n<!--openbot-task-meta:${encodeURIComponent(JSON.stringify(meta))}-->`;
}

describe("runCronIsolatedAgentTurn Phase 1b task-focus prompt", () => {
  setupRunCronIsolatedAgentTurnSuite();

  let previousFlag: string | undefined;

  beforeEach(() => {
    previousFlag = process.env[CRON_TASK_FOCUS_FLAG_ENV];
    delete process.env[CRON_TASK_FOCUS_FLAG_ENV];
    resolveCronSessionMock.mockReturnValue(
      makeCronSession({
        sessionEntry: { sessionId: "occ-focus-1", updatedAt: 0, systemSent: false },
      }),
    );
    runWithModelFallbackMock.mockImplementation(
      async (opts: {
        run: (
          provider: string,
          model: string,
          runOptions: Record<string, unknown>,
        ) => Promise<unknown>;
      }) => {
        const result = await opts.run("openai", "gpt-4", {});
        return { result, provider: "openai", model: "gpt-4" };
      },
    );
  });

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env[CRON_TASK_FOCUS_FLAG_ENV];
    } else {
      process.env[CRON_TASK_FOCUS_FLAG_ENV] = previousFlag;
    }
  });

  it("OFF does not inject Phase 1b focus contract into extraSystemPrompt", async () => {
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        job: makeIsolatedAgentTurnJob({ description: personalCronDescription() }),
      }),
    );
    expect(result.status).toBe("ok");
    const extra = runEmbeddedPiAgentMock.mock.calls[0]?.[0]?.extraSystemPrompt ?? "";
    expect(extra).not.toContain("权威任务焦点");
    // Unbound personal cron injects schedule copy, not ConversationTask identity.
    expect(extra).toContain("本次定时执行说明");
    expect(extra).toContain("完成巡检日报");
    expect(extra).not.toContain("当前任务契约");
  });

  it("ON injects goal anchors and does not mention alignment", async () => {
    process.env[CRON_TASK_FOCUS_FLAG_ENV] = "1";
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        job: makeIsolatedAgentTurnJob({ description: personalCronDescription() }),
      }),
    );
    expect(result.status).toBe("ok");
    const extra = String(runEmbeddedPiAgentMock.mock.calls[0]?.[0]?.extraSystemPrompt ?? "");
    expect(extra).toContain("权威任务焦点");
    expect(extra).toContain("目标：完成巡检日报");
    expect(extra).toContain("意图：写巡检日报");
    expect(extra).toContain("- 发出摘要");
    expect(extra.toLowerCase()).not.toMatch(/align|lease|ledger/i);
  });
});
