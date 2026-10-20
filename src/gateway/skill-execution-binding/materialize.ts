import fs from "node:fs";
import path from "node:path";
import { skillCapabilityTaskLabel } from "../skill-capability-contract.js";
import type {
  AssetType,
  EmployeeSkillProfile,
  SkillLifecycleState,
  SkillRuntimeDefinition,
} from "../skill-lifecycle-store.js";
import { resolveBoundSkillDir, skillExecutionSkillName } from "./paths.js";
import {
  EXECUTABLE_ASSET_TYPES,
  EXECUTABLE_LIFECYCLES,
  NON_EXECUTABLE_LIFECYCLES,
  type SyncSkillExecutionBindingResult,
} from "./types.js";

export type MaterializeSkillInput = {
  agentId: string;
  skillId: string;
  enabled: boolean;
  installedVersion: string;
  /** When set, the materialised skill keeps this SAR digest instead of a catalog head. */
  artifactDigest?: string;
  lifecycle: SkillLifecycleState;
  assetType: AssetType;
  profile: EmployeeSkillProfile;
  runtimeDefinition: SkillRuntimeDefinition;
  /** Optional override for tests / multi-tenant roots. */
  configDir?: string;
};

export function isExecutableSkillProjectionEligible(params: {
  enabled: boolean;
  lifecycle: SkillLifecycleState;
  assetType: AssetType;
}): boolean {
  if (!params.enabled) {
    return false;
  }
  // Explicit allow-list: draft / rejected / retired must not inject prompts.
  // reviewing is allowed — owner-initiated install is the gate, not enterprise review.
  if (
    !EXECUTABLE_LIFECYCLES.has(params.lifecycle) ||
    NON_EXECUTABLE_LIFECYCLES.has(params.lifecycle)
  ) {
    return false;
  }
  // Knowledge deliverables are outcomes, not executable skills.
  if (!EXECUTABLE_ASSET_TYPES.has(params.assetType)) {
    return false;
  }
  return true;
}

/** Render a pi-compatible SKILL.md from lifecycle profile + runtime definition. */
export function renderSkillMarkdown(params: {
  skillId: string;
  installedVersion: string;
  artifactDigest?: string;
  profile: EmployeeSkillProfile;
  runtimeDefinition: SkillRuntimeDefinition;
}): string {
  const skillName = skillExecutionSkillName(params.skillId);
  const description = yamlEscape(
    params.profile.summary?.trim() || params.profile.name?.trim() || skillName,
  );
  const displayName = params.profile.name?.trim() || skillName;
  const prompts = params.runtimeDefinition.prompts.filter(Boolean);
  const tools = params.runtimeDefinition.tools.filter(Boolean);
  const bodySections: string[] = [
    `# ${displayName}`,
    "",
    params.profile.summary?.trim() || "Lifecycle skill projected for agent execution.",
    "",
  ];

  if (params.profile.inputDescription?.trim()) {
    bodySections.push("## Input", "", params.profile.inputDescription.trim(), "");
  }
  if (params.profile.outputDescription?.trim()) {
    bodySections.push("## Output", "", params.profile.outputDescription.trim(), "");
  }
  if (params.profile.usageExamples.length > 0) {
    bodySections.push("## Usage examples", "");
    for (const example of params.profile.usageExamples) {
      bodySections.push(`- ${example}`);
    }
    bodySections.push("");
  }
  const verbs = params.runtimeDefinition.capabilities.filter(Boolean);
  if (verbs.length > 0) {
    bodySections.push("## Tasks this skill can do", "");
    for (const verb of verbs) {
      bodySections.push(`- ${skillCapabilityTaskLabel(verb)}`);
    }
    bodySections.push("");
  }
  if (prompts.length > 0) {
    bodySections.push("## Instructions", "");
    for (const prompt of prompts) {
      bodySections.push(prompt, "");
    }
  }
  if (tools.length > 0) {
    bodySections.push("## Tools", "");
    bodySections.push(
      `Prefer identity-bound tools named \`ob_sk_<skillId>__<tool>\` for this skill, or pass \`openbotSkillId: ${params.skillId}\` on the base tool.`,
      "",
    );
    for (const tool of tools) {
      const identity = `ob_sk_${params.skillId.replace(/[^a-zA-Z0-9_]/g, "_")}__${tool
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")}`;
      bodySections.push(
        `- \`${identity}\` (preferred) or \`${tool}\` with openbotSkillId: ${params.skillId}`,
      );
    }
    bodySections.push("");
  }
  const mcpBinding = params.runtimeDefinition.mcpBinding;
  if (mcpBinding) {
    bodySections.push("## MCP", "");
    bodySections.push(
      `Call this server through mcporter after install. Config is written to \`~/.openbot/mcp-asset-bindings/mcporter.json\`.`,
      "",
    );
    bodySections.push(`- Server: \`${mcpBinding.serverName}\``);
    if (mcpBinding.command) {
      bodySections.push(
        `- Stdio: \`${[mcpBinding.command, ...(mcpBinding.args ?? [])].join(" ")}\``,
      );
    }
    if (mcpBinding.url) {
      bodySections.push(`- HTTP: \`${mcpBinding.url}\``);
    }
    const allowlist = mcpBinding.toolAllowlist ?? [];
    if (allowlist.length > 0) {
      bodySections.push("- Tools:");
      for (const tool of allowlist) {
        bodySections.push(`  - \`mcporter call ${mcpBinding.serverName}.${tool}\``);
      }
    } else {
      bodySections.push(`- List tools: \`mcporter list ${mcpBinding.serverName} --schema\``);
      bodySections.push(`- Call: \`mcporter call ${mcpBinding.serverName}.<tool> key=value\``);
    }
    bodySections.push("");
  }
  if (params.runtimeDefinition.workflow != null) {
    bodySections.push(
      "## Workflow",
      "",
      "```json",
      JSON.stringify(params.runtimeDefinition.workflow, null, 2),
      "```",
      "",
    );
  }

  const frontmatter = [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "metadata:",
    `  openbot.skillId: ${JSON.stringify(params.skillId)}`,
    `  openbot.skillVersion: ${JSON.stringify(params.installedVersion)}`,
    ...(params.artifactDigest?.trim()
      ? [`  openbot.artifactDigest: ${JSON.stringify(params.artifactDigest.trim())}`]
      : []),
    `  openbot.assetType: ${JSON.stringify(params.profile.assetType)}`,
    "  openbot.source: skill-lifecycle",
    "---",
    "",
  ].join("\n");

  return `${frontmatter}${bodySections.join("\n").trimEnd()}\n`;
}

