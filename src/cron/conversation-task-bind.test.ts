import { describe, expect, it } from "vitest";
import { readBoundConversationTaskGoal } from "./conversation-task-bind.js";

describe("cron ConversationTask bind (P10 / EA-I1)", () => {
  it("does not mint identity when tenant or id is missing", () => {
    expect(readBoundConversationTaskGoal({})).toBeUndefined();
    expect(readBoundConversationTaskGoal({ tenantId: "t1" })).toBeUndefined();
    expect(
      readBoundConversationTaskGoal({ tenantId: "t1", conversationTaskId: "agent:bot-2:main" }),
    ).toBeUndefined();
  });
});
