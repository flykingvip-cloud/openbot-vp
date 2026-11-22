/**
 * Execute-time recheck for chat.send coding-tool writes.
 *
 * Authority is resolved from the live membership store, not from the tool-list
 * policy snapshot or the start-of-turn tenant bind alone. Read-only tools are
 * left unchanged. Already-issued unknown write outcomes are not recoded here.
 */
import { canonicalizeTenantId } from "../gateway/tenant-canonicalization.js";
import { resolveCoreToolCapability, resolveCoreToolCatalogId } from "./tool-catalog.js";
import { ToolAuthorizationError, type AnyAgentTool } from "./tools/common.js";

export const AUTHORITY_REVOKED_REASON = "authority_revoked" as const;

export type AuthoritativeWriteRecheck = {
  isAuthorityStillGranted: () => boolean | Promise<boolean>;
};

export function isExternalWriteTool(toolName: string): boolean {
  const catalogId = resolveCoreToolCatalogId(toolName);
  const capability = resolveCoreToolCapability(catalogId);
  return capability?.sideEffectLevel !== "none";
}

export async function isBoundTenantAuthorityStillGranted(params: {
  boundEnterpriseId: string;
  resolveAuthority: () => Promise<{ tenantId: string | null }>;
}): Promise<boolean> {
  const bound = canonicalizeTenantId(params.boundEnterpriseId);
  if (!bound) {
    return false;
  }
  const { tenantId } = await params.resolveAuthority();
  return canonicalizeTenantId(tenantId) === bound;
}

export function wrapToolWithAuthoritativeWriteRecheck(
  tool: AnyAgentTool,
  recheck?: AuthoritativeWriteRecheck | null,
): AnyAgentTool {
  if (!recheck?.isAuthorityStillGranted || !tool.execute) {
    return tool;
  }
  const execute = tool.execute.bind(tool);
  const writeSide = isExternalWriteTool(tool.name);
  return {
    ...tool,
    execute: async (toolCallId, toolParams, signal, onUpdate) => {
      if (writeSide) {
        const granted = await recheck.isAuthorityStillGranted();
        if (!granted) {
          throw new ToolAuthorizationError(`Tool execution denied (${AUTHORITY_REVOKED_REASON}).`);
        }
      }
      return execute(toolCallId, toolParams, signal, onUpdate);
    },
  };
}
