/**
 * robot.workspace.* — Employee My Bots command surface (Phase 2).
 *
 * Strong Separation: employee create/cultivate path only.
 * Spec: docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md §7.2
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import { loadAgentIdentityFromWorkspace } from "../../agents/identity-file.js";
import { DEFAULT_IDENTITY_FILENAME } from "../../agents/workspace.js";
import { applyAgentConfig, listAgentEntries } from "../../commands/agents.config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { listAgentMemoryEntries } from "../../data/memory-list.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { buildGrowthDossierProjection } from "../agent-growth/dossier.js";
import { syncRobotGrowthFromOperationalMetrics } from "../agent-growth/operational-growth.js";
import { buildRobotGrowthStatusPayload } from "../agent-growth/recommendation.js";
import { recordRobotGrowthMilestone } from "../agent-growth/record-robot-milestone.js";
import { readRobotGrowthStatus } from "../agent-growth/store.js";
import type { GrowthStatus } from "../agent-growth/types.js";
import { buildWorkingStyleDossierProjection } from "../agent-growth/working-style-dossier.js";
import { listGatewayCollaborationSpaces } from "../collaboration-learning.js";
import {
  isAgentOwnedByEmployeeUser,
  requiresEmployeeAssetScope,
  resolveEmployeeWorkbenchActor,
  resolveScopedAgentsForClient,
} from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { stringValue } from "../records.js";
import { listAgentsForGateway } from "../session-utils.js";
import { listRobotSkillAssets } from "../skill-lifecycle-store.js";
import { tryResolveLiveRobotWriteRoot } from "../workspace-resolver/write-roots.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

function resolveRobotPageWriteRoot(params: {
  agentId: string;
  client: GatewayClient | null;
}): string | null {
  return tryResolveLiveRobotWriteRoot({
    agentId: params.agentId,
    tenantId: params.client?.sessionEnterpriseId || params.client?.sessionTenantId,
    userId: params.client?.platformUserId,
    configuredDefaultWorkspace: loadConfig().agents?.defaults?.workspace,
  });
}

const PERSONAS_FILENAME = "personas.json";

function trimString(value: unknown): string | null {
  return stringValue(value);
}

function sanitizeIdentityLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function deferredUnavailable(method: string, phaseNote: string) {
  return errorShape(ErrorCodes.UNAVAILABLE, `${method}: ${phaseNote}`);
}

function mapSuccessRateToStars(successRate: number | null | undefined): number {
  if (typeof successRate !== "number" || !Number.isFinite(successRate)) {
    return 1;
  }
  const clamped = Math.max(0, Math.min(1, successRate));
  return Math.max(1, Math.min(5, Math.round(clamped * 5)));
}

function mapVisibilityToSource(
  visibility: string | null | undefined,
): "personal" | "group" | "enterprise" | "marketplace" {
  switch (visibility) {
    case "group":
      return "group";
    case "enterprise":
      return "enterprise";
    case "private":
      return "personal";
    default:
      return "marketplace";
  }
}

function resolveConfiguredModel(
  cfg: ReturnType<typeof loadConfig>,
  agentId: string,
): string | null {
  const entry = listAgentEntries(cfg).find((item) => normalizeAgentId(item.id) === agentId);
  const model = entry?.model;
  if (typeof model === "string") {
    return trimString(model);
  }
  if (model && typeof model === "object" && "primary" in model) {
    return trimString((model as { primary?: unknown }).primary);
  }
  return null;
}

type PersonaRecord = { id: string; label: string; description?: string };

function resolvePersonasPath(cfg: ReturnType<typeof loadConfig>, agentId: string): string {
  return path.join(resolveAgentDir(cfg, agentId), PERSONAS_FILENAME);
}

function readAgentPersonas(cfg: ReturnType<typeof loadConfig>, agentId: string): PersonaRecord[] {
  try {
    const raw = fs.readFileSync(resolvePersonasPath(cfg, agentId), "utf-8");
    const parsed = JSON.parse(raw) as { personas?: unknown };
    if (!Array.isArray(parsed.personas)) {
      return [];
    }
    return parsed.personas
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const id = trimString(record.id);
        const label = trimString(record.label);
        if (!id || !label) {
          return null;
        }
        const description = trimString(record.description) ?? undefined;
        return description ? { id, label, description } : { id, label };
      })
      .filter((entry): entry is PersonaRecord => Boolean(entry));
  } catch {
    return [];
  }
}

const MILESTONE_LABELS: Record<string, string> = {
  createdAtMs: "机器人已创建",
  sessionOpenedAtMs: "首次打开会话",
  birthPreludeShownAtMs: "完成诞生引导",
  firstCtaClickedAtMs: "完成首个引导动作",
  identityCompletedAtMs: "完善身份信息",
  firstSkillInstalledAtMs: "安装了首个能力",
  firstPermissionGrantedAtMs: "获得首个权限",
  firstKnowledgeUploadedAtMs: "上传了首份知识",
  missionReadyAtMs: "达到任务就绪",
  firstMissionSentAtMs: "发出首个任务",
  firstMissionSuccessAtMs: "首个任务成功",
  activatedAtMs: "成长激活",
};

function buildGrowthProjection(status: GrowthStatus | null, agentId?: string) {
  if (!status) {
    return {
      level: 0,
      recentEvents: [] as Array<{ text: string; at?: string }>,
      sources: [] as Array<"personal" | "group" | "skill_upgrade">,
      activationScore: 0,
      operationalScore: null as number | null,
      falseReady: false,
      dimensions: {
        identity: 0,
        capability: 0,
        knowledge: 0,
        habits: 0,
      },
      completeness: {
        identity: 0,
        capability: 0,
        performance: 0,
        suggestion: 0,
      },
      funnel: null,
      capabilityGaps: [] as unknown[],
      recommendation: null,
      growthReport: null,
    };
  }
  if (agentId) {
    const payload = buildRobotGrowthStatusPayload({ agentId, growthStatus: status });
    const dossier = buildGrowthDossierProjection({
      growthStatus: status,
      capabilityGaps: payload.capabilityGaps,
      recommendation: payload.recommendation,
      funnel: payload.funnel,
    });
    return {
      level: dossier.level,
      recentEvents: dossier.recentEvents,
      sources: dossier.sources,
      activationScore: dossier.activationScore,
      operationalScore: dossier.operationalScore,
      falseReady: dossier.falseReady,
      dimensions: dossier.dimensions,
      completeness: dossier.completeness,
      funnel: dossier.funnel,
      capabilityGaps: dossier.capabilityGaps,
      recommendation: dossier.recommendation,
      growthReport: dossier.growthReport,
    };
  }
  const level = Math.max(0, Math.min(5, Math.round((status.activationScore ?? 0) / 20)));
  const recentEvents = Object.entries(status.milestones ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, atMs]) => ({
      text: MILESTONE_LABELS[key] ?? key,
      at: new Date(atMs).toISOString(),
    }));
  const sources: Array<"personal" | "group" | "skill_upgrade"> = ["personal"];
  if (status.milestones?.firstSkillInstalledAtMs) {
    sources.push("skill_upgrade");
  }
  return {
    level,
    recentEvents,
    sources,
    activationScore: status.activationScore,
    operationalScore: status.operationalScore,
    falseReady: false,
    dimensions: status.dimensions,
    completeness: {
      identity: Math.round(status.dimensions.identity),
      capability: Math.round(status.dimensions.capability),
      performance: status.operationalScore ?? 0,
      suggestion: 0,
    },
    funnel: null,
    capabilityGaps: [],
    recommendation: null,
    growthReport: status.growthReport ?? null,
  };
}

function briefStatusFromHealth(
  health: string | null | undefined,
): "online" | "degraded" | "offline" | "unknown" {
  if (health === "healthy") {
    return "online";
  }
  if (health === "warning") {
    return "degraded";
  }
  if (health === "broken") {
    return "offline";
  }
  return "unknown";
}

async function buildMyBotProjection(params: {
  cfg: ReturnType<typeof loadConfig>;
  client: GatewayClient | null;
  agent: {
    id: string;
    name?: string;
    identity?: {
      name?: string;
      emoji?: string;
      avatar?: string;
      avatarUrl?: string | null;
      theme?: string;
    } | null;
  };
}) {
  const { cfg, agent, client } = params;
  const agentId = agent.id;
  const workspace = resolveRobotPageWriteRoot({ agentId, client });
  const fileIdentity = workspace ? loadAgentIdentityFromWorkspace(workspace) : null;
  const displayName =
    trimString(agent.identity?.name) ||
    trimString(fileIdentity?.name) ||
    trimString(agent.name) ||
    agentId;

  const skills = listRobotSkillAssets(agentId);
  const capabilities = skills.map((entry) => ({
    name: trimString(entry.profile?.name) || entry.id,
    stars: mapSuccessRateToStars(entry.health?.successRate),
    source: mapVisibilityToSource(entry.profile?.visibility),
    relationId: entry.id,
  }));

  const aggregateHealth =
    skills.length === 0
      ? null
      : skills.some((entry) => entry.health?.status === "broken")
        ? "broken"
        : skills.some((entry) => entry.health?.status === "warning")
          ? "warning"
          : "healthy";

  const growthStatus =
    (await syncRobotGrowthFromOperationalMetrics(cfg, agentId)) ??
    (await readRobotGrowthStatus(cfg, agentId));
  const growth = {
    ...buildGrowthProjection(growthStatus, agentId),
    workingStyle: await buildWorkingStyleDossierProjection(cfg, agentId),
  };

  const personas = readAgentPersonas(cfg, agentId);

  let collaborations: Array<{ groupId: string; title: string; sessionKey: string }> = [];
  try {
    const listed = await listGatewayCollaborationSpaces();
    collaborations = (listed.spaces ?? [])
      .filter((space) =>
        (space.members?.bots ?? []).some(
          (bot) => normalizeAgentId(String(bot.agentId ?? "")) === agentId,
        ),
      )
      .map((space) => ({
        groupId: space.groupId,
        title: trimString(space.title) || space.groupId,
        sessionKey: space.id || `space:${space.groupId}`,
      }));
    if (collaborations.length > 0 && !growth.sources.includes("group")) {
      growth.sources.push("group");
    }
  } catch {
    collaborations = [];
  }

  let memorySize = 0;
  let longTermCount = 0;
  const recentLearning: Array<{ text: string; at?: string }> = [];
  try {
    const memory = await listAgentMemoryEntries({ cfg, agentId });
    for (const entry of memory.entries ?? []) {
      memorySize += typeof entry.bytes === "number" ? entry.bytes : 0;
      longTermCount += 1;
      if (recentLearning.length < 5) {
        recentLearning.push({
          text: trimString(entry.key) || "memory",
          at:
            typeof entry.updatedAtMs === "number"
              ? new Date(entry.updatedAtMs).toISOString()
              : undefined,
        });
      }
    }
  } catch {
    // best-effort
  }

  for (const event of growth.recentEvents) {
    if (recentLearning.length >= 5) {
      break;
    }
    if (event.text.includes("能力") || event.text.includes("知识")) {
      recentLearning.push(event);
    }
  }

  return {
    agentId,
    identity: {
      name: displayName,
      avatar:
        trimString(agent.identity?.avatarUrl) ||
        trimString(agent.identity?.avatar) ||
        trimString(fileIdentity?.avatar),
      positioning: trimString(agent.identity?.theme) || trimString(fileIdentity?.theme),
      intro: null,
      role: trimString(fileIdentity?.creature),
      personaTraits: trimString(fileIdentity?.vibe),
      model: resolveConfiguredModel(cfg, agentId),
      status: briefStatusFromHealth(aggregateHealth),
      createdAt:
        typeof growthStatus?.milestones?.createdAtMs === "number"
          ? new Date(growthStatus.milestones.createdAtMs).toISOString()
          : typeof growthStatus?.birthAtMs === "number"
            ? new Date(growthStatus.birthAtMs).toISOString()
            : null,
    },
    capabilities,
    personas,
    growth,
    collaborations,
    data: {
      memorySize,
      longTermCount,
      kbCount: 0,
      recentLearning,
    },
    phase: 2,
    blocksComplete: {
      identity: true,
      capabilities: true,
      personas: true,
      growth: true,
      collaborations: true,
      data: true,
    },
  };
}

async function writeIdentityFields(params: {
  workspaceDir: string;
  name?: string | null;
  avatar?: string | null;
  positioning?: string | null;
  role?: string | null;
  personaTraits?: string | null;
  emoji?: string | null;
}) {
  const identityPath = path.join(params.workspaceDir, DEFAULT_IDENTITY_FILENAME);
  await fsp.mkdir(params.workspaceDir, { recursive: true });
  let existing = "";
  try {
    existing = await fsp.readFile(identityPath, "utf-8");
  } catch {
    existing = "# IDENTITY.md\n\n";
  }
  const upserts: Array<[string, string | null | undefined]> = [
    ["Name", params.name],
    ["Avatar", params.avatar],
    ["Theme", params.positioning],
    ["Creature", params.role],
    ["Vibe", params.personaTraits],
    ["Emoji", params.emoji],
  ];
  let next = existing;
  for (const [label, value] of upserts) {
    if (value === undefined) {
      continue;
    }
    const safe = value === null || value === "" ? null : sanitizeIdentityLine(value);
    const pattern = new RegExp(`^(\\s*-\\s*\\*?\\*?${label}\\*?\\*?\\s*:).*$`, "im");
    if (safe === null) {
      next = next
        .split(/\r?\n/)
        .filter((line) => !pattern.test(line))
        .join("\n");
      continue;
    }
    if (pattern.test(next)) {
      next = next.replace(pattern, `$1 ${safe}`);
    } else {
      next = `${next.trimEnd()}\n- ${label}: ${safe}\n`;
    }
  }
  await fsp.writeFile(identityPath, next.endsWith("\n") ? next : `${next}\n`, "utf-8");
}

export const robotWorkspaceHandlers: GatewayRequestHandlers = {
  /**
   * Returns My Bot six-block projection (Phase 2 — all blocks populated best-effort).
   */
  "robot.workspace.get": async ({ params, respond, client }) => {
    const agentIdRaw = trimString((params as { agentId?: unknown } | null)?.agentId);
    if (!agentIdRaw) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "robot.workspace.get requires agentId"),
      );
      return;
    }
    const agentId = normalizeAgentId(agentIdRaw);
    const cfg = loadConfig();
    const result = listAgentsForGateway(cfg);
    const agents = await resolveScopedAgentsForClient(client, result.agents);
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown or inaccessible agentId: ${agentId}`),
      );
      return;
    }
    const bot = await buildMyBotProjection({ cfg, agent, client });
    respond(true, { bot }, undefined);
  },

  "robot.workspace.listPersonas": async ({ params, respond, client }) => {
    const agentIdRaw = trimString((params as { agentId?: unknown } | null)?.agentId);
    if (!agentIdRaw) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "robot.workspace.listPersonas requires agentId"),
      );
      return;
    }
    const agentId = normalizeAgentId(agentIdRaw);
    const cfg = loadConfig();
    const result = listAgentsForGateway(cfg);
    const agents = await resolveScopedAgentsForClient(client, result.agents);
    if (!agents.some((entry) => entry.id === agentId)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown or inaccessible agentId: ${agentId}`),
      );
      return;
    }
    respond(true, { agentId, personas: readAgentPersonas(cfg, agentId), phase: 2 }, undefined);
  },

  "robot.workspace.updateIdentity": async ({ params, respond, client }) => {
    const input = (params ?? {}) as {
      agentId?: unknown;
      name?: unknown;
      avatar?: unknown;
      positioning?: unknown;
      role?: unknown;
      personaTraits?: unknown;
      model?: unknown;
      emoji?: unknown;
    };
    const agentIdRaw = trimString(input.agentId);
    if (!agentIdRaw) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "robot.workspace.updateIdentity requires agentId"),
      );
      return;
    }
    const agentId = normalizeAgentId(agentIdRaw);
    const cfg = loadConfig();
    const result = listAgentsForGateway(cfg);
    const actor = await resolveEmployeeWorkbenchActor(client);
    const agent = result.agents.find((entry) => entry.id === agentId);
    if (!agent) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown agentId: ${agentId}`),
      );
      return;
    }
    if (requiresEmployeeAssetScope(client)) {
      if (!actor || !isAgentOwnedByEmployeeUser(agent, actor)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "only the owner can update robot identity"),
        );
        return;
      }
    } else if (actor && !isAgentOwnedByEmployeeUser(agent, actor)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "only the owner can update robot identity"),
      );
      return;
    }

    const name = trimString(input.name);
    const avatar = trimString(input.avatar);
    const model = trimString(input.model);
    const positioning = trimString(input.positioning);
    const role = trimString(input.role);
    const personaTraits = trimString(input.personaTraits);
    const emoji = trimString(input.emoji);

    const nextConfig = applyAgentConfig(cfg, {
      agentId,
      ...(name ? { name } : {}),
      ...(model ? { model } : {}),
    });
    await writeConfigFile(nextConfig);

    const workspaceDir = resolveRobotPageWriteRoot({ agentId, client });
    if (!workspaceDir) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "robot workspace requires tenant-user identity"),
      );
      return;
    }
    await writeIdentityFields({
      workspaceDir,
      name: name ?? undefined,
      avatar: avatar ?? undefined,
      positioning: positioning ?? undefined,
      role: role ?? undefined,
      personaTraits: personaTraits ?? undefined,
      emoji: emoji ?? undefined,
    });

    // P0 onboarding：身份字段真实落盘后才记完成（禁止「点按钮即完成」）。
    if (name || role || positioning || personaTraits) {
      void recordRobotGrowthMilestone(nextConfig, agentId, "identityCompletedAtMs").catch(() => {});
    }

    const bot = await buildMyBotProjection({
      cfg: nextConfig,
      client,
      agent: {
        ...agent,
        name: name ?? agent.name,
        identity: {
          ...agent.identity,
          ...(name ? { name } : {}),
          ...(avatar ? { avatar } : {}),
          ...(positioning ? { theme: positioning } : {}),
        },
      },
    });
    respond(true, { ok: true, agentId, bot }, undefined);
  },

  "robot.workspace.delete": async ({ respond }) => {
    respond(
      false,
      undefined,
      deferredUnavailable(
        "robot.workspace.delete",
        "Phase 2 keeps delete on agents.delete (UI「更多 → 删除」); workspace.delete alias lands with disposal parity later.",
      ),
    );
  },
};
