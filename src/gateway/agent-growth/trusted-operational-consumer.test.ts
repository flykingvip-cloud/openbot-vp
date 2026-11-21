import { expect, it, vi } from "vitest";
import type { GatewayClient } from "../server-methods/types.js";
const mocks = vi.hoisted(() => ({ membership: vi.fn(), dir: vi.fn() }));
vi.mock("../tenant-context.js", () => ({
  resolveAuthoritativeMembership: mocks.membership,
  resolveAgentDirForClient: mocks.dir,
}));
vi.mock("./operational-event-consumer.js", () => ({
  createOperationalGrowthConsumer:
    (input: { resolveAgentDir: (id: string) => Promise<string> }) => async () =>
      input.resolveAgentDir("agent"),
}));
import { createTrustedOperationalGrowthConsumer } from "./trusted-operational-consumer.js";
it("revalidates membership and refuses directory access after tenant revocation", async () => {
  const client = {} as GatewayClient;
  mocks.membership
    .mockResolvedValueOnce({ tenantId: "tenant" })
    .mockResolvedValueOnce({ tenantId: "other" });
  mocks.dir.mockResolvedValue("/tmp/test-agent");
  const handler = createTrustedOperationalGrowthConsumer({ cfg: {}, client, tenantId: "tenant" });
  await handler("event", "agent", {});
  expect(mocks.dir).toHaveBeenCalledTimes(1);
  await expect(handler("event-2", "agent", {})).rejects.toThrow("authority mismatch");
  expect(mocks.dir).toHaveBeenCalledTimes(1);
});
