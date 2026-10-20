/**
 * Materialize registry skills as local skill assets and install them onto a robot.
 * Used by agents.create (starter + template) and enterprise pack bulk install.
 */

import type { OpenBotConfig } from "../../config/types.openbot.js";
import {
  findRegistryEntryBySkillKey,
  getRegistryEntry,
  listRegistry,
  type GovernanceRegistryEntry,
} from "../capability-governance-store.js";
import { syncInstallToRuntime } from "../runtime-binding-sync.js";
import {
  getPersonalSkillAssetDetail,
  installSkillToRobotAsset,
  saveSkillAsset,
} from "../skill-lifecycle-store.js";
import {
  PACK_STARTER,
  getPackById,
  skillKeysForPackIds,
  type CapabilityPackId,
} from "./starter-packs.js";
import { resolveEntitledSkillKeys } from "./tenant-pack-entitlements.js";

export type InstallSkillResult = {
  skillKey: string;
  ok: boolean;
  localSkillId?: string;
  reason?: string;
};

/** Template → official skillKeys to auto-install beyond starter. */
export const TEMPLATE_AUTO_SKILL_KEYS: Record<string, string[]> = {
  generic_worker: [],
  sales_assistant: [
    "sales-coach",
    "sales-engineer",
    "feishu-integration",
    "customer-service",
    "wechat-official-account",
  ],
  contract_reviewer: ["meeting-notes-specialist", "product-manager", "summarize", "nano-pdf"],
  personal_mail_assistant: ["personal-mail-assistant"],
};

function registryEntryForKey(skillKeyOrId: string): GovernanceRegistryEntry | null {
  return getRegistryEntry(skillKeyOrId) ?? findRegistryEntryBySkillKey(skillKeyOrId);
}

function localSkillIdForEntry(entry: GovernanceRegistryEntry, fallback: string): string {
  return entry.manifest.skillKey?.trim() || fallback;
}

function ensureLocalAsset(params: {
  entry: GovernanceRegistryEntry;
  agentId: string;
  localSkillId: string;
}): void {
  try {
    getPersonalSkillAssetDetail(params.localSkillId);
    return;
  } catch {
    // materialize
  }
  saveSkillAsset({
    skillId: params.localSkillId,
    sourceAgentId: params.agentId,
    contextId: `pack-install:${params.entry.manifest.id}`,
    lifecycle: "published",
    profile: {
      name: params.entry.manifest.name,
      summary: params.entry.manifest.descriptionZh ?? params.entry.manifest.description,
      assetType: "capability",
      usageExamples: ["平台/企业能力包自动安装"],
      inputDescription: "按能力说明输入业务素材",
      outputDescription: "输出结构化处理结果",
      tags: [
        "能力包",
        typeof params.entry.manifest.packId === "string" && params.entry.manifest.packId.trim()
          ? params.entry.manifest.packId.trim()
          : "官方",
      ].filter(Boolean),
      category:
        typeof params.entry.manifest.categoryId === "string"
          ? params.entry.manifest.categoryId
          : "企业能力",
      visibility: "enterprise",
    },
    enterpriseConsumers: [
      {
        consumerId: params.entry.manifest.id,
        name: "能力包安装",
        type: "pack-install",
      },
    ],
  });
}

