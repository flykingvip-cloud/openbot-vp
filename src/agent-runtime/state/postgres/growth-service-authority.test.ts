import { expect, it, vi } from "vitest";
import { createGrowthServiceAuthorizer } from "./growth-service-authority.js";
it("requeries grants and rejects revocation without trusting environment identity", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [{ user_id: "user", domain: "enterprise", agent_ids: ["agent"] }],
      rowCount: 1,
    })
    .mockResolvedValue({ rows: [], rowCount: 0 });
  const authorize = createGrowthServiceAuthorizer({ query }, "tenant", "principal");
  expect((await authorize()).agentIds).toEqual(["agent"]);
  await expect(authorize()).rejects.toThrow("missing");
  expect(query.mock.calls[0][1]).toEqual(["tenant", "principal"]);
});
