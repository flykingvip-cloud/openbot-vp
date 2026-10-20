import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __lifecyclePollConfig,
  _peekLifecycleRequestId,
  _resetLifecycleRequestIdsForTests,
  archiveAgentConversation,
  beginConversationSwitch,
  createAgentConversation,
  loadConversationsForAgent,
  openConversationSession,
  restoreAgentConversation,
  type ConversationsState,
} from "./conversations.ts";

function makeState(
  request: (method: string, params?: unknown) => Promise<unknown>,
): ConversationsState {
  return {
    client: { request } as ConversationsState["client"],
    connected: true,
    conversationsLoading: false,
    conversationsError: null,
    conversationsBusy: false,
    conversationsAgentId: null,
    conversationsGroupId: null,
    conversationsRows: [],
    conversationsShowArchived: false,
    conversationsPanelOpen: true,
    conversationsNextCursor: null,
    conversationsHasMore: false,
    conversationsSwitchGeneration: 0,
  };
}

describe("conversations controller", () => {
  afterEach(() => {
    _resetLifecycleRequestIdsForTests();
    __lifecyclePollConfig.pollMs = 400;
    __lifecyclePollConfig.pollMax = 90;
  });

  it("lists and normalizes conversation rows", async () => {
    const request = vi.fn(async (method: string) => {
      expect(method).toBe("conversations.list");
      return {
        rows: [
          {
            conversationId: "conv_1",
            title: "Hello",
            lifecycleStatus: "ACTIVE",
            storageTier: "HOT",
            retentionState: "RETAIN",
            titleSource: "AUTO",
            updatedAt: "2026-07-17T00:00:00.000Z",
            etag: "e1",
            agentId: "helper",
          },
        ],
      };
    });
    const state = makeState(request);
    await loadConversationsForAgent(state, { agentId: "helper" });
    expect(state.conversationsRows).toHaveLength(1);
    expect(state.conversationsRows[0]?.conversationId).toBe("conv_1");
    expect(state.conversationsRows[0]?.title).toBe("Hello");
    expect(state.conversationsLoading).toBe(false);
  });

  it("creates a conversation and returns sessionKey", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "conversations.create") {
        return {
          conversation: {
            conversationId: "conv_new",
            title: "New conversation",
            lifecycleStatus: "ACTIVE",
            storageTier: "HOT",
            retentionState: "RETAIN",
            titleSource: "AUTO",
            updatedAt: "2026-07-17T00:00:00.000Z",
            etag: "e2",
            agentId: "helper",
          },
          sessionKey: "agent:helper:conversation:conv_new",
        };
      }
      if (method === "conversations.list") {
        return { rows: [] };
      }
      throw new Error(`unexpected ${method}`);
    });
    const state = makeState(request);
    const created = await createAgentConversation(state, { agentId: "helper" });
    expect(created).toEqual({
      sessionKey: "agent:helper:conversation:conv_new",
      conversationId: "conv_new",
    });
    expect(request).toHaveBeenCalledWith(
      "conversations.create",
      expect.objectContaining({ surfaceType: "AGENT", agentId: "helper" }),
    );
  });

  it("marks openConversationSession stale when a newer switch started", async () => {
    const gate: { resolve: ((value: unknown) => void) | undefined } = { resolve: undefined };
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "conversations.get") {
        return await new Promise((resolve) => {
          gate.resolve = resolve;
        });
      }
      throw new Error(`unexpected ${method}`);
    });
    const state = makeState(request);
    const gen1 = beginConversationSwitch(state);
    const pending = openConversationSession(state, "conv_old", { generation: gen1 });
    // A later switch invalidates gen1.
    beginConversationSwitch(state);
    gate.resolve?.({
      conversation: { lifecycleStatus: "ACTIVE" },
      bindings: [{ sessionKey: "agent:helper:conversation:conv_old", role: "PRIMARY" }],
    });
    const result = await pending;
    expect(result?.stale).toBe(true);
  });

  it("appends list pages via cursor without duplicates", async () => {
    const request = async (method: string, params?: unknown) => {
      expect(method).toBe("conversations.list");
      const cursor =
        params && typeof params === "object" && "cursor" in params
          ? (params as { cursor?: string | null }).cursor
          : undefined;
      if (!cursor) {
        return {
          rows: [
            {
              conversationId: "conv_a",
              title: "A",
              lifecycleStatus: "ACTIVE",
              storageTier: "HOT",
              retentionState: "RETAIN",
              titleSource: "AUTO",
              updatedAt: "2026-07-17T00:00:00.000Z",
              etag: "e1",
              agentId: "helper",
            },
          ],
          nextCursor: "cursor-2",
        };
      }
      return {
        rows: [
          {
            conversationId: "conv_b",
            title: "B",
            lifecycleStatus: "ACTIVE",
            storageTier: "HOT",
            retentionState: "RETAIN",
            titleSource: "AUTO",
            updatedAt: "2026-07-16T00:00:00.000Z",
            etag: "e2",
            agentId: "helper",
          },
        ],
        nextCursor: null,
      };
    };
    const state = makeState(request);
    await loadConversationsForAgent(state, { agentId: "helper" });
    expect(state.conversationsRows).toHaveLength(1);
    expect(state.conversationsHasMore).toBe(true);
    await loadConversationsForAgent(state, { agentId: "helper", append: true });
    expect(state.conversationsRows.map((r) => r.conversationId)).toEqual(["conv_a", "conv_b"]);
    expect(state.conversationsHasMore).toBe(false);
  });

  describe("lifecycle RUNNING poll state machine", () => {
    it("RUNNING → SUCCEEDED clears requestId after poll", async () => {
      __lifecyclePollConfig.pollMs = 1;
      __lifecyclePollConfig.pollMax = 20;
      let jobPolls = 0;
      const request = vi.fn(async (method: string, params?: unknown) => {
        if (method === "conversations.archive") {
          expect(params).toEqual(
            expect.objectContaining({ conversationId: "conv_run", requestId: expect.any(String) }),
          );
          return {
            claimed: false,
            job: { jobId: "lcjob_1", status: "RUNNING", requestId: "rid-1" },
          };
        }
        if (method === "conversations.job") {
          jobPolls += 1;
          if (jobPolls < 2) {
            return { job: { jobId: "lcjob_1", status: "RUNNING" } };
          }
          return { job: { jobId: "lcjob_1", status: "SUCCEEDED" } };
        }
        if (method === "conversations.list") {
          return { rows: [] };
        }
        throw new Error(`unexpected ${method}`);
      });
      const state = makeState(request);
      const ok = await archiveAgentConversation(state, {
        conversationId: "conv_run",
        etag: "e1",
      });
      expect(ok).toBe(true);
      expect(jobPolls).toBeGreaterThanOrEqual(2);
      expect(_peekLifecycleRequestId("archive", "conv_run")).toBeUndefined();
      expect(state.conversationsShowArchived).toBe(true);
    });

    it("RUNNING → FAILED_RETRYABLE keeps requestId for retry", async () => {
      __lifecyclePollConfig.pollMs = 1;
      __lifecyclePollConfig.pollMax = 20;
      const request = vi.fn(async (method: string) => {
        if (method === "conversations.archive") {
          return {
            claimed: false,
            job: { jobId: "lcjob_fail", status: "RUNNING", requestId: "rid-f" },
          };
        }
        if (method === "conversations.job") {
          return { job: { jobId: "lcjob_fail", status: "FAILED_RETRYABLE" } };
        }
        throw new Error(`unexpected ${method}`);
      });
      const state = makeState(request);
      const ok = await archiveAgentConversation(state, { conversationId: "conv_fail" });
      expect(ok).toBe(false);
      expect(state.conversationsError).toMatch(/retry will reuse requestId/);
      expect(_peekLifecycleRequestId("archive", "conv_fail")).toBeTruthy();
    });

    it("poll timeout keeps requestId and does not treat as success", async () => {
      __lifecyclePollConfig.pollMs = 1;
      __lifecyclePollConfig.pollMax = 3;
      const request = vi.fn(async (method: string) => {
        if (method === "conversations.archive") {
          return {
            claimed: false,
            job: { jobId: "lcjob_hang", status: "RUNNING" },
          };
        }
        if (method === "conversations.job") {
          return { job: { jobId: "lcjob_hang", status: "RUNNING" } };
        }
        throw new Error(`unexpected ${method}`);
      });
      const state = makeState(request);
      const ok = await archiveAgentConversation(state, { conversationId: "conv_hang" });
      expect(ok).toBe(false);
      expect(state.conversationsError).toMatch(/still running/);
      expect(_peekLifecycleRequestId("archive", "conv_hang")).toBeTruthy();
      // Exactly pollMax job polls after the initial archive.
      expect(request.mock.calls.filter((c) => c[0] === "conversations.job").length).toBe(3);
    });

    it("restore RUNNING→SUCCEEDED reuses requestId and returns primary sessionKey", async () => {
      __lifecyclePollConfig.pollMs = 1;
      __lifecyclePollConfig.pollMax = 20;
      const seenRequestIds: string[] = [];
      const request = vi.fn(async (method: string, params?: unknown) => {
        if (method === "conversations.restore") {
          const rid =
            params && typeof params === "object" && "requestId" in params
              ? String((params as { requestId?: string }).requestId)
              : "";
          seenRequestIds.push(rid);
          if (seenRequestIds.length === 1) {
            return {
              claimed: false,
              job: { jobId: "lcjob_rest", status: "RUNNING", requestId: rid },
            };
          }
          // Second call (after poll SUCCEEDED) returns primary sessionKey.
          return {
            claimed: false,
            job: { jobId: "lcjob_rest", status: "SUCCEEDED", requestId: rid },
            sessionKey: "agent:helper:conversation:conv_rest",
            binding: {
              sessionKey: "agent:helper:conversation:conv_rest",
              role: "PRIMARY",
            },
          };
        }
        if (method === "conversations.job") {
          return { job: { jobId: "lcjob_rest", status: "SUCCEEDED" } };
        }
        if (method === "conversations.list") {
          return { rows: [] };
        }
        throw new Error(`unexpected ${method}`);
      });
      const state = makeState(request);
      const result = await restoreAgentConversation(state, {
        conversationId: "conv_rest",
        etag: "e1",
      });
      expect(result?.sessionKey).toBe("agent:helper:conversation:conv_rest");
      expect(seenRequestIds.length).toBe(2);
      expect(seenRequestIds[0]).toBe(seenRequestIds[1]);
      expect(_peekLifecycleRequestId("restore", "conv_rest")).toBeUndefined();
    });
  });
});
