import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { maybeControlledDiscussToTaskBeforeDiscussion } from "./discuss-to-task-chat-hook.js";
import { formatDiscussToTaskUserVisibleStatus } from "./discuss-to-task-chat-receipt.js";

const GENERIC_REFUSAL_VISIBLE =
  "委托意图尚不明确或缺少验收条件，请补充后再建立正式任务。 （任务已建立=否；工作项已发布=否；责任已接受=否；计划已提出=否；计划已确认=否）";

describe("discuss-to-task-chat-hook clarification copy", () => {
  it("truly incomplete delegation names the missing field and keeps understood content", async () => {
    const result = await maybeControlledDiscussToTaskBeforeDiscussion({
      groupId: "grp_d2t",
      sourceMessageId: "incomplete-research",
      message: "请团队正式开展一项研究",
      actor: "human:owner",
      client: {},
      tenant: null,
      cfg: {} as OpenBotConfig,
    });
    expect(result).not.toBeNull();
    expect(result?.classification).toBe("needs_clarification");
    expect(result?.attempted).toBe(false);
    expect(result?.userMessage).toContain("已理解：");
    expect(result?.userMessage).toContain("目标：");
    expect(result?.userMessage).toMatch(/研究/);
    expect(result?.userMessage).toContain("还缺少：交付物或验收条件");
    expect(result?.userMessage).not.toBe(
      "委托意图尚不明确或缺少验收条件，请补充后再建立正式任务。",
    );
    const visible = formatDiscussToTaskUserVisibleStatus(result!);
    expect(visible).not.toBe(GENERIC_REFUSAL_VISIBLE);
    expect(visible).toContain("还缺少：交付物或验收条件");
  });
});
