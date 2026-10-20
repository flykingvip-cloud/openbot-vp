/**
 * Identity-bound tools for lifecycle skills + unique-owner openbotSkillId injection.
 * Must mirror SkillExecutionBinding materialisation gates (lifecycle + runtime pause).
 */

import type { AnyAgentTool } from "../../agents/tools/common.js";
import { listBindings } from "../agent-runtime-store.js";
import {
  getAgentPauseRecord,
  getAgentRedirectRecord,
} from "../evolution-governance/runtime-actions.js";
import { isRecord } from "../records.js";
import {
  getSkillRuntimeDefinitionForBinding,
  listRobotSkillAssets,
  type RobotSkillEntry,
} from "../skill-lifecycle-store.js";
import { isExecutableSkillProjectionEligible } from "./materialize.js";
import { skillExecutionSkillName } from "./paths.js";

export const SKILL_IDENTITY_TOOL_PREFIX = "ob_sk_";

/** Sentinel: agent-level governance pause/redirect — suppress all identity tools. */
const AGENT_TOOLS_SUPPRESSED = "*";

export function buildSkillIdentityToolName(skillId: string, baseTool: string): string {
  const safeSkill = skillId.replace(/[^a-zA-Z0-9_]/g, "_");
  const safeTool = baseTool
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  return `${SKILL_IDENTITY_TOOL_PREFIX}${safeSkill}__${safeTool}`;
}

export function parseSkillIdentityToolName(
  toolName: string,
): { skillId: string; baseTool: string } | null {
  const name = toolName.trim();
  if (!name.startsWith(SKILL_IDENTITY_TOOL_PREFIX)) {
    return null;
  }
  const rest = name.slice(SKILL_IDENTITY_TOOL_PREFIX.length);
  const sep = rest.lastIndexOf("__");
  if (sep <= 0 || sep >= rest.length - 2) {
    return null;
  }
  const skillId = rest.slice(0, sep);
  const baseTool = rest.slice(sep + 2);
  if (!skillId || !baseTool) {
    return null;
  }
  return { skillId, baseTool };
}

function injectSkillId(args: unknown, skillId: string): unknown {
  if (!isRecord(args)) {
    return { openbotSkillId: skillId };
  }
  if (typeof args.openbotSkillId === "string" && args.openbotSkillId.trim()) {
    return args;
  }
  return { ...args, openbotSkillId: skillId };
}

/**
 * Skills whose identity tools must not appear:
 * - capability bindings disabled for this agent (capabilityId or ob-asset name)
 * - agent under governance pause / redirect (all skills suppressed)
 */
function resolvePausedSkillIds(agentId: string): Set<string> {
  const out = new Set<string>();
  try {
    const pause = getAgentPauseRecord(agentId);
    if (pause?.disabledByThisAction?.length) {
      out.add(AGENT_TOOLS_SUPPRESSED);
    }
  } catch {
    // optional
  }
  try {
    const redirect = getAgentRedirectRecord(agentId);
    if (redirect?.targetAgentId) {
      out.add(AGENT_TOOLS_SUPPRESSED);
    }
  } catch {
    // optional
  }
  try {
    const paused = listBindings({
      runtimeAgentId: agentId,
      capabilityId: null,
      bindingType: null,
      bindingState: "disabled",
      health: null,
    });
    for (const b of paused) {
      const cap = b.capabilityId?.trim();
      if (!cap) {
        continue;
      }
      out.add(cap);
      // Align with SKILL.md sync: capabilityId → lifecycle skill name
      out.add(skillExecutionSkillName(cap));
    }
  } catch {
    // optional
  }
  return out;
}

/**
 * Same eligibility as SKILL.md materialisation + installed version resolvable
 * + not under agent-runtime disabled binding / governance pause.
 */
