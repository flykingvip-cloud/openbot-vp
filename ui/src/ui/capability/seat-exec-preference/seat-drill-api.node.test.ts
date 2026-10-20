import { describe, expect, it, vi } from "vitest";
import { runSeatDrill } from "./seat-drill-api.ts";

describe("seat-drill-api", () => {
  it("returns null when drill fails", async () => {
    const client = { request: vi.fn().mockRejectedValue(new Error("no seat")) };
    await expect(runSeatDrill(client as never)).resolves.toBeNull();
  });

  it("calls seat-rules.drill and returns payload", async () => {
    const payload = {
      tenantId: "t",
      seatId: "s",
      command: "echo seat-policy-drill",
      ceiling: { ask: "on-miss", security: "allowlist", host: "gateway" },
      effective: { ask: "always", security: "allowlist" },
      outcome: "deny",
      decision: "DENY",
      reason: "exec_approval_unresolved",
      matchedRules: [],
      relaxation: false,
      wouldRequireApprovalIfExecuted: true,
      preAuthorization: false,
      persisted: false,
      note: "演练只裁决",
    };
    const client = { request: vi.fn().mockResolvedValue(payload) };
    await expect(runSeatDrill(client as never, { command: "echo x" })).resolves.toEqual(payload);
    expect(client.request).toHaveBeenCalledWith("seat-rules.drill", { command: "echo x" });
  });
});
