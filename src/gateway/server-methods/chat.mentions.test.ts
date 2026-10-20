import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../../auto-reply/templating.js";
import { ErrorCodes } from "../protocol/index.js";
import type { GatewayRequestContext } from "./types.js";

const mockState = vi.hoisted(() => ({
  lastDispatchCtx: undefined as MsgContext | undefined,
}));

const mentionDeliverMock = vi.hoisted(() => vi.fn());
const resolveRuntimeOrganizationContextMock = vi.hoisted(() => vi.fn());
const dispatchInboundMessageMock = vi.hoisted(() => vi.fn());
const buildEmployeeSessionVisibilityContextMock = vi.hoisted(() => vi.fn());
const isSessionVisibleToEmployeeActorMock = vi.hoisted(() => vi.fn());

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: (rawKey: string) => ({
      cfg: {
        session: { mainKey: "main" },
        agents: {
          defaults: { workspace: "/tmp/openclaw-mention-workspace" },
        },
      },
      storePath: path.join("/tmp", "openclaw-mention-sessions.json"),
      entry: {
        sessionId: "sess-mentions",
      },
      canonicalKey: rawKey || "main",
    }),
  };
});

vi.mock("../../auto-reply/dispatch.js", () => ({
  dispatchInboundMessage: dispatchInboundMessageMock,
}));

vi.mock("../../organization/runtime.js", () => ({
  resolveRuntimeOrganizationContext: resolveRuntimeOrganizationContextMock,
}));

vi.mock("../../organization/mention-delivery.js", () => ({
  MentionDelivery: {
    deliver: mentionDeliverMock,
  },
}));

vi.mock("../employee-workbench-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../employee-workbench-scope.js")>();
  return {
    ...original,
    buildEmployeeSessionVisibilityContext: (...args: unknown[]) =>
      buildEmployeeSessionVisibilityContextMock(...args),
    isSessionVisibleToEmployeeActor: (...args: unknown[]) =>
      isSessionVisibleToEmployeeActorMock(...args),
  };
});

const { chatHandlers } = await import("./chat.js");

function createChatContext(): Pick<
  GatewayRequestContext,
  | "broadcast"
  | "broadcastChat"
  | "nodeSendToSession"
  | "agentRunSeq"
  | "chatAbortControllers"
  | "chatRunBuffers"
  | "chatDeltaSentAt"
  | "chatAbortedRuns"
  | "removeChatRun"
  | "dedupe"
  | "registerToolEventRecipient"
  | "logGateway"