export function materializeSkillExecutionBinding(
  input: MaterializeSkillInput,
): SyncSkillExecutionBindingResult {
  const skillDir = resolveBoundSkillDir(input.agentId, input.skillId, input.configDir);
  const skillFile = path.join(skillDir, "SKILL.md");
  const skillName = skillExecutionSkillName(input.skillId);

  if (
    !isExecutableSkillProjectionEligible({
      enabled: input.enabled,
      lifecycle: input.lifecycle,
      assetType: input.assetType,
    })
  ) {
    removeMaterialisedDir(skillDir);
    return {
      action: "removed",
      reason: !input.enabled
        ? "disabled"
        : NON_EXECUTABLE_LIFECYCLES.has(input.lifecycle)
          ? "non-executable-lifecycle"
          : "non-executable-asset-type",
      skillName,
    };
  }

  fs.mkdirSync(skillDir, { recursive: true });
  const markdown = renderSkillMarkdown({
    skillId: input.skillId,
    installedVersion: input.installedVersion,
    artifactDigest: input.artifactDigest,
    profile: input.profile,
    runtimeDefinition: input.runtimeDefinition,
  });
  fs.writeFileSync(skillFile, markdown, "utf8");
  return {
    action: "materialised",
    skillName,
    materialisedPath: skillFile,
  };
}

export function removeSkillExecutionBindingFiles(params: {
  agentId: string;
  skillId: string;
  configDir?: string;
}): SyncSkillExecutionBindingResult {
  const skillDir = resolveBoundSkillDir(params.agentId, params.skillId, params.configDir);
  const skillName = skillExecutionSkillName(params.skillId);
  removeMaterialisedDir(skillDir);
  return { action: "removed", reason: "explicit-remove", skillName };
}

function removeMaterialisedDir(skillDir: string): void {
  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function yamlEscape(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim().slice(0, 200);
  if (compact === "") {
    return '""';
  }
  if (/[:#{}[\],&*?|>!%@`]/.test(compact) || compact.includes('"')) {
    return JSON.stringify(compact);
  }
  return compact;
}
