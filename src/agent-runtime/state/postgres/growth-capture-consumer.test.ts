import { expect, it, vi } from "vitest";
import { createGrowthCaptureConsumer } from "./growth-capture-consumer.js";
it("reuses persisted publication after lost acknowledgement without resampling", async () => {
  const query = vi.fn().mockResolvedValue({
    rows: [{ payload: { type: "growth.operational", agentId: "agent" } }],
    rowCount: 1,
  });
  const capture = vi.fn();
  await createGrowthCaptureConsumer({ db: { query }, tenantId: "tenant", capture })(
    "capture",
    "execution",
    "agent",
  );
  expect(capture).not.toHaveBeenCalled();
  expect(query.mock.calls[0][1]).toEqual(["tenant", "capture:operational", "execution"]);
});
it("does not publish or confirm when authorized capture fails", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const handler = createGrowthCaptureConsumer({
    db: { query },
    tenantId: "tenant",
    capture: async () => {
      throw new Error("skill authority unavailable");
    },
  });
  await expect(handler("capture", "execution", "agent")).rejects.toThrow("authority unavailable");
  expect(query).toHaveBeenCalledTimes(1);
});
