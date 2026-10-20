import { isExecutableSkillProjectionEligible } from "../skill-execution-binding/materialize.js";
import {
  getSkillRuntimeDefinitionForBinding,
  listRobotSkillAssets,
  type McpAssetBinding,
} from "../skill-lifecycle-store.js";

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/** Catalog tool ids granted by installed, executable Tool assets. */
export function listInstalledToolAssetGrants(agentId: string): string[] {
  const grants: string[] = [];
  for (const entry of listRobotSkillAssets(agentId)) {
    if (entry.profile.assetType !== "tool") {
      continue;
    }
    if (
      !isExecutableSkillProjectionEligible({
        enabled: entry.enabled,
        lifecycle: entry.lifecycle,
        assetType: entry.profile.assetType,
      })
    ) {
      continue;
    }
    try {
      const bound = getSkillRuntimeDefinitionForBinding(entry.id, {
        version: entry.installedVersion,
      });
      grants.push(
        ...(bound.runtimeDefinition.toolBinding?.toolIds ?? []),
        ...bound.runtimeDefinition.tools,
      );
    } catch {
      // Missing/corrupt binding should not block the rest of the tool catalog.
    }
  }
  return uniqueTrimmed(grants);
}

export function listInstalledMcpAssetBindings(
  agentId: string,
): Array<McpAssetBinding & { skillId: string }> {
  const out: Array<McpAssetBinding & { skillId: string }> = [];
  for (const entry of listRobotSkillAssets(agentId)) {
    if (entry.profile.assetType !== "mcp") {
      continue;
    }
    if (
      !isExecutableSkillProjectionEligible({
        enabled: entry.enabled,
        lifecycle: entry.lifecycle,
        assetType: entry.profile.assetType,
      })
    ) {
      continue;
    }
    try {
      const bound = getSkillRuntimeDefinitionForBinding(entry.id, {
        version: entry.installedVersion,
      });
      const mcpBinding = bound.runtimeDefinition.mcpBinding;
      if (mcpBinding) {
        out.push({ ...mcpBinding, skillId: entry.id });
      }
    } catch {
      // skip
    }
  }
  return out;
}