/** Install a single registry skill onto a robot (best-effort). */
export function installRegistrySkillOntoRobot(params: {
  agentId: string;
  skillKeyOrId: string;
}): InstallSkillResult {
  const entry = registryEntryForKey(params.skillKeyOrId);
  if (!entry || entry.lifecycleState === "retired" || entry.lifecycleState === "deprecated") {
    return {
      skillKey: params.skillKeyOrId,
      ok: false,
      reason: "registry entry missing or inactive",
    };
  }
  const skillKey = entry.manifest.skillKey || params.skillKeyOrId;
  try {
    const localSkillId = localSkillIdForEntry(entry, skillKey);
    ensureLocalAsset({ entry, agentId: params.agentId, localSkillId });
    installSkillToRobotAsset({ agentId: params.agentId, skillId: localSkillId });
    return { skillKey, ok: true, localSkillId };
  } catch (err) {
    return {
      skillKey,
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Resolve which skillKeys should be auto-installed on agent create.
 * - Always includes starter pack keys (if entitled / no tenant filter fails open to starter)
 * - Adds template-specific keys
 * - Intersects with tenant entitlement when tenantId provided
 * - Optionally merges extraKeys (e.g. position-granted capabilities)
 */
export function resolveAutoInstallSkillKeys(params: {
  tenantId?: string | null;
  templateId?: string | null;
  extraSkillKeys?: string[];
  /** When true (default), always attempt starter pack. */
  includeStarter?: boolean;
}): string[] {
  const keys = new Set<string>();
  if (params.includeStarter !== false) {
    for (const skill of PACK_STARTER.skills) {
      keys.add(skill.skillKey);
    }
  }
  const templateId = params.templateId?.trim() || "generic_worker";
  for (const key of TEMPLATE_AUTO_SKILL_KEYS[templateId] ?? []) {
    keys.add(key);
  }
  for (const key of params.extraSkillKeys ?? []) {
    if (key.trim()) {
      keys.add(key.trim());
    }
  }

  const tenantId = params.tenantId?.trim();
  if (tenantId) {
    const entitled = resolveEntitledSkillKeys(tenantId);
    return [...keys].filter((key) => entitled.has(key));
  }
  return [...keys];
}

/** Install many skillKeys onto a robot; continues on individual failures. */
export async function installSkillKeysOntoRobot(params: {
  agentId: string;
  skillKeys: string[];
  userEmail?: string | null;
  cfg?: OpenBotConfig;
}): Promise<{ installed: InstallSkillResult[]; failed: InstallSkillResult[] }> {
  const installed: InstallSkillResult[] = [];
  const failed: InstallSkillResult[] = [];
  for (const skillKey of params.skillKeys) {
    const result = installRegistrySkillOntoRobot({
      agentId: params.agentId,
      skillKeyOrId: skillKey,
    });
    if (result.ok) {
      installed.push(result);
      if (params.userEmail && params.cfg) {
        try {
          await syncInstallToRuntime({
            cfg: params.cfg,
            userEmail: params.userEmail,
            capabilityId: result.localSkillId || skillKey,
          });
        } catch {
          // best-effort runtime sync
        }
      }
    } else {
      failed.push(result);
    }
  }
  return { installed, failed };
}

/**
 * Full create-time install: starter + template (+ extras), entitlement-aware.
 */
export async function autoInstallCapabilitiesOnAgentCreate(params: {
  agentId: string;
  tenantId?: string | null;
  templateId?: string | null;
  extraSkillKeys?: string[];
  userEmail?: string | null;
  cfg?: OpenBotConfig;
}): Promise<{
  skillKeys: string[];
  installed: InstallSkillResult[];
  failed: InstallSkillResult[];
}> {
  const skillKeys = resolveAutoInstallSkillKeys({
    tenantId: params.tenantId,
    templateId: params.templateId,
    extraSkillKeys: params.extraSkillKeys,
  });
  const result = await installSkillKeysOntoRobot({
    agentId: params.agentId,
    skillKeys,
    userEmail: params.userEmail,
    cfg: params.cfg,
  });
  return { skillKeys, ...result };
}

/** All skillKeys for one or more packs (no entitlement filter). */
export function skillKeysForPacks(packIds: CapabilityPackId[]): string[] {
  return [...skillKeysForPackIds(packIds)];
}

/**
 * Resolve registry entries for a pack (active only).
 */
export function listActiveRegistryEntriesForPack(
  packId: CapabilityPackId,
): GovernanceRegistryEntry[] {
  const pack = getPackById(packId);
  if (!pack) {
    return [];
  }
  const keys = new Set(pack.skills.map((s) => s.skillKey));
  return listRegistry().filter(
    (entry) =>
      entry.lifecycleState === "active" &&
      entry.manifest.skillKey &&
      keys.has(entry.manifest.skillKey),
  );
}
