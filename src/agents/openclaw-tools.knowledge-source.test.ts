import { describe, expect, it } from "vitest";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("createOpenClawTools knowledge source registration", () => {
  it("registers the controlled knowledge_source tool", () => {
    const tool = createOpenClawTools({ gatewayClientUser: "user@example.com" }).find(
      (candidate) => candidate.name === "knowledge_source",
    );

    expect(tool?.description).toContain("API-backed active knowledge sources");
    expect(tool?.description).toContain("Never accepts a plaintext credential");
  });
});
