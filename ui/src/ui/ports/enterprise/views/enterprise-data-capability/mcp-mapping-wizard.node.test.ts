import { describe, expect, it, vi } from "vitest";
import {
  createEmptyMcpMappingWizardDraft,
  validateMcpMappingWizardDraft,
} from "./mcp-mapping-wizard.ts";

describe("mcp-mapping-wizard", () => {
  it("accepts a complete prefilled draft", () => {
    expect(
      validateMcpMappingWizardDraft({
        mcpServer: "linear",
        mcpTool: "list_issues",
        capabilityKey: "linear.list_issues",
        displayName: "list_issues",
        description: "来自 MCP 发现",
        handlerRef: "mcp://linear/list_issues",
      }),
    ).toEqual({ ok: true, message: null });
  });

  it("rejects incomplete drafts so cancel/open never look like a valid submit", () => {
    expect(validateMcpMappingWizardDraft(createEmptyMcpMappingWizardDraft()).ok).toBe(false);
    expect(
      validateMcpMappingWizardDraft({
        ...createEmptyMcpMappingWizardDraft(),
        mcpServer: "linear",
        mcpTool: "list_issues",
        capabilityKey: "k",
        displayName: "n",
        handlerRef: "http://not-mcp",
      }).message,
    ).toMatch(/mcp:\/\//);
  });

  it("documents that validation alone does not write", () => {
    const write = vi.fn();
    const draft = validateMcpMappingWizardDraft({
      mcpServer: "linear",
      mcpTool: "list_issues",
      capabilityKey: "linear.list_issues",
      displayName: "list_issues",
      description: "",
      handlerRef: "mcp://linear/list_issues",
    });
    expect(draft.ok).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });
});
