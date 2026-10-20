import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { loadConfig } from "../../config/config.js";
import { deriveSessionChatType, parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import type { DaibaiWorkspaceOverview } from "../../shared/daibai-types.js";
import {
  listGatewayCollaborationSpaces,
  type GatewayCollaborationSpaceSnapshot,
} from "../collaboration-learning.js";
import {
  filterAgentsForEmployeeActor,
  filterCollaborationSpacesForEmployeeActor,
  resolveEmployeeWorkbenchActor,
  type EmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { listAgentsForGateway, type GatewayAgentRow } from "../session-utils.js";
import type { GatewayClient } from "./types.js";

const PREVIEW_NAME_LIMIT = 12;

function normalizeValue(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeLookup(value: string | null | undefined): string {
  return normalizeValue(value).toLowerCase();
}

function extractSpaceIdentityFromSessionKey(sessionKey: string | null | undefined): string | null {
  const normalized = normalizeValue(sessionKey);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("space:")) {
    const groupId = normalized.slice("space:".length).trim();
    return groupId || null;
  }
  const parsed = parseAgentSessionKey(normalized);
  if (!parsed) {
    return null;
  }
  const rest = parsed.rest.trim();
  if (rest.startsWith("space:")) {
    const groupId = rest.slice("space:".length).trim();
    return groupId || null;
  }
  if (deriveSessionChatType(normalized) === "group") {
    return rest || null;
  }
  return null;
}

function isPresentMemberStatus(status: string | null | undefined): boolean {
  return normalizeLookup(status) !== "removed";
}

function resolveHumanLabel(member: {
  name?: string | null;
  handle?: string | null;
  email?: string | null;
  userId?: string | null;
}) {
  return (
    normalizeValue(member.name) ||
    normalizeValue(member.handle) ||
    normalizeValue(member.email) ||
    normalizeValue(member.userId) ||
    "未命名成员"
  );
}

function resolveBotLabel(member: { name?: string | null; agentId?: string | null }) {
  return normalizeValue(member.name) || normalizeValue(member.agentId) || "未命名机器人";
}

function buildPreviewList(values: string[]) {
  if (values.length === 0) {
    return "暂无";
  }
  const preview = values.slice(0, PREVIEW_NAME_LIMIT).join("、");
  const remaining = values.length - PREVIEW_NAME_LIMIT;
  return remaining > 0 ? `${preview}，以及另外 ${remaining} 个` : preview;
}

function summarizeSpace(space: GatewayCollaborationSpaceSnapshot) {
  const humanCount = space.members.humans.filter((member) =>
    isPresentMemberStatus(member.status),
  ).length;
  const botCount = space.members.bots.filter((member) =>
    isPresentMemberStatus(member.status),
  ).length;
  return `${normalizeValue(space.title) || space.groupId}（成员 ${humanCount + botCount}：人类 ${humanCount} / 机器人 ${botCount}）`;
}

function findCurrentSpace(
  spaces: GatewayCollaborationSpaceSnapshot[],
  sourceSessionKey?: string,
  sessionKey?: string,
): GatewayCollaborationSpaceSnapshot | null {
  const currentSpaceId =
    extractSpaceIdentityFromSessionKey(sourceSessionKey) ??
    extractSpaceIdentityFromSessionKey(sessionKey);
  if (!currentSpaceId) {
    return null;
  }
  const normalizedCurrentSpaceId = normalizeLookup(currentSpaceId);
  return (
    spaces.find((space) => {
      return (
        normalizeLookup(space.groupId) === normalizedCurrentSpaceId ||
        normalizeLookup(space.id) === normalizedCurrentSpaceId
      );
    }) ?? null
  );
}

function resolveVisibleWorkspaceScope(params: {
  actor: EmployeeWorkbenchActor;
  agents: GatewayAgentRow[];
  spaces: GatewayCollaborationSpaceSnapshot[];
  sessionKey?: string;
  sourceSessionKey?: string;
}) {
  const visibleAgents = filterAgentsForEmployeeActor(params.agents, params.actor).filter(
    (agent) => !isBuiltinStewardAgent(agent.id),
  );
  const visibleSpaces = filterCollaborationSpacesForEmployeeActor(params.spaces, params.actor);
  const currentSpace = findCurrentSpace(visibleSpaces, params.sourceSessionKey, params.sessionKey);
  return { visibleAgents, visibleSpaces, currentSpace };
}

export function buildDaibaiWorkspaceOverview(params: {
  actor: EmployeeWorkbenchActor;
  agents: GatewayAgentRow[];
  spaces: GatewayCollaborationSpaceSnapshot[];
  sessionKey?: string;
  sourceSessionKey?: string;
}): DaibaiWorkspaceOverview {
  const { visibleAgents, visibleSpaces, currentSpace } = resolveVisibleWorkspaceScope(params);
  const humanLabels =
    currentSpace?.members.humans
      .filter((member) => isPresentMemberStatus(member.status))
      .map((member) => resolveHumanLabel(member)) ?? [];
  const botLabels =
    currentSpace?.members.bots
      .filter((member) => isPresentMemberStatus(member.status))
      .map((member) => resolveBotLabel(member)) ?? [];

  return {
    visibleRobotCount: visibleAgents.length,
    visibleSpaceCount: visibleSpaces.length,
    ...(currentSpace
      ? {
          currentSpace: {
            groupId: currentSpace.groupId,
            title: normalizeValue(currentSpace.title) || currentSpace.groupId,
            memberCount: humanLabels.length + botLabels.length,
            humanCount: humanLabels.length,
            botCount: botLabels.length,
            humans: humanLabels,
            bots: botLabels,
          },
        }
      : {}),
  };
}

export function buildDaibaiWorkspaceOverviewSummary(
  overview: DaibaiWorkspaceOverview | null | undefined,
): string {
  if (!overview) {
    return "";
  }
  const base = `当前可见 ${overview.visibleRobotCount} 个机器人、${overview.visibleSpaceCount} 个协作群。`;
  if (!overview.currentSpace) {
    return base;
  }
  return `${base} 当前群「${overview.currentSpace.title}」共有 ${overview.currentSpace.memberCount} 位成员（人类 ${overview.currentSpace.humanCount} / 机器人 ${overview.currentSpace.botCount}）。`;
}

export function buildDaibaiWorkspaceScopePrompt(params: {
  actor: EmployeeWorkbenchActor;
  agents: GatewayAgentRow[];
  spaces: GatewayCollaborationSpaceSnapshot[];
  sessionKey?: string;
  sourceSessionKey?: string;
}): string {
  const { visibleAgents, visibleSpaces, currentSpace } = resolveVisibleWorkspaceScope(params);
  const visibleRobotLabels = visibleAgents.map((agent) => normalizeValue(agent.name) || agent.id);
  const visibleSpaceLabels = visibleSpaces.map((space) => summarizeSpace(space));
  const currentHumanLabels =
    currentSpace?.members.humans
      .filter((member) => isPresentMemberStatus(member.status))
      .map((member) => resolveHumanLabel(member)) ?? [];
  const currentBotLabels =
    currentSpace?.members.bots
      .filter((member) => isPresentMemberStatus(member.status))
      .map((member) => resolveBotLabel(member)) ?? [];

  return [
    "【后台参照信息，仅供你判断范围时使用，不是要你复述的内容】以下是当前用户在本次会话授权范围内可见的工作台对象；把它们视为运行时事实，不要凭空缩小范围。",
    `- 可见机器人（${visibleAgents.length}）: ${buildPreviewList(visibleRobotLabels)}`,
    `- 可见协作群（${visibleSpaces.length}）: ${buildPreviewList(visibleSpaceLabels)}`,
    currentSpace
      ? `- 当前相关协作群: ${currentSpace.title}；人类成员：${buildPreviewList(currentHumanLabels)}；机器人成员：${buildPreviewList(currentBotLabels)}`
      : "",
    "重要：不要主动播报或罗列上面的数量与清单。用户问候、寒暄、闲聊时，就正常自然地回应，绝不要用“当前可见 N 个机器人、N 个协作群”这类句子开场或作答。只有当用户明确询问“有哪些机器人/协作群”“我能用哪些”或类似的范围问题时，才引用上述信息。",
    "如果用户提到某个协作群或机器人不在上述列表里，只能说“在我当前授权范围内暂未看到”，不要说“系统里不存在”“我翻遍所有记录都没有”或“系统中只有某一个群”。",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function resolveDaibaiWorkspaceOverview(params: {
  client: GatewayClient | null | undefined;
  sessionKey?: string;
  sourceSessionKey?: string;
}): Promise<DaibaiWorkspaceOverview | undefined> {
  const actor = await resolveEmployeeWorkbenchActor(params.client);
  if (!actor) {
    return undefined;
  }
  const cfg = loadConfig();
  const [spacesPayload, agents] = await Promise.all([
    listGatewayCollaborationSpaces(),
    Promise.resolve(listAgentsForGateway(cfg).agents),
  ]);
  return buildDaibaiWorkspaceOverview({
    actor,
    agents,
    spaces: spacesPayload.spaces ?? [],
    sessionKey: params.sessionKey,
    sourceSessionKey: params.sourceSessionKey,
  });
}

export async function resolveDaibaiWorkspaceScopePrompt(params: {
  client: GatewayClient | null | undefined;
  sessionKey?: string;
  sourceSessionKey?: string;
}): Promise<string | undefined> {
  const actor = await resolveEmployeeWorkbenchActor(params.client);
  if (!actor) {
    return undefined;
  }
  const cfg = loadConfig();
  const [spacesPayload, agents] = await Promise.all([
    listGatewayCollaborationSpaces(),
    Promise.resolve(listAgentsForGateway(cfg).agents),
  ]);
  return buildDaibaiWorkspaceScopePrompt({
    actor,
    agents,
    spaces: spacesPayload.spaces ?? [],
    sessionKey: params.sessionKey,
    sourceSessionKey: params.sourceSessionKey,
  });
}