export function isLifecycleSkillToolEligible(params: {
  entry: RobotSkillEntry;
  agentId: string;
  pausedSkillIds?: Set<string>;
}): boolean {
  const { entry, agentId } = params;
  // Relation toggle / install gate
  if (!entry.enabled) {
    return false;
  }
  // Lifecycle allow-list (blocks draft/rejected/retired; reviewing may run after install)
  if (
    !isExecutableSkillProjectionEligible({
      enabled: entry.enabled,
      lifecycle: entry.lifecycle,
      assetType: entry.profile?.assetType ?? "capability",
    })
  ) {
    return false;
  }
  const paused = params.pausedSkillIds ?? resolvePausedSkillIds(agentId);
  if (
    paused.has(AGENT_TOOLS_SUPPRESSED) ||
    paused.has(entry.id) ||
    paused.has(skillExecutionSkillName(entry.id))
  ) {
    return false;
  }
  // installedVersion must resolve to an executable runtime definition
  try {
    getSkillRuntimeDefinitionForBinding(entry.id, {
      version: entry.installedVersion,
    });
  } catch {
    return false;
  }
  return true;
}

export function createLifecycleSkillIdentityTools(params: {
  baseTools: AnyAgentTool[];
  agentId: string;
}): AnyAgentTool[] {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return [];
  }
  const byName = new Map(
    params.baseTools.map((tool) => [tool.name.trim().toLowerCase(), tool] as const),
  );
  const out: AnyAgentTool[] = [];
  const seen = new Set<string>();
  const pausedSkillIds = resolvePausedSkillIds(agentId);

  for (const entry of listRobotSkillAssets(agentId)) {
    if (!isLifecycleSkillToolEligible({ entry, agentId, pausedSkillIds })) {
      continue;
    }
    let declared: string[] = [];
    try {
      declared = getSkillRuntimeDefinitionForBinding(entry.id, {
        version: entry.installedVersion,
      })
        .runtimeDefinition.tools.map((t) => t.trim())
        .filter(Boolean);
    } catch {
      continue;
    }
    for (const toolName of declared) {
      const base = byName.get(toolName.toLowerCase());
      if (!base || typeof base.execute !== "function") {
        continue;
      }
      const identityName = buildSkillIdentityToolName(entry.id, toolName);
      if (seen.has(identityName)) {
        continue;
      }
      seen.add(identityName);
      const skillId = entry.id;
      const display = entry.profile?.name?.trim() || skillId;
      out.push({
        ...base,
        name: identityName,
        description: [
          base.description?.trim() || toolName,
          `[Lifecycle skill: ${display}; skillId=${skillId}. Prefer this tool when executing that skill.]`,
        ].join(" "),
        execute: async (toolCallId, args, signal, onUpdate) => {
          return base.execute(toolCallId, injectSkillId(args, skillId), signal, onUpdate);
        },
      } as AnyAgentTool);
    }
  }
  return out;
}

export function wrapToolsWithUniqueOwnerSkillInjection(params: {
  tools: AnyAgentTool[];
  agentId: string;
}): AnyAgentTool[] {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return params.tools;
  }

  const pausedSkillIds = resolvePausedSkillIds(agentId);
  const ownersByTool = new Map<string, string[]>();
  for (const entry of listRobotSkillAssets(agentId)) {
    if (!isLifecycleSkillToolEligible({ entry, agentId, pausedSkillIds })) {
      continue;
    }
    let declared: string[] = [];
    try {
      declared = getSkillRuntimeDefinitionForBinding(entry.id, {
        version: entry.installedVersion,
      })
        .runtimeDefinition.tools.map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    } catch {
      continue;
    }
    for (const tool of declared) {
      const list = ownersByTool.get(tool) ?? [];
      list.push(entry.id);
      ownersByTool.set(tool, list);
    }
  }

  return params.tools.map((tool) => {
    const key = tool.name.trim().toLowerCase();
    if (key.startsWith(SKILL_IDENTITY_TOOL_PREFIX)) {
      return tool;
    }
    const owners = ownersByTool.get(key) ?? [];
    if (owners.length !== 1 || typeof tool.execute !== "function") {
      return tool;
    }
    const skillId = owners[0];
    return {
      ...tool,
      execute: async (toolCallId, args, signal, onUpdate) => {
        return tool.execute(toolCallId, injectSkillId(args, skillId), signal, onUpdate);
      },
    } as AnyAgentTool;
  });
}
