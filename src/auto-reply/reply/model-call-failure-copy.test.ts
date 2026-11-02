import { describe, expect, it } from "vitest";
import { buildUserFacingModelCallFailure } from "./model-call-failure-copy.js";

describe("buildUserFacingModelCallFailure", () => {
  it("hides an enterprise runtime id", () => {
    const text = buildUserFacingModelCallFailure("Unknown model: ent/cc41dd5419/mimo-v2.6-flash");
    expect(text).toContain("已配置的模型");
    expect(text).not.toContain("ent/");
    expect(text).not.toContain("cc41dd5419");
    expect(text).not.toContain("mimo-v2.6-flash");
    expect(text).not.toMatch(/unknown model/i);
  });

  it("uses English when the turn language is en", () => {
    const text = buildUserFacingModelCallFailure(
      "Enterprise BYOK model selected but managed tenantId could not be resolved",
      "en",
    );
    expect(text).toContain("configured model");
    expect(text).not.toContain("tenantId");
  });

  it("leaves unrelated failures to the caller", () => {
    expect(buildUserFacingModelCallFailure("socket hang up")).toBeNull();
  });
});
