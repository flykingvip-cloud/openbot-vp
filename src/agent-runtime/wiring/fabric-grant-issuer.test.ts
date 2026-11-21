import { expect, it, vi } from "vitest";
import { createFabricGrantIssuer } from "./fabric-grant-issuer.js";
it("issues against host lease and rejects request-owned tenant/execution overrides", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ token_hash: "issued" }], rowCount: 1 });
  const controller = new AbortController();
  const issue = createFabricGrantIssuer({
    db: { query },
    tenantId: "tenant",
    taskId: "task",
    executionId: "execution",
    owner: "host-owner",
    fence: "7",
    sessionKey: "session",
    signal: controller.signal,
  });
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
  expect(await issue(request)).toBeTruthy();
  expect(query.mock.calls[0][1]).toContain("host-owner");
  expect(query.mock.calls[0][1]).toContain("7");
  await expect(
    issue({ ...request, operationIdentity: { ...request.operationIdentity, tenantId: "other" } }),
  ).rejects.toThrow("conflicts");
  expect(query).toHaveBeenCalledTimes(1);
  controller.abort(new Error("cancelled"));
  await expect(issue(request)).rejects.toThrow("cancelled");
  expect(query).toHaveBeenCalledTimes(1);
});
