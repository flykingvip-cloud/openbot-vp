/**
 * MCP 映射引导 — 草稿校验（纯函数）。
 * 打开/预填不算提交；仅显式 Save 才应调用写 API。
 */

export type McpMappingWizardDraft = {
  mcpServer: string;
  mcpTool: string;
  capabilityKey: string;
  displayName: string;
  description: string;
  handlerRef: string;
};

export type McpMappingWizardValidation = {
  ok: boolean;
  message: string | null;
};

export function validateMcpMappingWizardDraft(
  draft: McpMappingWizardDraft,
): McpMappingWizardValidation {
  if (!draft.mcpServer.trim() || !draft.mcpTool.trim()) {
    return { ok: false, message: "缺少 MCP 服务或工具名，无法完成映射。" };
  }
  if (!draft.handlerRef.trim().startsWith("mcp://")) {
    return { ok: false, message: "处理器引用必须是 mcp://服务/工具。" };
  }
  if (!draft.capabilityKey.trim() || !draft.displayName.trim()) {
    return { ok: false, message: "请填写能力标识与显示名称。" };
  }
  return { ok: true, message: null };
}

export function createEmptyMcpMappingWizardDraft(): McpMappingWizardDraft {
  return {
    mcpServer: "",
    mcpTool: "",
    capabilityKey: "",
    displayName: "",
    description: "",
    handlerRef: "",
  };
}