> {
  return {
    broadcast: vi.fn() as unknown as GatewayRequestContext["broadcast"],
    broadcastChat: vi.fn() as unknown as GatewayRequestContext["broadcastChat"],
    nodeSendToSession: vi.fn() as unknown as GatewayRequestContext["nodeSendToSession"],
    agentRunSeq: new Map<string, number>(),
    chatAbortControllers: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    chatAbortedRuns: new Map(),
    removeChatRun: vi.fn(),
    dedupe: new Map(),
    registerToolEventRecipient: vi.fn(),
    logGateway: {
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as GatewayRequestContext["logGateway"],
  };
}

async function sendChat(params?: {
  requestParams?: Record<string, unknown>;
  context?: ReturnType<typeof createChatContext>;
  respond?: ReturnType<typeof vi.fn>;
}) {
  const context = params?.context ?? createChatContext();
  const respond = params?.respond ?? vi.fn();

  await chatHandlers["chat.send"]({
    params: {
      sessionKey: "main",
      message: "@alice hi",
      idempotencyKey: "idem-mentions",
      ...params?.requestParams,
    },
    respond: respond as unknown as Parameters<(typeof chatHandlers)["chat.send"]>[0]["respond"],
    req: {} as never,
    client: null as never,
    isWebchatConnect: () => false,
    context: context as GatewayRequestContext,
  });

  return { context, respond };
}

describe("chat.send mention metadata", () => {
  beforeEach(() => {
    mockState.lastDispatchCtx = undefined;
    mentionDeliverMock.mockReset();
    mentionDeliverMock.mockResolvedValue({ delivered: [], errors: [] });
    resolveRuntimeOrganizationContextMock.mockReset();
    resolveRuntimeOrganizationContextMock.mockResolvedValue({
      organization: { id: "org-1", name: "Org 1" },
      self: {
        agentId: "main",
        displayName: "main",
        organizationId: "org-1",
        permissions: [],
        reachableAgents: [],
        identitySource: "fallback",
        capabilities: [],
      },
      members: [{ agentId: "alice", displayName: "Alice" }],
    });
    dispatchInboundMessageMock.mockReset();
    dispatchInboundMessageMock.mockImplementation(
      async (params: {
        ctx: MsgContext;
        replyOptions?: {
          onAgentRunStart?: (runId: string) => void;
        };
      }) => {
        mockState.lastDispatchCtx = params.ctx;
        params.replyOptions?.onAgentRunStart?.("agent-run-mentions");
        return { ok: true };
      },
    );
    buildEmployeeSessionVisibilityContextMock.mockReset();
    buildEmployeeSessionVisibilityContextMock.mockResolvedValue({
      actor: {
        userId: "alice@example.com",
        userEmail: "alice@example.com",
        seatAgentIds: ["main"],
        seatSpaceIds: [],
      },
      visibleAgentIds: new Set(["main"]),
      visibleSpaceIds: new Set(),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });
    isSessionVisibleToEmployeeActorMock.mockReset();
    isSessionVisibleToEmployeeActorMock.mockReturnValue(true);
  });

  it("accepts mentions and schedules MentionDelivery after chat.send starts", async () => {
    const mentions = [
      {
        mention_id: "mention-1",
        agentId: "alice",
        displayName: "alice",
        offset: 0,
        length: 6,
      },
    ];
    const { respond } = await sendChat({
      requestParams: {
        idempotencyKey: "idem-mentions-ok",
        mentions,
      },
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId: "idem-mentions-ok", status: "started" },
      undefined,
      { runId: "idem-mentions-ok" },
    );
    await vi.waitFor(() => {
      expect(mentionDeliverMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: "idem-mentions-ok",
          messageText: "@alice hi",
          mentions,
          sourceAgentId: "main",
          organizationId: "org-1",
        }),
      );
    });
    expect(dispatchInboundMessageMock).toHaveBeenCalled();
  });

  it("forwards parent-scoped context sources on direct chat.send", async () => {
    await sendChat({
      requestParams: {
        idempotencyKey: "idem-context-scope",
        contextScope: {
          mode: "focused",
          lifetime: "turn",
          sources: [{ type: "file", id: "doc-roadmap", parentId: "kb-product" }],
        },
      },
    });

    await vi.waitFor(() => {
      expect(dispatchInboundMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          replyOptions: expect.objectContaining({
            contextScopeRequest: {
              mode: "focused",
              lifetime: "turn",
              sources: [{ type: "file", id: "doc-roadmap", parentId: "kb-product" }],
            },
          }),
        }),
      );
    });
  });

  it("rejects invalid mention payload shape before dispatch", async () => {
    const context = createChatContext();
    const respond = vi.fn();

    await sendChat({
      context,
      respond,
      requestParams: {
        idempotencyKey: "idem-mentions-invalid",
        mentions: [{ mention_id: "mention-1", agentId: "alice", offset: 0, length: 6 }],
      },
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
    expect(dispatchInboundMessageMock).not.toHaveBeenCalled();
    expect(mentionDeliverMock).not.toHaveBeenCalled();
  });

  it("does not fail chat.send when MentionDelivery fails asynchronously", async () => {
    mentionDeliverMock.mockRejectedValueOnce(new Error("mention bus unavailable"));
    const context = createChatContext();
    const respond = vi.fn();

    await sendChat({
      context,
      respond,
      requestParams: {
        idempotencyKey: "idem-mentions-delivery-fails",
        mentions: [
          {
            mention_id: "mention-1",
            agentId: "alice",
            displayName: "alice",
            offset: 0,
            length: 6,
          },
        ],
      },
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      { runId: "idem-mentions-delivery-fails", status: "started" },
      undefined,
      { runId: "idem-mentions-delivery-fails" },
    );
    await vi.waitFor(() => {
      expect(context.logGateway.warn).toHaveBeenCalledWith(
        expect.stringContaining("mention bus unavailable"),
      );
    });
  });

  // Regression: short employee-steward messages used to be hijacked by a
  // template-only "steward ask" branch (any message <= 12 chars), which answered
  // with a canned workspace-overview line instead of reasoning about the request.
  // Re-landed after merge 849f257032 reintroduced the remote path.
  it.each(["重新输出excel表格", "早上好", "大白", "在吗"])(
    "routes short steward message %j through the real chat runtime",
    async (message) => {
      const context = createChatContext();
      const respond = vi.fn();
      const idempotencyKey = `idem-daibai-short-${message}`;

      await chatHandlers["chat.send"]({
        params: {
          sessionKey: "agent:main:employee:alice-example-com",
          message,
          idempotencyKey,
        },
        respond: respond as unknown as Parameters<(typeof chatHandlers)["chat.send"]>[0]["respond"],
        req: {} as never,
        client: {
          sessionDomain: "employee",
          user: "alice@example.com",
          platformUserId: "alice@example.com",
          sessionEnterpriseId: "acme",
        } as never,
        isWebchatConnect: () => false,
        context: context as GatewayRequestContext,
      });

      await vi.waitFor(() => {
        expect(dispatchInboundMessageMock).toHaveBeenCalled();
      });
      expect(respond).toHaveBeenNthCalledWith(
        1,
        true,
        { runId: idempotencyKey, status: "started" },
        undefined,
        { runId: idempotencyKey },
      );
      // No fabricated assistant answer may be broadcast in place of the model reply.
      const broadcasts = [
        ...(context.broadcast as ReturnType<typeof vi.fn>).mock.calls,
        ...(context.broadcastChat as ReturnType<typeof vi.fn>).mock.calls,
      ];
      const payload = JSON.stringify(broadcasts);
      expect(payload).not.toContain("我在");
      expect(payload).not.toContain("当前可见");
    },
  );
});
