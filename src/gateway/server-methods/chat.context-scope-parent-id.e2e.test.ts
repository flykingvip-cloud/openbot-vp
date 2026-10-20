import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import {
  expectDispatchParentlessFileScope,
  expectDispatchTypedParentScope,
} from "../context-scope/assert-context-scope-dispatch.js";
import {
  buildChatSendUiPayload,
  CONTEXT_SCOPE_PARENTLESS_FILE,
  CONTEXT_SCOPE_TYPED_FILE,
} from "../context-scope/chat-context-scope-fixtures.js";

const dispatchInboundMessageMock = vi.hoisted(() =>
  vi.fn(async (params: { replyOptions?: { onAgentRunStart?: (runId: string) => void } }) => {
    params.replyOptions?.onAgentRunStart?.("agent-run-context-scope");
    return { ok: true };
  }),
);

vi.mock("../../auto-reply/dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auto-reply/dispatch.js")>();
  const dispatchInboundMessage = ((...args: unknown[]) =>
    dispatchInboundMessageMock(
      args[0] as Parameters<typeof dispatchInboundMessageMock>[0],
    )) as unknown as typeof actual.dispatchInboundMessage;
  return {
    ...actual,
    dispatchInboundMessage,
  };
});

const { connectWebchatClient, installGatewayTestHooks, rpcReq, withGatewayServer } =
  await import("../test-helpers.js");

installGatewayTestHooks({ scope: "suite" });

describe("UI chat.send contextScope parentId → gateway 1:1 dispatch", () => {
  it("Control UI webchat WS preserves parentId into contextScopeRequest", async () => {
    await withGatewayServer(async ({ port }) => {
      dispatchInboundMessageMock.mockClear();

      const ws = await connectWebchatClient({
        port,
        client: {
          id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
          version: "control-ui-test",
          platform: "test",
          mode: GATEWAY_CLIENT_MODES.WEBCHAT,
        },
      });

      const idempotencyKey = `run-typed-${randomUUID()}`;
      const payload = buildChatSendUiPayload({
        sessionKey: "main",
        idempotencyKey,
        contextScope: CONTEXT_SCOPE_TYPED_FILE,
      });

      const res = await rpcReq<{ runId?: string; status?: string }>(ws, "chat.send", payload);

      expect(res.ok).toBe(true);
      expect(res.payload?.status).toBe("started");
      expect(res.payload?.runId).toBe(idempotencyKey);

      await vi.waitFor(() => {
        expectDispatchTypedParentScope(dispatchInboundMessageMock);
      });

      ws.close();
    });
  });

  it("forwards parentless file sources unchanged (authorize fail-closed is separate)", async () => {
    await withGatewayServer(async ({ port }) => {
      dispatchInboundMessageMock.mockClear();

      const ws = await connectWebchatClient({
        port,
        client: {
          id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
          version: "control-ui-test",
          platform: "test",
          mode: GATEWAY_CLIENT_MODES.WEBCHAT,
        },
      });

      const idempotencyKey = `run-parentless-${randomUUID()}`;
      const payload = buildChatSendUiPayload({
        sessionKey: "main",
        idempotencyKey,
        contextScope: CONTEXT_SCOPE_PARENTLESS_FILE,
      });

      const res = await rpcReq<{ runId?: string; status?: string }>(ws, "chat.send", payload);

      expect(res.ok).toBe(true);
      expect(res.payload?.status).toBe("started");

      await vi.waitFor(() => {
        expectDispatchParentlessFileScope(dispatchInboundMessageMock);
      });

      ws.close();
    });
  });
});
