import { afterEach, expect, it, vi } from "vitest";
import {
  clearAwaitingDeliveriesForTests,
  registerAwaitingDelivery,
  peekAwaitingDelivery,
} from "../../../task-outcome/pending-delivery.js";
import { confirmPendingTurnDeliveryWithPorts } from "./confirm-pending.js";
const confirm = vi.hoisted(() => vi.fn());
vi.mock("../../../task-outcome/runtime-from-runner.js", () => ({
  confirmRunnerTurnDelivery: confirm,
}));
afterEach(() => {
  clearAwaitingDeliveriesForTests();
  confirm.mockReset();
});
it.each(["missing", "wrong-run", "wrong-delivery", "wrong-status"])(
  "retains pending association when confirmation is %s",
  async (mode) => {
    registerAwaitingDelivery({ taskId: "t", deliveryId: "d", agentId: "a", runId: "r" });
    confirm.mockResolvedValue(
      mode === "missing"
        ? undefined
        : {
            record: {
              taskId: "t",
              decisiveRunId: mode === "wrong-run" ? "other" : "r",
              deliveryId: mode === "wrong-delivery" ? "other" : "d",
              delivery: { status: mode === "wrong-status" ? "delivery_unknown" : "delivered" },
              acceptance: { status: "passed" },
            },
          },
    );
    await confirmPendingTurnDeliveryWithPorts(
      { cfg: {}, runId: "r", status: "delivered" },
      {
        resolvePersistRoot: () => "/tmp/unused",
        completeTask: vi.fn(() => ({ persisted: true })),
        bindingCurrent: () => true,
      },
    );
    expect(peekAwaitingDelivery("r")).toBeDefined();
  },
);
