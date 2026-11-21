import { expect, it, vi } from "vitest";
import { drainRuntimeOutbox } from "./outbox-consumer.js";
const event = {
  event_id: "event",
  execution_id: "execution",
  payload: { state: "waiting" },
  claim_token: "token",
};
function store() {
  return {
    claim: vi.fn().mockResolvedValueOnce(event).mockResolvedValue(null),
    acknowledge: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
}
it("never acknowledges an event without a registered consumer", async () => {
  const db = store();
  expect(
    await drainRuntimeOutbox({ tenantId: "t", store: db, resolveHandler: () => undefined }),
  ).toMatchObject({ failed: 1, acknowledged: 0 });
  expect(db.acknowledge).not.toHaveBeenCalled();
});
it("acknowledges only after successful handling with original claim token", async () => {
  const db = store();
  const handler = vi.fn(async () => {
    expect(db.acknowledge).not.toHaveBeenCalled();
  });
  expect(
    await drainRuntimeOutbox({ tenantId: "t", store: db, resolveHandler: () => handler }),
  ).toMatchObject({ acknowledged: 1 });
  expect(db.acknowledge).toHaveBeenCalledWith("t", "event", "token");
});
it("retains failed work for retry and reports expired ownership", async () => {
  const db = store();
  db.fail.mockResolvedValue(false);
  expect(
    await drainRuntimeOutbox({
      tenantId: "t",
      store: db,
      resolveHandler: () => async () => {
        throw new Error("projection unavailable");
      },
    }),
  ).toMatchObject({ lost: 1, acknowledged: 0 });
  expect(db.acknowledge).not.toHaveBeenCalled();
});
