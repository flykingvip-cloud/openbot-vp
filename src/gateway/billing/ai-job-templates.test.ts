// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  getAiJobTemplate,
  isSeatEntitlementProfileUpgrade,
  parseAiJobTemplateId,
} from "./ai-job-templates.js";

describe("ai-job-templates", () => {
  it("maps job templates to entitlement profiles", () => {
    expect(getAiJobTemplate("sales_ai")?.profileId).toBe("pro_ai");
    expect(getAiJobTemplate("executive_ai")?.profileId).toBe("premier_ai");
    expect(parseAiJobTemplateId("support_ai")).toBe("support_ai");
    expect(parseAiJobTemplateId("invalid")).toBeNull();
  });

  it("detects profile upgrades", () => {
    expect(isSeatEntitlementProfileUpgrade("basic_ai", "pro_ai")).toBe(true);
    expect(isSeatEntitlementProfileUpgrade("pro_ai", "elite_ai")).toBe(true);
    expect(isSeatEntitlementProfileUpgrade("elite_ai", "premier_ai")).toBe(true);
    expect(isSeatEntitlementProfileUpgrade("premier_ai", "elite_ai")).toBe(false);
    expect(isSeatEntitlementProfileUpgrade("elite_ai", "pro_ai")).toBe(false);
    expect(isSeatEntitlementProfileUpgrade("pro_ai", "pro_ai")).toBe(false);
  });
});
