import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("createOpenClawTools office file registration", () => {
  it("registers office_file for a signed-in session", () => {
    const tools = createOpenClawTools({
      gatewayClientPlatformUserId: "user-1",
      workspaceDir: "/tmp/office-file-workspace",
    });
    const tool = tools.find((candidate) => candidate.name === "office_file");
    expect(tool?.description).toContain("DOCX");
    expect(tool?.description).toContain("未接入");
  });
});
