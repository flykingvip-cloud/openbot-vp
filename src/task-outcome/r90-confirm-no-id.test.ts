/**
 * askOutcome P1 / PR90-B: confirmPendingTurnDelivery with no locator ids —
 * diagnose only; do not confirm; do not clear pending.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import * as globals from "../globals.js";
import {
  clearAwaitingDeliveriesForTests,
  peekAwaitingDelivery,
  registerAwaitingDelivery,
} from "./pending-delivery.js";

const confirmSpy = vi.hoisted(() => vi.fn());

vi.mock("./runtime-from-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime-from-runner.js")>();
  return {
    ...actual,
    confirmRunnerTurnDelivery: confirmSpy,
  };
});

import { confirmPendingTurnDelivery } from "../auto-reply/reply/dispatch-from-config.js";

describe("R90 confirm-no-id: three locator ids absent", () => {
  const cfg = {} as OpenBotConfig;

  beforeEach(() => {
    clearAwaitingDeliveriesForTests();
    confirmSpy.mockReset();
    confirmSpy.mockResolvedValue(undefined);
    globals.setVerbose(true);
  });

  afterEach(() => {
    clearAwaitingDeliveriesForTests();
    globals.setVerbose(false);
    vi.restoreAllMocks();
  });

  it("logs confirm_skipped_no_locator_ids, does not call confirm, leaves pending intact", async () => {
    registerAwaitingDelivery({
      runId: "run-r90-pending",
      taskId: "task-r90-pending",
      deliveryId: "delivery:r90-pending",
      agentId: "bot",
    });
    const before = peekAwaitingDelivery({ runId: "run-r90-pending" });
    expect(before?.deliveryId).toBe("delivery:r90-pending");

    const logSpy = vi.spyOn(globals, "logVerbose");

    await expect(
      confirmPendingTurnDelivery({
        cfg,
        status: "delivered",
        // intentionally omit runId / deliveryId / taskId
      }),
    ).resolves.toBeUndefined();

    expect(confirmSpy).not.toHaveBeenCalled();
    const after = peekAwaitingDelivery({ runId: "run-r90-pending" });
    expect(after).toEqual(before);

    const diagnostic = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(diagnostic).toContain("event=confirm_skipped_no_locator_ids");
    expect(diagnostic).toContain("source=confirmPendingTurnDelivery");
    expect(diagnostic).toContain("hasRunId=0");
    expect(diagnostic).toContain("hasDeliveryId=0");
    expect(diagnostic).toContain("hasTaskId=0");
    expect(diagnostic).toContain("persistScopeResolvable=0");
    // Must not leak raw sessionKey or filesystem paths.
    expect(diagnostic).not.toMatch(/sessionKey=/);
    expect(diagnostic).not.toMatch(/persistRoot=/);
    expect(diagnostic).not.toMatch(/\/Users\//);
  });

  it("with deliveryId only still confirms (no false skip)", async () => {
    registerAwaitingDelivery({
      runId: "run-r90-ok",
      taskId: "task-r90-ok",
      deliveryId: "delivery:r90-ok",
      agentId: "bot",
    });
    await confirmPendingTurnDelivery({
      cfg,
      deliveryId: "delivery:r90-ok",
      status: "delivered",
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});
