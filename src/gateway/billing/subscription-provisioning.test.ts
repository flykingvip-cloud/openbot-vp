import { describe, expect, it } from "vitest";
import { provisionEnterpriseSubscription } from "./subscription-provisioning.js";

describe("provisionEnterpriseSubscription", () => {
  it("exports provisioning orchestrator", () => {
    expect(typeof provisionEnterpriseSubscription).toBe("function");
  });
});
