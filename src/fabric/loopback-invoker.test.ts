import { expect, it, vi } from "vitest";
import { createLoopbackToolInvoker } from "./loopback-invoker.js";
const request = {
  tool: "message",
  sessionKey: "session",
  args: { text: "hello" },
  operationIdentity: {
    tenantId: "tenant",
    taskId: "task",
    executionId: "execution",
    stepId: "step",
    operationId: "send",
  },
};
it("requires issuer and sends execution capability without trusting payload tenant as authority", async () => {
  const fetchImpl = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, result: "sent" }), { status: 200 }),
  );
  expect(
    (await createLoopbackToolInvoker({ baseUrl: "http://127.0.0.1", fetchImpl }).invoke(request))
      .ok,
  ).toBe(false);
  expect(fetchImpl).not.toHaveBeenCalled();
  const issue = vi.fn(async () => "execution-capability");
  expect(
    (
      await createLoopbackToolInvoker({
        baseUrl: "http://127.0.0.1",
        token: "gateway",
        fetchImpl,
        issueExecutionGrant: issue,
      }).invoke(request)
    ).ok,
  ).toBe(true);
  expect(issue).toHaveBeenCalledWith(request);
  expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
    authorization: "Bearer gateway",
    "x-openbot-execution-grant": "execution-capability",
  });
});
