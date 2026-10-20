import { describe, expect, it } from "vitest";
import { previewPlanAllocation } from "./plan-allocation-preview.js";

describe("previewPlanAllocation", () => {
  it("returns null for empty planVersionId", async () => {
    expect(await previewPlanAllocation("")).toBeNull();
  });
});
