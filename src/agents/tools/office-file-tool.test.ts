import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_ALLOW } from "../sandbox/constants.js";
import { resolveToolProfilePolicy } from "../tool-policy.js";
import { createOfficeFileTool } from "./office-file-tool.js";

describe("office_file tool", () => {
  it("is available to coding and messaging profiles and the sandbox allowlist", () => {
    expect(resolveToolProfilePolicy("coding")?.allow).toContain("office_file");
    expect(resolveToolProfilePolicy("messaging")?.allow).toContain("office_file");
    expect(DEFAULT_TOOL_ALLOW).toContain("office_file");
  });

  it("reports Excel live as disconnected and does not require a desktop app", async () => {
    const tool = createOfficeFileTool({
      workspaceDir: path.join(os.tmpdir(), "office-file-tool"),
      tenantId: null,
      userId: "person-1",
    });
    const result = await tool.execute("call-1", { action: "excel_live", liveOp: "edit" });
    const payload = result.details as { ok: boolean; status: string; message: string };
    expect(payload.ok).toBe(false);
    expect(payload.status).toBe("未接入");
    expect(payload.message).toContain("未接入");
  });
});
