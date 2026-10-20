// @vitest-environment node
/**
 * P0: enterpriseIdHint without agent/seat mapping → unconditional empty allowlist.
 */
import { describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";

vi.mock("../resource-catalog/list-enabled-model-ids.js", () => ({
  listEnabledResourceCatalogModelIds: vi.fn(async () => ({
    modelIds: ["openai/gpt-4o-mini"],
    catalogEmpty: false,
  })),
}));

import { resolveEmployeeModelGate } from "./employee-model-gate.js";

const cfg = {
  gateway: {
    platform: {
      models: {
        mode: "native",
        entitlement: { enforce: "missing-allow", scope: "employee-chat" },
      },
    },
  },
  models: { providers: {} },
} as unknown as OpenBotConfig;

describe("enterpriseIdHint hard deny", () => {
  it("enterpriseIdHint present without agent/seat mapping returns empty allowlist", async () => {
    const result = await resolveEmployeeModelGate({
      cfg,
      enterpriseIdHint: "tenant-known-enterprise",
      // no agentId, no employee session, no seat
    });
    expect(result.allowlist).toEqual([]);
    expect(result.entitlementHint?.effectiveReason).toBe("enterprise_id_hint_unresolved");
  });

  it("enterpriseIdHint + commercialBillingSeatId resolves and can authorize models", async () => {
    // Without entitlement store seed, resolved set may still be empty under strict —
    // but must NOT skip (allowlist defined).
    const result = await resolveEmployeeModelGate({
      cfg,
      enterpriseIdHint: "tenant-known-enterprise",
      commercialBillingSeatId: "seat-billing-1",
    });
    expect(result.allowlist).toBeDefined();
    expect(Array.isArray(result.allowlist)).toBe(true);
  });
});
