import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { maybeControlledDiscussToTaskBeforeDiscussion } from "./discuss-to-task-chat-hook.js";

describe("semantic lifecycle before formal group task admission", () => {
  const base = {
    groupId: "grp_d2t",
    sourceMessageId: "small",
    actor: "human:owner",
    client: {},
    tenant: null,
    cfg: {} as OpenBotConfig,
    message: "请团队整理这三行数字，交付：一段当场答复。只做本轮，不持续跟踪。",
  };
  it("does not enter formal task activation for current-turn work", async () => {
    expect(
      await maybeControlledDiscussToTaskBeforeDiscussion({
        ...base,
        understanding: {
          kind: "execution_request",
          request: { lifecycle: "turn", goal: "整理数字并当场回答", acceptance: ["回答准确"] },
        },
      }),
    ).toBeNull();
  });
  it("treats missing lifecycle as current-turn work", async () => {
    expect(
      await maybeControlledDiscussToTaskBeforeDiscussion({
        ...base,
        understanding: {
          kind: "execution_request",
          request: { goal: "整理数字", acceptance: ["回答准确"] },
        },
      }),
    ).toBeNull();
  });
  it("does not turn clarification or a direct reply into a formal task", async () => {
    for (const kind of ["reply", "clarify"] as const) {
      expect(
        await maybeControlledDiscussToTaskBeforeDiscussion({
          ...base,
          understanding: { kind, text: "请补充数据" },
        }),
      ).toBeNull();
    }
  });
  it("uses the semantic long-task decision without reclassifying its original words", async () => {
    const result = await maybeControlledDiscussToTaskBeforeDiscussion({
      ...base,
      message: "按刚才定下的分阶段目标开始",
      understanding: {
        kind: "execution_request",
        request: {
          lifecycle: "long_task",
          goal: "连续监测后交付研究",
          acceptance: ["阶段证据与终稿"],
        },
      },
    });
    expect(result?.classification).toBe("explicit_delegation");
    expect(result?.statusCode).toBe("formal_task_blocked_flag_off");
    expect(result?.taskId).toBeNull();
  });
  it("never falls back to the lexical classifier without a semantic decision", async () => {
    await expect(maybeControlledDiscussToTaskBeforeDiscussion(base)).rejects.toThrow(
      /understanding is required/,
    );
  });
});
