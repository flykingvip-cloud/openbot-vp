import { describe, expect, it, vi } from "vitest";
import { validateCollaborationTaskRequestAcceptedArtifactDeliveryParams } from "../../gateway/protocol/index.js";
import { collaborationLearningHandlers } from "../../gateway/server-methods/collaboration-learning.js";

describe("collaboration.task.requestAcceptedArtifactDelivery", () => {
  it("rejects a request body that carries a grant", () => {
    const ok = validateCollaborationTaskRequestAcceptedArtifactDeliveryParams({
      groupId: "grp-1",
      taskId: "task-1",
      itemId: "item-1",
      target: { channel: "telegram", to: "chat-1" },
      grant: { actorId: "body-actor" },
    });
    expect(ok).toBe(false);
  });

  it("does not issue when the gateway client is unauthenticated", async () => {
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.requestAcceptedArtifactDelivery"]({
      params: {
        groupId: "grp-1",
        taskId: "task-1",
        itemId: "item-1",
        target: { channel: "telegram", to: "chat-1" },
      },
      client: null,
      respond,
      req: {} as never,
      context: {} as never,
      isWebchatConnect: () => false,
    });
    expect(respond).toHaveBeenCalled();
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });
});
