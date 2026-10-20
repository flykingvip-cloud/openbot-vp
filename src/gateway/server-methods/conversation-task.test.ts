import { describe, expect, it, vi } from "vitest";
import { conversationTaskHandlers } from "./conversation-task.js";

vi.mock("../scope-attribution.js", () => ({
  resolveTrustedAttribution: async () => ({ ownerId: "user-1" }),
}));

describe("conversation-task.active.get", () => {
  it("rejects a missing conversationId", async () => {
    const respond = vi.fn();
    await conversationTaskHandlers["conversation-task.active.get"]?.({
      req: { id: "1", method: "conversation-task.active.get" } as never,
      params: {},
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: { cronStorePath: "/tmp/missing-cron.json" } as never,
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "conversationId is required" }),
    );
  });
});
