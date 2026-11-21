import { expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("./operational-event-consumer.js", () => ({
  createOperationalGrowthConsumer: (input: {
    resolveAgentDir: (id: string) => Promise<string>;
  }) => {
    resolve.mockImplementation(input.resolveAgentDir);
    return async (_event: string, agent: string) => resolve(agent);
  },
}));
import { createBackgroundGrowthConsumer } from "./background-consumer-authority.js";
it("requires a live explicit agent grant rather than an environment tenant hint", async () => {
  const authorize = vi.fn().mockResolvedValue({
    principalId: "service",
    context: { tenantId: "tenant", userId: "service-user", domain: "enterprise" },
    agentIds: [],
  });
  const consumer = createBackgroundGrowthConsumer({ cfg: {}, tenantId: "tenant", authorize });
  await expect(consumer("event", "agent", {})).rejects.toThrow("not authorized");
  expect(authorize).toHaveBeenCalledTimes(1);
});
