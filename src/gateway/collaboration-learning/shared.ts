import {
  normalizeValue,
  resolveEffectiveGroupOwnerUserId,
  applyGroupOwnerRole,
} from "./member-governance.js";
export {
  normalizeValue,
  isParticipatingCollaborationMember,
  countParticipatingCollaborationMembers,
  isArchivedCollaborationGroupProfile,
  shouldAutoArchiveCollaborationSpaceWhenVacant,
  resolveMembersForVacancyHeal,
  shouldHealVacantCollaborationSpaceOnList,
  resolveEffectiveGroupOwnerUserId,
  resolveNextGroupOwnerUserId,
  applyGroupOwnerRole,
  cloneMembersForReset,
} from "./member-governance.js";
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  BotParticipationProfile,
  CapsuleConfidentialityScope,
  CapsuleReusability,
  CapsuleSensitivity,
  CollaborationBinding,
  CollaborationMember,
  Decision,
  Deliverable,
  GroupCapabilityProfile,
  GroupProfile,
  ParticipationConfidentialityTier,
  Review,
  Task,
} from "@openbot/collaboration-core";
import {
  OpenBotGroupStorage,
  OpenBotLearningStorage,
  OpenBotMemoryStorage,
  OpenBotMetadataStorage,
  OpenBotObjectStorage,
} from "@openbot/collaboration-openbot-adapter";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { CROSS_OPERATOR_STATE_DENIED } from "../../config/operator-state-scope.js";
import { resolveStateDir } from "../../config/paths.js";
import { loadSessionStore, resolveStorePath, type SessionEntry } from "../../config/sessions.js";
import { resolveUserPresence } from "../../infra/user-presence.js";
import type { PresenceState } from "../../organization/presence.js";
import type { TaskAssignment } from "../../organization/task-assignment.js";
import { readJsonFileWithFallback, writeJsonFileAtomically } from "../../plugin-sdk/json-store.js";
import { toCollaborationSpaceSessionKey } from "../../sessions/session-key-utils.js";
import { createInitialGrowthStatus } from "../agent-growth/factory.js";
import type { GrowthStatus } from "../agent-growth/types.js";
import { L1_DEFAULT } from "../collaboration-dispatch/policy-compiler.js";
import { withRoundLock } from "../collaboration-dispatch/round-store-io.js";
import { findActiveOwnershipRecord, listOwnershipRecords } from "../ownership-store.js";
import { readSessionMessages, resolveSessionTranscriptCandidates } from "../session-utils.js";
import { listAgentsForGateway } from "../session-utils.js";
import { resolveLiveCollaborationWorkspaceRoot } from "../workspace/group-locator.js";
import { rewriteOpenclawPathToOpenbotIfPresent } from "./openbot-path-rewrite.js";
import type {
  GatewayCollaborationGroupOperatingState,
  GatewayCollaborationOperatingPhase,
} from "./operating-state-types.js";
import { resolveSessionParticipationGroupId } from "./session-participation-overlay.js";
import type { GatewayCollaborationBotMemberSnapshot } from "./snapshot-types.js";

export type GroupBootstrapMemoryRecord = {
  memoryId: string;
  groupId: string;
  kind: "group_bootstrap";
  title: string;
  summary: string;
  content: {
    ownerUserId?: string | null;
    ownerLabel?: string | null;
    coordinatorBotId?: string | null;
    coordinatorBotLabel?: string | null;
    purpose?: string | null;
    currentMission?: string | null;
    collaborationMode?: string | null;
    successCriteria?: string[];
    systemInstructions?: string[];
    memberCount: number;
  };
  createdAtMs: number;
  updatedAtMs: number;
};

export type StoredGroupProfile = Record<string, unknown> & {
  id: string;
  name: string;
  groupId?: string;
  groupCode?: string;
  displayName?: string;
  avatar?: string;
  visibilityScope?: string;
  ownerUserId?: string;
  coordinatorBotId?: string;
  purpose?: string;
  currentMission?: string;
  successCriteria?: string[];
  collaborationMode?: string;
  workspacePath?: string;
  finalDecisionPolicy?: GroupProfile["finalDecisionPolicy"];
  createdAtMs: number;
  updatedAtMs: number;
};

export type GatewayWorkspaceHumanMember = {
  userId: string;
  name?: string;
  handle?: string;
};

export type GatewayWorkspaceBotMember = {
  agentId: string;
  name?: string;
};

export type GatewayWorkspaceMemberRoster = {
  humans?: GatewayWorkspaceHumanMember[];
  bots?: GatewayWorkspaceBotMember[];
};

export type ConfiguredAgentOwnership = {
  ownerId?: string | null;
  ownerName?: string | null;
  ownerType?: "platform" | "tenant" | "position" | null;
  scope?: string | null;
};

export function resolveCollaborationActorIdentities(
  actor?: string | null,
  actorEmployeeUserId?: string | null,
  actorEmail?: string | null,
): Set<string> {
  const identities = new Set<string>();
  for (const value of [actor, actorEmployeeUserId, actorEmail]) {
    const normalized = normalizeValue(value);
    if (normalized) {
      identities.add(normalized.toLowerCase());
    }
  }
  return identities;
}

export function humanMemberMatchesActorIdentities(
  member: CollaborationMember & { email?: string | null; handle?: string | null },
  actorIdentities: ReadonlySet<string>,
): boolean {
  if (member.memberKind !== "human") {
    return false;
  }
  // Same predicate as employee-workbench-scope / UI: userId ∪ email ∪ handle.
  for (const raw of [member.userId, member.email, member.handle]) {
    const identity = normalizeValue(raw);
    if (identity && actorIdentities.has(identity.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/** Lines regenerated from current profile/roster — never append stale copies. */
const BOOTSTRAP_MANAGED_INSTRUCTION_PREFIXES = [
  "协作小组名称：",
  "群主：",
  "协调机器人：",
  "小组定位：",
  "当前使命：",
  "成功标准：",
  "新加入成员应先简要介绍",
  "讨论输出应保持清晰",
] as const;

export function isBootstrapManagedSystemInstruction(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }
  return BOOTSTRAP_MANAGED_INSTRUCTION_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function retainCustomSystemInstructions(existing: string[] | null | undefined): string[] {
  return normalizeStringList(existing).filter((line) => !isBootstrapManagedSystemInstruction(line));
}

export function ensureCreatorHumanMember(params: {
  existingMembers: CollaborationMember[];
  nextMembers: CollaborationMember[];
  actor?: string;
  actorEmployeeUserId?: string;
  creatorLabel?: string;
  now: number;
}): CollaborationMember[] {
  const actorIdentities = resolveCollaborationActorIdentities(
    params.actor,
    params.actorEmployeeUserId,
  );
  if (actorIdentities.size === 0) {
    return params.nextMembers;
  }
  const hasCreator = params.nextMembers.some(
    (member) =>
      member.memberKind === "human" &&
      member.status === "active" &&
      humanMemberMatchesActorIdentities(member, actorIdentities),
  );
  if (hasCreator) {
    return params.nextMembers;
  }
  const activeExisting = params.existingMembers.filter(
    (member) => member.status !== "removed" && member.status !== "revoked",
  );
  if (activeExisting.length > 0) {
    return params.nextMembers;
  }
  const creatorIdentity =
    normalizeValue(params.actorEmployeeUserId) ?? normalizeValue(params.actor);
  if (!creatorIdentity) {
    return params.nextMembers;
  }
  return [
    ...params.nextMembers,
    buildPersistedMember({
      existingMembers: params.existingMembers,
      kind: "human",
      identity: creatorIdentity,
      name: normalizeValue(params.creatorLabel) ?? creatorIdentity,
      status: "active",
      now: params.now,
    }),
  ];
}

export function isActorAuthorizedBotOwner(params: {
  actor?: string;
  actorEmployeeUserId?: string;
  agentId: string;
  botOwnerUserIdByAgentId?: ReadonlyMap<string, string>;
}): boolean {
  const actorIdentities = resolveCollaborationActorIdentities(
    params.actor,
    params.actorEmployeeUserId,
  );
  if (actorIdentities.size === 0) {
    return false;
  }
  const agentId = normalizeValue(params.agentId)?.toLowerCase();
  if (!agentId) {
    return false;
  }
  const mappedOwner = params.botOwnerUserIdByAgentId?.get(agentId);
  if (mappedOwner && actorIdentities.has(mappedOwner.toLowerCase())) {
    return true;
  }
  const ownership = readConfiguredAgentOwnership(agentId);
  const ownerId = normalizeValue(ownership?.ownerId);
  if (ownerId && actorIdentities.has(ownerId.toLowerCase())) {
    return true;
  }
  return false;
}

export function promoteSelfOwnedBotInvites(params: {
  members: CollaborationMember[];
  actor?: string;
  actorEmployeeUserId?: string;
  botOwnerUserIdByAgentId?: ReadonlyMap<string, string>;
  now: number;
}): CollaborationMember[] {
  return params.members.map((member) => {
    if (member.memberKind !== "bot" || member.status !== "invited") {
      return member;
    }
    const agentId = normalizeValue(member.agentId);
    if (!agentId) {
      return member;
    }
    if (
      !isActorAuthorizedBotOwner({
        actor: params.actor,
        actorEmployeeUserId: params.actorEmployeeUserId,
        agentId,
        botOwnerUserIdByAgentId: params.botOwnerUserIdByAgentId,
      })
    ) {
      return member;
    }
    return {
      ...member,
      status: "active",
      joinedAtMs: member.joinedAtMs ?? params.now,
      updatedAtMs: params.now,
    } satisfies CollaborationMember;
  });
}

export type StoredSessionMetadata = {
  groupId?: string;
  label?: string;
  displayName?: string;
  subject?: string;
  space?: string;
  updatedAt?: number;
  homeDomainId?: string;
  lineage?: {
    groupId?: string;
  };
};

const GROUP_OPERATING_STATE_FILENAME = "operating-state.json";

export function resolveAgentCollaborationGroupRoot(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), ".openbot", "collaboration", "groups");
}

export function resolveCollaborationSharedGroupRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, "groups");
}

export function resolveManagedSpacesRoot(stateDir: string): string {
  return path.join(stateDir, "spaces");
}

export function resolveGroupStoreFilePath(params: {
  groupRootDir: string;
  groupId: string;
  filename: string;
}): string {
  const baseRoot = path.resolve(params.groupRootDir);
  const groupDir = path.join(baseRoot, encodeURIComponent(params.groupId));
  return path.join(groupDir, params.filename);
}

export function resolveGroupWorkspacePath(groupRootDir: string, groupId: string): string {
  return path.join(path.resolve(groupRootDir), encodeURIComponent(groupId));
}

/**
 * Collaboration group id carried by a session key.
 * Accepts both the bare `space:<groupId>` form and channel-prefixed
 * `<channel>:...:space:<groupId>` forms.
 */
export function resolveCollaborationGroupIdFromSessionKey(
  sessionKey?: string | null,
): string | null {
  const raw = sessionKey?.trim();
  if (!raw) {
    return null;
  }
  if (raw.toLowerCase().startsWith("space:")) {
    return raw.slice("space:".length).trim() || null;
  }
  return raw.match(/:space:([^:]+)$/i)?.[1]?.trim() || null;
}

export function uniquePaths(paths: string[]) {
  const seen = new Set<string>();
  return paths.filter((entry) => {
    const normalized = path.resolve(entry);
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

/**
 * Group file I/O — single runtime root (`primaryGroupRootDir`). No legacy read fallbacks.
 */
export function createGroupFileStore(primaryGroupRootDir: string) {
  const resolvedPrimary = path.resolve(primaryGroupRootDir);
  return {
    /** Physical group root this store writes when baseDir is omitted (T53 lock identity). */
    primaryGroupRootDir: resolvedPrimary,
    readGroupFile: async <T>(params: { groupId: string; filename: string; baseDir?: string }) => {
      const groupRootDir = params.baseDir ?? resolvedPrimary;
      const filePath = resolveGroupStoreFilePath({
        groupRootDir,
        groupId: params.groupId,
        filename: params.filename,
      });
      const { value } = await readJsonFileWithFallback<T | null>(filePath, null);
      return value;
    },
    writeGroupFile: async (params: {
      groupId: string;
      filename: string;
      data: unknown;
      baseDir?: string;
    }) => {
      const filePath = resolveGroupStoreFilePath({
        groupRootDir: params.baseDir ?? resolvedPrimary,
        groupId: params.groupId,
        filename: params.filename,
      });
      await writeJsonFileAtomically(filePath, params.data);
    },
  };
}

export function resolveManagedSpaceDirCandidates(stateDir: string, groupId: string) {
  return [
    path.join(resolveManagedSpacesRoot(stateDir), groupId),
    path.join(resolveManagedSpacesRoot(stateDir), encodeURIComponent(groupId)),
  ];
}

export async function readManagedSpaceFile<T>(
  stateDir: string,
  groupId: string,
  filename: string,
): Promise<T | null> {
  for (const dir of resolveManagedSpaceDirCandidates(stateDir, groupId)) {
    const filePath = path.join(dir, filename);
    const { value } = await readJsonFileWithFallback<T | null>(filePath, null);
    if (value != null) {
      return value;
    }
  }
  return null;
}

export async function writeManagedSpaceFile(
  _stateDir: string,
  _groupId: string,
  _filename: string,
  _data: unknown,
) {
  throw new Error("managed spaces is retired; refusing write to stateDir/spaces");
}

function resolveConfiguredBotDisplayName(agentId: string | null | undefined) {
  const normalizedAgentId = normalizeValue(agentId);
  if (!normalizedAgentId) {
    return null;
  }
  const cfg = loadConfig();
  const configured = listAgentsForGateway(cfg).agents.find(
    (entry) => entry.id === normalizedAgentId,
  );
  return configured?.identity?.name?.trim() || configured?.name?.trim() || null;
}

export function normalizeStringList(values: string[] | null | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function extractTranscriptMessageText(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const entry = message as { text?: unknown; content?: unknown };
  if (typeof entry.text === "string" && entry.text.trim()) {
    return entry.text.trim();
  }
  if (typeof entry.content === "string" && entry.content.trim()) {
    return entry.content.trim();
  }
  if (Array.isArray(entry.content)) {
    const parts = entry.content
      .map((block) =>
        block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text.trim()
          : "",
      )
      .filter(Boolean);
    return parts.length > 0 ? parts.join("\n").trim() : null;
  }
  return null;
}

export function derivePurposeFromConversationSeed(text: string | null) {
  const normalized = normalizeValue(text);
  if (!normalized) {
    return null;
  }
  const patterns = [
    /(?:将|会)?致力于([^，。！？!?\n]+)/u,
    /负责([^，。！？!?\n]+)/u,
    /聚焦([^，。！？!?\n]+)/u,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = normalizeValue(match?.[1]);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

export function deriveCurrentMissionFromConversationSeed(text: string | null) {
  const normalized = normalizeValue(text);
  if (!normalized) {
    return null;
  }
  if (normalized.includes("介绍一下自己") || normalized.includes("分别介绍")) {
    return "完成成员介绍并建立协作上下文";
  }
  if (normalized.includes("彼此算是认识") || normalized.includes("彼此认识")) {
    return "完成成员互相介绍，等待进入正式协作";
  }
  return null;
}

export function normalizeConfidentialityTier(
  value: string | null | undefined,
): ParticipationConfidentialityTier {
  switch (value) {
    case "public":
    case "internal":
    case "restricted":
    case "secret":
      return value;
    default:
      return "internal";
  }
}

export function mapTierToSensitivity(tier: ParticipationConfidentialityTier): CapsuleSensitivity {
  switch (tier) {
    case "public":
      return "public";
    case "restricted":
      return "restricted";
    case "secret":
      return "secret";
    default:
      return "internal";
  }
}

export function mapTierToReusability(tier: ParticipationConfidentialityTier): CapsuleReusability {
  switch (tier) {
    case "secret":
      return "group_only";
    default:
      return "promotable";
  }
}

export function mapTierToConfidentialityScope(
  tier: ParticipationConfidentialityTier,
): CapsuleConfidentialityScope {
  switch (tier) {
    case "public":
      return "cross_org";
    case "secret":
      return "group";
    default:
      return "tenant";
  }
}

export function findHumanMemberLabel(
  members: CollaborationMember[],
  userId: string | null | undefined,
) {
  const normalizedUserId = normalizeValue(userId);
  if (!normalizedUserId) {
    return null;
  }
  const member = members.find(
    (entry) => entry.memberKind === "human" && normalizeValue(entry.userId) === normalizedUserId,
  );
  return normalizeValue(member?.name) ?? normalizedUserId;
}

export function findBotMemberLabel(
  members: CollaborationMember[],
  botId: string | null | undefined,
) {
  const normalizedBotId = normalizeValue(botId);
  if (!normalizedBotId) {
    return null;
  }
  const member = members.find(
    (entry) => entry.memberKind === "bot" && normalizeValue(entry.agentId) === normalizedBotId,
  );
  return normalizeValue(member?.name) ?? normalizedBotId;
}

export function parseStoredGroupMembersFile(
  value: CollaborationMember[] | { members?: CollaborationMember[] | null } | null | undefined,
): CollaborationMember[] | null {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value.members)) {
    return value.members;
  }
  return null;
}

export function buildProfileMemberSnapshot(members: CollaborationMember[]) {
  const humans = members
    .filter((member) => member.memberKind === "human" && member.status === "active")
    .filter((member) => normalizeValue(member.userId))
    .map((member) => ({
      userId: normalizeValue(member.userId) as string,
      name: normalizeValue(member.name) ?? normalizeValue(member.userId) ?? "",
      role: member.governanceRole,
    }));
  const bots = members
    .filter((member) => member.memberKind === "bot" && member.status === "active")
    .filter((member) => normalizeValue(member.agentId))
    .map((member) => ({
      agentId: normalizeValue(member.agentId) as string,
      name: normalizeValue(member.name) ?? normalizeValue(member.agentId) ?? "",
      role: member.collaborationRole ?? member.governanceRole,
    }));
  return { humans, bots };
}

/** Shown when the active task has no deliverable whose taskId matches it. */
export const CURRENT_TASK_NO_FORMAL_DELIVERABLE = "当前任务无正式成果";

export function summarizeActiveContext(params: {
  phase: GatewayCollaborationOperatingPhase;
  currentMission?: string | null;
  taskId?: string | null;
  reviewId?: string | null;
  decisionId?: string | null;
  deliverableId?: string | null;
  /** Current task exists, but no formal deliverable is bound to it. */
  noFormalDeliverableForCurrentTask?: boolean;
}) {
  const parts = normalizeStringList([
    params.currentMission ? `使命：${params.currentMission}` : "",
    params.taskId ? `任务：${params.taskId}` : "",
    params.reviewId ? `评审：${params.reviewId}` : "",
    params.decisionId ? `决策：${params.decisionId}` : "",
    params.noFormalDeliverableForCurrentTask
      ? CURRENT_TASK_NO_FORMAL_DELIVERABLE
      : params.deliverableId
        ? `产出：${params.deliverableId}`
        : "",
    `阶段：${params.phase}`,
  ]);
  return parts.join("；");
}

const ACTIVE_TASK_STATUSES = new Set(["ready", "in_progress", "blocked", "review"]);

/**
 * Prefer system task authority (existing OS currentTaskId / activated task) when
 * that task is still active. Update-time alone must not let an old task steal
 * the current binding.
 */
export function selectActiveTask(tasks: Task[], preferredTaskId?: string | null): Task | undefined {
  const active = [...tasks].filter((task) => ACTIVE_TASK_STATUSES.has(task.status));
  const preferred = preferredTaskId?.trim() ?? "";
  if (preferred) {
    const bound = active.find((task) => task.taskId === preferred);
    if (bound) {
      return bound;
    }
  }
  return active.toSorted((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))[0];
}

const ACTIVE_DELIVERABLE_STATUSES = new Set(["draft", "submitted", "in_review", "approved"]);

export function selectActiveDeliverable(deliverables: Deliverable[]) {
  return [...deliverables]
    .filter((deliverable) => ACTIVE_DELIVERABLE_STATUSES.has(deliverable.status))
    .toSorted((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))[0];
}

/**
 * Formal deliverable for the current task only.
 * A newer deliverable bound to another task (or with no taskId) is not reused.
 * No current task → undefined (caller may keep the unscoped picker).
 */
export function selectDeliverableForCurrentTask(
  deliverables: readonly Deliverable[],
  currentTaskId: string | null | undefined,
): Deliverable | undefined {
  const taskId = currentTaskId?.trim() ?? "";
  if (!taskId) {
    return undefined;
  }
  return [...deliverables]
    .filter((deliverable) => ACTIVE_DELIVERABLE_STATUSES.has(deliverable.status))
    .filter((deliverable) => (deliverable.taskId ?? "").trim() === taskId)
    .toSorted((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))[0];
}

/**
 * OS deliverable binding used by syncGroupOperatingState.
 * When an active task exists, currentDeliverableId must share that taskId.
 * Mismatch → no id, and the phase is not driven by the foreign deliverable.
 */
export function projectOperatingDeliverableBinding(params: {
  tasks: readonly Task[];
  deliverables: readonly Deliverable[];
  decision?: Decision;
  review?: Review;
  /** Existing OS / activated task authority when still active. */
  preferredTaskId?: string | null;
}): {
  task: Task | undefined;
  deliverable: Deliverable | undefined;
  currentDeliverableId: string | null;
  phase: GatewayCollaborationOperatingPhase;
  noFormalDeliverable: boolean;
  /** True when there is no active task; historical rows must not pose as current. */
  historicalOnly: boolean;
} {
  const task = selectActiveTask([...params.tasks], params.preferredTaskId);
  const taskId = task?.taskId?.trim() ?? "";
  // No active task → do not promote a historical deliverable into currentDeliverableId.
  const deliverable = taskId
    ? selectDeliverableForCurrentTask(params.deliverables, taskId)
    : undefined;
  const phase = deriveOperatingPhase({
    decision: params.decision,
    review: params.review,
    deliverable,
  });
  return {
    task,
    deliverable,
    currentDeliverableId: deliverable?.deliverableId ?? null,
    phase,
    noFormalDeliverable: Boolean(taskId) && !deliverable,
    historicalOnly: !taskId,
  };
}

export function selectActiveReview(reviews: Review[]) {
  return [...reviews]
    .filter((review) => ["requested", "submitted"].includes(review.status))
    .toSorted((left, right) => (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0))[0];
}

export function selectActiveDecision(decisions: Decision[]) {
  return [...decisions]
    .filter((decision) => decision.status === "draft")
    .toSorted((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];
}

export function deriveOperatingPhase(params: {
  decision?: Decision;
  review?: Review;
  deliverable?: Deliverable;
}): GatewayCollaborationOperatingPhase {
  if (params.decision) {
    return "decide";
  }
  if (params.deliverable?.status === "in_review") {
    return "review";
  }
  if (params.review) {
    return "debate";
  }
  if (params.deliverable?.status === "approved") {
    return "review";
  }
  if (params.deliverable) {
    return "deliver";
  }
  return "explore";
}

/** T52: OS auth version SoT field; absent / non-finite / negative ⇒ 0 (migrate, do not invent). */
export function readOperatingStateAuthEpoch(
  state: { authEpoch?: number } | null | undefined,
): number {
  if (typeof state?.authEpoch !== "number" || !Number.isFinite(state.authEpoch)) {
    return 0;
  }
  if (state.authEpoch < 0) {
    return 0;
  }
  return Math.floor(state.authEpoch);
}

/** Directory for per-group OS auth lock (serializes auth writes + eligibility auth checks). */
export function groupAuthLockDir(params: { groupId: string; groupRootDir: string }): string {
  return path.join(resolveGroupWorkspacePath(params.groupRootDir, params.groupId), "os-auth");
}

function lockStemForGroupAuth(groupId: string): string {
  return createHash("sha256").update(`group-auth:${groupId.trim()}`).digest("hex").slice(0, 32);
}

/**
 * T52: group-level auth lock. Lock order vs task control: **auth → task** (never reverse).
 * Do not hold while awaiting external HTTP.
 */
export async function withGroupAuthLock<T>(params: {
  groupId: string;
  groupRootDir?: string;
  cfg?: ReturnType<typeof loadConfig>;
  fn: () => T | Promise<T>;
}): Promise<T> {
  const groupRootDir =
    params.groupRootDir ?? createWorkspaceCollaborationStores(params.cfg).groupRootDir;
  const dir = groupAuthLockDir({ groupId: params.groupId, groupRootDir });
  fsSync.mkdirSync(dir, { recursive: true });
  return withRoundLock(dir, lockStemForGroupAuth(params.groupId), params.fn);
}

export type GroupOperatingStateWriteKind = "business" | "auth";

/**
 * Authorization surface protected on business OS writes (T53 AUTH-3).
 * Auth checks also read governance owner / admin / coordinator — not only memberRoleMap.
 */
export type OperatingStateAuthSurface = {
  authEpoch: number;
  memberRoleMap: GatewayCollaborationGroupOperatingState["memberRoleMap"];
  governance: {
    ownerUserId?: string | null;
    adminUserIds: string[];
    coordinatorBotId?: string | null;
  };
};

function normalizeAuthMemberRoleMap(
  rows: GatewayCollaborationGroupOperatingState["memberRoleMap"] | null | undefined,
): GatewayCollaborationGroupOperatingState["memberRoleMap"] {
  return (rows ?? []).map((row) => ({
    memberId: row.memberId,
    memberKind: row.memberKind,
    label: row.label ?? null,
    governanceRole: row.governanceRole,
    collaborationRole: row.collaborationRole ?? null,
    status: row.status,
  }));
}

function normalizeAuthAdminUserIds(ids: string[] | null | undefined): string[] {
  return [...(ids ?? [])].map((id) => String(id)).toSorted();
}

/** Read the durable authorization fields (+ version) from an OS snapshot. */
export function readOperatingStateAuthSurface(
  state: (GatewayCollaborationGroupOperatingState & { authEpoch?: number }) | null | undefined,
): OperatingStateAuthSurface | null {
  if (!state) {
    return null;
  }
  return {
    authEpoch: readOperatingStateAuthEpoch(state),
    memberRoleMap: normalizeAuthMemberRoleMap(state.memberRoleMap),
    governance: {
      ownerUserId: state.governance?.ownerUserId ?? null,
      adminUserIds: [...(state.governance?.adminUserIds ?? [])],
      coordinatorBotId: state.governance?.coordinatorBotId ?? null,
    },
  };
}

/** Compare authorization *content* (not authEpoch). Used for same-epoch auth idempotency. */
export function operatingStateAuthContentEqual(
  a: OperatingStateAuthSurface | null | undefined,
  b: OperatingStateAuthSurface | null | undefined,
): boolean {
  if (!a || !b) {
    return a === b;
  }
  if ((a.governance.ownerUserId ?? null) !== (b.governance.ownerUserId ?? null)) {
    return false;
  }
  if ((a.governance.coordinatorBotId ?? null) !== (b.governance.coordinatorBotId ?? null)) {
    return false;
  }
  const aAdmins = normalizeAuthAdminUserIds(a.governance.adminUserIds);
  const bAdmins = normalizeAuthAdminUserIds(b.governance.adminUserIds);
  if (aAdmins.length !== bAdmins.length || aAdmins.some((id, i) => id !== bAdmins[i])) {
    return false;
  }
  const aMap = normalizeAuthMemberRoleMap(a.memberRoleMap);
  const bMap = normalizeAuthMemberRoleMap(b.memberRoleMap);
  if (aMap.length !== bMap.length) {
    return false;
  }
  const rank = (row: (typeof aMap)[number]) =>
    `${row.memberId}\0${row.memberKind}\0${row.governanceRole}\0${row.status}\0${row.collaborationRole ?? ""}`;
  const aSorted = [...aMap].toSorted((x, y) => rank(x).localeCompare(rank(y)));
  const bSorted = [...bMap].toSorted((x, y) => rank(x).localeCompare(rank(y)));
  return aSorted.every((row, i) => rank(row) === rank(bSorted[i]));
}

function applyLiveAuthSurfaceToIncoming(
  incoming: GatewayCollaborationGroupOperatingState & { authEpoch?: number },
  live: GatewayCollaborationGroupOperatingState & { authEpoch?: number },
): GatewayCollaborationGroupOperatingState & { authEpoch: number } {
  return {
    ...incoming,
    authEpoch: readOperatingStateAuthEpoch(live),
    memberRoleMap: live.memberRoleMap,
    governance: {
      ...incoming.governance,
      ownerUserId: live.governance?.ownerUserId,
      adminUserIds: [...(live.governance?.adminUserIds ?? [])],
      coordinatorBotId: live.governance?.coordinatorBotId,
    },
  };
}

/**
 * Merge policy for OS writes (T52/T53):
 * - auth: must not roll back authEpoch; same-epoch writes must be content-idempotent
 *   (else refuse — bump via dedicated auth helper under lock)
 * - business: **always** preserve live authorization fields + version (memberRoleMap,
 *   governance owner/admin/coordinator, authEpoch). Do not infer intent from missing epoch.
 */
export function mergeOperatingStateAuthPolicy(params: {
  live: GatewayCollaborationGroupOperatingState | null;
  incoming: GatewayCollaborationGroupOperatingState & { authEpoch?: number };
  writeKind: GroupOperatingStateWriteKind;
}): GatewayCollaborationGroupOperatingState & { authEpoch: number } {
  const live = params.live;
  const incoming = params.incoming;
  const liveEpoch = readOperatingStateAuthEpoch(live);
  const rawIncoming = (incoming as { authEpoch?: unknown }).authEpoch;
  const hasIncomingEpoch = typeof rawIncoming === "number";

  if (params.writeKind === "auth") {
    if (hasIncomingEpoch && (!Number.isFinite(rawIncoming) || rawIncoming < 0)) {
      throw new Error(`invalid authEpoch for auth write: ${String(rawIncoming)}`);
    }
    const incomingEpoch = readOperatingStateAuthEpoch(incoming);
    if (incomingEpoch < liveEpoch) {
      throw new Error(`auth write would roll back authEpoch ${liveEpoch} → ${incomingEpoch}`);
    }
    if (incomingEpoch === liveEpoch && live) {
      const liveSurface = readOperatingStateAuthSurface(live);
      const incomingSurface = readOperatingStateAuthSurface({
        ...incoming,
        authEpoch: incomingEpoch,
      });
      if (!operatingStateAuthContentEqual(liveSurface, incomingSurface)) {
        throw new Error(
          `auth write at same authEpoch ${liveEpoch} would change authorization content without bump`,
        );
      }
    }
    return { ...incoming, authEpoch: incomingEpoch };
  }

  // business — authorization is not inferred from missing/present epoch.
  if (!live) {
    const epoch = hasIncomingEpoch ? readOperatingStateAuthEpoch(incoming) : 0;
    return { ...incoming, authEpoch: epoch };
  }
  return applyLiveAuthSurfaceToIncoming(incoming, live);
}

export async function readGroupOperatingState(params: {
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupId: string;
  baseDir?: string;
}) {
  return await params.fileStore.readGroupFile<GatewayCollaborationGroupOperatingState>({
    groupId: params.groupId,
    filename: GROUP_OPERATING_STATE_FILENAME,
    baseDir: params.baseDir,
  });
}

async function persistGroupOperatingStateUnlocked(params: {
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupId: string;
  state: GatewayCollaborationGroupOperatingState;
  baseDir?: string;
}): Promise<void> {
  await params.fileStore.writeGroupFile({
    groupId: params.groupId,
    filename: GROUP_OPERATING_STATE_FILENAME,
    data: params.state,
    baseDir: params.baseDir,
  });
}

/**
 * Resolve the group-root used for the OS auth lock.
 *
 * Priority when a single coherent root is supplied: baseDir → groupRootDir →
 * fileStore.primaryGroupRootDir → cfg-derived stores.
 *
 * Boundary (T54): `path.resolve` normalizes `.` / `..` / separators only — it does
 * **not** collapse symlink / bind-mount physical aliases. When more than one
 * explicit root source is provided and the resolved strings disagree, refuse
 * rather than silently locking a different tree than the OS file. Do not read
 * this as "any same-inode OS shares one lock".
 */
export function resolveOperatingStateAuthLockRoot(params: {
  baseDir?: string;
  groupRootDir?: string;
  fileStore?: ReturnType<typeof createGroupFileStore>;
  cfg?: ReturnType<typeof loadConfig>;
}): string {
  const sources: Array<{ label: string; root: string }> = [];
  if (typeof params.baseDir === "string" && params.baseDir.trim()) {
    sources.push({ label: "baseDir", root: path.resolve(params.baseDir) });
  }
  if (typeof params.groupRootDir === "string" && params.groupRootDir.trim()) {
    sources.push({ label: "groupRootDir", root: path.resolve(params.groupRootDir) });
  }
  const fromStore = params.fileStore?.primaryGroupRootDir;
  if (typeof fromStore === "string" && fromStore.trim()) {
    sources.push({ label: "fileStore.primaryGroupRootDir", root: path.resolve(fromStore) });
  }
  if (sources.length === 0) {
    return createWorkspaceCollaborationStores(params.cfg).groupRootDir;
  }
  const unique = [...new Set(sources.map((entry) => entry.root))];
  if (unique.length > 1) {
    const detail = sources.map((entry) => `${entry.label}=${entry.root}`).join("; ");
    throw new Error(
      `operating-state auth lock root conflict (path.resolve strings differ; symlink aliases are not unified): ${detail}`,
    );
  }
  return unique[0];
}

/** Full auth-lock directory for a group OS writer (same physical OS ⇒ same lock). */
export function resolveGroupOperatingStateAuthLockDir(params: {
  groupId: string;
  baseDir?: string;
  groupRootDir?: string;
  fileStore?: ReturnType<typeof createGroupFileStore>;
  cfg?: ReturnType<typeof loadConfig>;
}): string {
  return groupAuthLockDir({
    groupId: params.groupId,
    groupRootDir: resolveOperatingStateAuthLockRoot(params),
  });
}

/** Persisted JSON facts; observation timestamps do not create revisions. */
function sameOperatingFacts(
  left: GatewayCollaborationGroupOperatingState,
  right: GatewayCollaborationGroupOperatingState,
): boolean {
  const facts = (state: GatewayCollaborationGroupOperatingState) => ({
    ...state,
    updatedAtMs: undefined,
  });
  return isDeepStrictEqual(
    JSON.parse(JSON.stringify(facts(left))),
    JSON.parse(JSON.stringify(facts(right))),
  );
}

/**
 * T52/T53: all OS writers converge here. Under group auth lock: re-read live, apply
 * auth merge policy, then persist. Auth-intent writers pass writeKind:"auth".
 * Callers already holding withGroupAuthLock must set alreadyHoldingAuthLock.
 * Lock directory tracks the physical OS root (baseDir / fileStore / cfg).
 */
export async function writeGroupOperatingState(params: {
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupId: string;
  state: GatewayCollaborationGroupOperatingState;
  baseDir?: string;
  /** Explicit group root for auth lock (defaults via fileStore / cfg). */
  groupRootDir?: string;
  cfg?: ReturnType<typeof loadConfig>;
  /** Default "business" — preserves auth fields/version against stale rollback. */
  writeKind?: GroupOperatingStateWriteKind;
  /** Caller already holds withGroupAuthLock for this group (non-reentrant lock). */
  alreadyHoldingAuthLock?: boolean;
  /** Test-only: after live re-read under lock, before merge/write. */
  _testAfterLiveReadBarrier?: () => Promise<void>;
}): Promise<GatewayCollaborationGroupOperatingState & { authEpoch: number }> {
  const writeKind = params.writeKind ?? "business";
  const run = async () => {
    const live = await readGroupOperatingState({
      fileStore: params.fileStore,
      groupId: params.groupId,
      baseDir: params.baseDir,
    });
    if (params._testAfterLiveReadBarrier) {
      await params._testAfterLiveReadBarrier();
    }
    const merged = mergeOperatingStateAuthPolicy({
      live,
      incoming: params.state as GatewayCollaborationGroupOperatingState & { authEpoch?: number },
      writeKind,
    });
    if (live && sameOperatingFacts(live, merged)) {
      return live as GatewayCollaborationGroupOperatingState & { authEpoch: number };
    }
    await persistGroupOperatingStateUnlocked({
      fileStore: params.fileStore,
      groupId: params.groupId,
      state: merged,
      baseDir: params.baseDir,
    });
    return merged;
  };
  if (params.alreadyHoldingAuthLock) {
    return await run();
  }
  const groupRootDir = resolveOperatingStateAuthLockRoot({
    baseDir: params.baseDir,
    groupRootDir: params.groupRootDir,
    fileStore: params.fileStore,
    cfg: params.cfg,
  });
  return await withGroupAuthLock({
    groupId: params.groupId,
    groupRootDir,
    cfg: params.cfg,
    fn: run,
  });
}

/**
 * W1: project durable OS authorization fields from profile + members.
 * Omits removed/revoked members so leave/revoke cannot linger as mapped.
 * Used by sync (lock-internal reproject) and production roster auth CAS.
 */
export function projectOperatingStateAuthFromRoster(params: {
  profile:
    | {
        ownerUserId?: string | null;
        coordinatorBotId?: string | null;
        finalDecisionPolicy?: GatewayCollaborationGroupOperatingState["governance"]["finalDecisionPolicy"];
      }
    | null
    | undefined;
  members: CollaborationMember[];
}): {
  memberRoleMap: GatewayCollaborationGroupOperatingState["memberRoleMap"];
  governance: {
    ownerUserId: string | null;
    adminUserIds: string[];
    coordinatorBotId: string | null;
    finalDecisionPolicy: GatewayCollaborationGroupOperatingState["governance"]["finalDecisionPolicy"];
  };
} {
  const adminUserIds = params.members
    .filter(
      (member) =>
        member.memberKind === "human" &&
        member.governanceRole === "admin" &&
        member.status !== "removed" &&
        member.status !== "revoked",
    )
    .map((member) => normalizeValue(member.userId))
    .filter(Boolean) as string[];
  return {
    memberRoleMap: params.members
      .filter((member) => member.status !== "removed" && member.status !== "revoked")
      .map((member) => ({
        memberId: member.memberId,
        memberKind: member.memberKind,
        label:
          normalizeValue(member.name) ??
          normalizeValue(member.userId) ??
          normalizeValue(member.agentId) ??
          null,
        governanceRole: member.governanceRole,
        collaborationRole: member.collaborationRole ?? null,
        status: member.status,
      })),
    governance: {
      ownerUserId: normalizeValue(params.profile?.ownerUserId) ?? null,
      adminUserIds,
      coordinatorBotId: normalizeValue(params.profile?.coordinatorBotId) ?? null,
      finalDecisionPolicy: params.profile?.finalDecisionPolicy ?? null,
    },
  };
}

/**
 * T54: persist a sync-built OS draft under the unified auth lock.
 * - Business fields always come from `desired`.
 * - Authorization surface is taken from trusted profile/members projection in
 *   `desired`. When it differs from live, write as auth and bump authEpoch.
 * - Returns the **actually persisted** state (never the pre-merge draft).
 */
export async function commitSyncedGroupOperatingState(params: {
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupId: string;
  desired: GatewayCollaborationGroupOperatingState & { authEpoch?: number };
  baseDir?: string;
  groupRootDir?: string;
  cfg?: ReturnType<typeof loadConfig>;
  /**
   * W1: when set, re-read profile+members **under the auth lock** and reproject
   * the authorization surface before compare/write. Closes lock-external stale
   * member snapshots that would otherwise re-grant after a concurrent revoke.
   */
  groupStorage?: OpenBotGroupStorage;
}): Promise<GatewayCollaborationGroupOperatingState & { authEpoch: number }> {
  const groupRootDir = resolveOperatingStateAuthLockRoot({
    baseDir: params.baseDir,
    groupRootDir: params.groupRootDir,
    fileStore: params.fileStore,
    cfg: params.cfg,
  });
  return withGroupAuthLock({
    groupId: params.groupId,
    groupRootDir,
    cfg: params.cfg,
    fn: async () => {
      const live = await readGroupOperatingState({
        fileStore: params.fileStore,
        groupId: params.groupId,
        baseDir: params.baseDir,
      });
      let desired = params.desired;
      if (params.groupStorage) {
        const [profile, members] = await Promise.all([
          params.groupStorage.readProfile(params.groupId),
          params.groupStorage.readMembers(params.groupId),
        ]);
        const projected = projectOperatingStateAuthFromRoster({ profile, members });
        desired = {
          ...params.desired,
          memberRoleMap: projected.memberRoleMap,
          governance: {
            ...params.desired.governance,
            ownerUserId: projected.governance.ownerUserId,
            adminUserIds: projected.governance.adminUserIds,
            coordinatorBotId: projected.governance.coordinatorBotId,
            finalDecisionPolicy:
              params.desired.governance?.finalDecisionPolicy ??
              projected.governance.finalDecisionPolicy,
          },
        };
      }
      // Observing/reprojecting the same facts is not a business revision.
      // Keep the existing version so an in-flight interpretation is not made
      // stale by its own snapshot refresh. Real auth/policy/task changes below
      // still persist under the same lock and advance the observable version.
      if (live && sameOperatingFacts(live, desired)) {
        return live as GatewayCollaborationGroupOperatingState & { authEpoch: number };
      }
      const desiredSurface = readOperatingStateAuthSurface(desired);
      const liveSurface = readOperatingStateAuthSurface(live);
      const authContentChanged =
        !live || !operatingStateAuthContentEqual(desiredSurface, liveSurface);
      if (!live) {
        return await writeGroupOperatingState({
          fileStore: params.fileStore,
          groupId: params.groupId,
          state: desired,
          baseDir: params.baseDir,
          groupRootDir,
          cfg: params.cfg,
          writeKind: "business",
          alreadyHoldingAuthLock: true,
        });
      }
      if (authContentChanged) {
        const nextEpoch = readOperatingStateAuthEpoch(live) + 1;
        const authIncoming: GatewayCollaborationGroupOperatingState & { authEpoch: number } = {
          ...desired,
          authEpoch: nextEpoch,
          memberRoleMap: desired.memberRoleMap,
          governance: {
            ...desired.governance,
            ownerUserId: desired.governance?.ownerUserId ?? null,
            adminUserIds: [...(desired.governance?.adminUserIds ?? [])],
            coordinatorBotId: desired.governance?.coordinatorBotId ?? null,
          },
        };
        return await writeGroupOperatingState({
          fileStore: params.fileStore,
          groupId: params.groupId,
          state: authIncoming,
          baseDir: params.baseDir,
          groupRootDir,
          cfg: params.cfg,
          writeKind: "auth",
          alreadyHoldingAuthLock: true,
        });
      }
      return await writeGroupOperatingState({
        fileStore: params.fileStore,
        groupId: params.groupId,
        state: desired,
        baseDir: params.baseDir,
        groupRootDir,
        cfg: params.cfg,
        writeKind: "business",
        alreadyHoldingAuthLock: true,
      });
    },
  });
}

export async function syncGroupOperatingState(params: {
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupStorage: OpenBotGroupStorage;
  metadataStorage: OpenBotMetadataStorage;
  memoryStorage: OpenBotMemoryStorage;
  learningStorage: OpenBotLearningStorage;
  objectStorage: OpenBotObjectStorage;
  groupId: string;
  titleFallback?: string | null;
  /**
   * Explicit focus switch (e.g. activate of task B). When set, beats a stale OS
   * currentTaskId that is still active. Omit for background/ordinary sync so
   * old-task updates cannot steal focus.
   */
  preferredTaskId?: string | null;
}) {
  const [
    profile,
    members,
    memories,
    capsules,
    tasks,
    deliverables,
    reviews,
    decisions,
    existingState,
  ] = await Promise.all([
    params.groupStorage.readProfile(params.groupId),
    params.groupStorage.readMembers(params.groupId),
    params.memoryStorage.readMemories<GroupBootstrapMemoryRecord | Record<string, unknown>>(
      params.groupId,
    ),
    params.learningStorage.readCapsules(params.groupId),
    params.objectStorage.listObjects<Task>(params.groupId, "task"),
    params.objectStorage.listObjects<Deliverable>(params.groupId, "deliverable"),
    params.objectStorage.listObjects<Review>(params.groupId, "review"),
    params.objectStorage.listObjects<Decision>(params.groupId, "decision"),
    readGroupOperatingState({ fileStore: params.fileStore, groupId: params.groupId }),
  ]);

  const title =
    normalizeValue(profile?.displayName) ??
    normalizeValue(profile?.groupCode) ??
    normalizeValue(params.titleFallback) ??
    params.groupId;
  const review = selectActiveReview(reviews);
  const decision = selectActiveDecision(decisions);
  // Bind the formal deliverable to system task authority. Explicit
  // preferredTaskId (activate / switch) beats a stale OS currentTaskId while
  // that old task is still active. Ordinary/background sync omits the override
  // so an old-task update cannot steal focus.
  const explicitPreferred =
    params.preferredTaskId !== undefined ? params.preferredTaskId : undefined;
  const deliverableBinding = projectOperatingDeliverableBinding({
    tasks,
    deliverables,
    decision,
    review,
    preferredTaskId:
      explicitPreferred !== undefined
        ? explicitPreferred
        : (existingState?.activeContext?.currentTaskId ?? null),
  });
  const task = deliverableBinding.task;
  const deliverable = deliverableBinding.deliverable;
  const phase = deliverableBinding.phase;
  const bootstrapMemory = memories.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      "memoryId" in entry &&
      typeof (entry as { memoryId?: unknown }).memoryId === "string" &&
      "kind" in entry &&
      (entry as { kind?: unknown }).kind === "group_bootstrap",
  ) as GroupBootstrapMemoryRecord | undefined;
  const sortedCapsules = [...capsules].toSorted(
    (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
  );
  const charterCapsule =
    sortedCapsules.find((entry) => entry.metadata?.origin === "group_bootstrap") ??
    sortedCapsules[0];
  const activeMission = normalizeValue(profile?.currentMission);
  const activeContextUpdatedAt = Math.max(
    task?.updatedAtMs ?? 0,
    deliverable?.updatedAtMs ?? 0,
    review?.updatedAtMs ?? 0,
    decision?.updatedAt ?? 0,
    bootstrapMemory?.updatedAtMs ?? 0,
  );
  const projectedAuth = projectOperatingStateAuthFromRoster({ profile, members });
  const state = (await import("./policy-revision-carry.js")).carryPolicyRevision(existingState, {
    groupId: params.groupId,
    groupProfile: {
      displayName: title,
      visibilityScope: normalizeValue(profile?.visibilityScope) ?? null,
      groupType: normalizeValue(profile?.groupType) ?? null,
      lifecycleStatus: normalizeValue(profile?.lifecycleStatus) ?? null,
      purpose: normalizeValue(profile?.purpose) ?? null,
      currentMission: activeMission,
      discussionScope: normalizeValue(profile?.purpose) ?? null,
      expectedOutputs: ["task", "review", "decision", "deliverable", "capsule"],
      // New-group seed prefers task_driven; existing profiles keep their mode.
      collaborationMode:
        normalizeValue(profile?.collaborationMode) ??
        existingState?.groupProfile.collaborationMode ??
        (existingState ? null : "task_driven"),
      successCriteria: normalizeStringList(profile?.successCriteria),
    },
    governance: {
      ownerUserId: projectedAuth.governance.ownerUserId,
      adminUserIds: projectedAuth.governance.adminUserIds,
      coordinatorBotId: projectedAuth.governance.coordinatorBotId,
      finalDecisionPolicy: profile?.finalDecisionPolicy ?? null,
    },
    collaborationPolicy: {
      // New-group seed only — existingState.collaborationPolicy wins via spread below.
      humanStartsNewRound: true,
      mentionBotMustRespond: true,
      mentionHumanNotifiesOnly: true,
      openDiscussionWithoutMention: L1_DEFAULT.openDiscussionWithoutMention,
      allowSupplementAfterPrimary: true,
      maxVisibleBotRepliesPerRound: L1_DEFAULT.maxVisibleBotRepliesPerRound,
      replyLanguage: "zh",
      botMaySelfAdvanceWithoutHuman: false,
      entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      ...existingState?.collaborationPolicy,
    },
    // Auth surface: omit removed/revoked so leave/revoke cannot linger as mapped.
    memberRoleMap: projectedAuth.memberRoleMap,
    activeContext: {
      currentOperatingPhase: phase,
      currentMission: activeMission,
      currentTaskId: task?.taskId ?? null,
      currentReviewId: review?.reviewId ?? null,
      currentDecisionId: decision?.decisionId ?? null,
      currentDeliverableId: deliverableBinding.currentDeliverableId,
      waitingForHuman: phase !== "explore",
      summary: summarizeActiveContext({
        phase,
        currentMission: activeMission,
        taskId: task?.taskId ?? null,
        reviewId: review?.reviewId ?? null,
        decisionId: decision?.decisionId ?? null,
        deliverableId: deliverableBinding.currentDeliverableId,
        noFormalDeliverableForCurrentTask: deliverableBinding.noFormalDeliverable,
      }),
      updatedAtMs: activeContextUpdatedAt || existingState?.activeContext.updatedAtMs || Date.now(),
    },
    onboardingStatus: {
      initialized: Boolean(bootstrapMemory || charterCapsule),
      bootstrappedAtMs: bootstrapMemory?.createdAtMs ?? charterCapsule?.createdAt ?? null,
      bootstrapMemoryId: bootstrapMemory?.memoryId ?? null,
      charterCapsuleId: charterCapsule?.capsuleId ?? null,
    },
    // Bootstrap ≠ Growth：技术初始化状态（替代 onboardingStatus，与其同源）。
    bootstrapStatus: {
      initialized: Boolean(bootstrapMemory || charterCapsule),
      bootstrappedAtMs: bootstrapMemory?.createdAtMs ?? charterCapsule?.createdAt ?? null,
      bootstrapMemoryId: bootstrapMemory?.memoryId ?? null,
      charterCapsuleId: charterCapsule?.capsuleId ?? null,
    },
    // 产品成长状态：保留既有（含 recompute 结果），不存在则初始化 birth。
    growthStatus:
      existingState?.growthStatus ?? createInitialGrowthStatus({ kind: "group", atMs: Date.now() }),
    groupMemoryRefs: {
      bootstrapMemoryId: bootstrapMemory?.memoryId ?? null,
      charterCapsuleId: charterCapsule?.capsuleId ?? null,
      latestCapsuleIds: sortedCapsules.slice(0, 5).map((entry) => entry.capsuleId),
    },
    updatedAtMs: Date.now(),
  });
  // T54: business vs auth split under unified lock; return persisted result (not draft).
  const persisted = await commitSyncedGroupOperatingState({
    fileStore: params.fileStore,
    groupId: params.groupId,
    desired: state,
    groupStorage: params.groupStorage,
  });
  const { syncGroupCharter } = await import("./group-charter.js");
  const { charter, changed: charterChangedFlag } = await syncGroupCharter({
    fileStore: params.fileStore,
    groupStorage: params.groupStorage,
    groupId: params.groupId,
    operatingState: persisted,
  });
  const previousPhase = existingState?.activeContext.currentOperatingPhase;
  if (charterChangedFlag || previousPhase !== phase) {
    const { appendCollaborationGovernanceRecord } =
      await import("../collaboration-ledger/writer.js");
    // P0.1 Q2: pass trusted tenant so managed runtimeNamespace fail-closed works at N2.
    const tenantId = resolveCollaborationGroupTenantId(params.groupId);
    if (charterChangedFlag) {
      await appendCollaborationGovernanceRecord({
        groupId: params.groupId,
        event: "charter_sync",
        lifecycleStatus: charter.lifecycleStatus,
        summary: `Charter synced for ${charter.displayName}`,
        phase,
        ...(tenantId ? { tenantId } : {}),
      });
    }
    if (previousPhase && previousPhase !== phase) {
      await appendCollaborationGovernanceRecord({
        groupId: params.groupId,
        event: "phase_change",
        lifecycleStatus: charter.lifecycleStatus,
        summary: `Operating phase ${previousPhase} → ${phase}`,
        phase,
        previousPhase,
        ...(tenantId ? { tenantId } : {}),
      });
    }
  }
  return persisted;
}

export function buildMembersFromEmbeddedProfile(
  profile: StoredGroupProfile | null,
  existingMembers?: CollaborationMember[] | null,
): CollaborationMember[] {
  const updatedAtMs = profile?.updatedAtMs ?? Date.now();
  const removedByMemberId = new Map<string, CollaborationMember>();
  for (const member of existingMembers ?? []) {
    if (member.status === "removed") {
      removedByMemberId.set(member.memberId, member);
    }
  }
  const embeddedMembers =
    profile &&
    typeof profile === "object" &&
    "members" in profile &&
    profile.members &&
    typeof profile.members === "object"
      ? (profile.members as {
          humans?: Array<{ userId?: string; name?: string; role?: string }>;
          bots?: Array<{ agentId?: string; name?: string; role?: string }>;
        })
      : null;
  const humans = (embeddedMembers?.humans ?? [])
    .map((entry) => {
      const userId = normalizeValue(entry.userId);
      if (!userId) {
        return null;
      }
      return {
        memberId: userId,
        memberKind: "human",
        userId,
        ...(normalizeValue(entry.name) ? { name: normalizeValue(entry.name) as string } : {}),
        governanceRole: entry.role === "owner" ? "owner" : "member",
        collaborationRole: "contributor",
        status: "active",
        visibility: "visible",
        updatedAtMs,
      } satisfies CollaborationMember;
    })
    .filter(Boolean) as CollaborationMember[];
  const bots = (embeddedMembers?.bots ?? [])
    .map((entry) => {
      const agentId = normalizeValue(entry.agentId);
      if (!agentId) {
        return null;
      }
      const removed = removedByMemberId.get(agentId);
      if (removed) {
        return {
          ...removed,
          ...(normalizeValue(entry.name) ? { name: normalizeValue(entry.name) as string } : {}),
          updatedAtMs: removed.updatedAtMs ?? updatedAtMs,
        } satisfies CollaborationMember;
      }
      return {
        memberId: agentId,
        memberKind: "bot",
        agentId,
        ...(normalizeValue(entry.name) ? { name: normalizeValue(entry.name) as string } : {}),
        governanceRole: "member",
        collaborationRole: "contributor",
        status: "active",
        visibility: "visible",
        updatedAtMs,
      } satisfies CollaborationMember;
    })
    .filter(Boolean) as CollaborationMember[];
  return [...humans, ...bots];
}

export function resolveStoredProfileGroupId(profile: StoredGroupProfile) {
  return normalizeValue(profile.groupId) ?? normalizeValue(profile.id);
}

export function isStoredGroupProfile(value: unknown): value is StoredGroupProfile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<StoredGroupProfile>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAtMs === "number" &&
    typeof candidate.updatedAtMs === "number"
  );
}

function isRuntimeGroupProfile(
  profile: GroupProfile | StoredGroupProfile,
): profile is GroupProfile {
  return (
    typeof (profile as GroupProfile).groupId === "string" &&
    typeof (profile as GroupProfile).groupCode === "string"
  );
}

export function toStoredGroupProfile(
  profile: GroupProfile | StoredGroupProfile | null | undefined,
): StoredGroupProfile | null {
  if (!profile) {
    return null;
  }
  if (isStoredGroupProfile(profile)) {
    return profile;
  }
  const runtime = profile;
  const now = Date.now();
  return {
    id: runtime.groupId,
    name: runtime.displayName ?? runtime.groupCode,
    groupId: runtime.groupId,
    groupCode: runtime.groupCode,
    displayName: runtime.displayName,
    avatar: runtime.avatar,
    visibilityScope: runtime.visibilityScope,
    ownerUserId: runtime.ownerUserId,
    coordinatorBotId: runtime.coordinatorBotId,
    purpose: runtime.purpose,
    currentMission: runtime.currentMission,
    successCriteria: runtime.successCriteria,
    collaborationMode: runtime.collaborationMode,
    workspacePath: runtime.workspacePath,
    finalDecisionPolicy: runtime.finalDecisionPolicy,
    createdAtMs: runtime.createdAtMs ?? now,
    updatedAtMs: runtime.updatedAtMs ?? now,
  };
}

export function toGroupProfile(
  profile: GroupProfile | StoredGroupProfile | null | undefined,
): GroupProfile | null {
  if (!profile) {
    return null;
  }
  if (isRuntimeGroupProfile(profile)) {
    return profile;
  }
  const stored = profile;
  const groupId = resolveStoredProfileGroupId(stored);
  if (!groupId) {
    return null;
  }
  const groupCode = normalizeValue(stored.groupCode) ?? groupId;
  return {
    groupId,
    groupCode,
    displayName: normalizeValue(stored.displayName) ?? normalizeValue(stored.name) ?? groupCode,
    ...(normalizeValue(stored.avatar) ? { avatar: normalizeValue(stored.avatar) as string } : {}),
    ...(normalizeValue(stored.visibilityScope)
      ? { visibilityScope: stored.visibilityScope as GroupProfile["visibilityScope"] }
      : {}),
    ...(normalizeValue(stored.ownerUserId)
      ? { ownerUserId: normalizeValue(stored.ownerUserId) as string }
      : {}),
    ...(normalizeValue(stored.coordinatorBotId)
      ? { coordinatorBotId: normalizeValue(stored.coordinatorBotId) as string }
      : {}),
    ...(normalizeValue(stored.purpose)
      ? { purpose: normalizeValue(stored.purpose) as string }
      : {}),
    ...(normalizeValue(stored.currentMission)
      ? { currentMission: normalizeValue(stored.currentMission) as string }
      : {}),
    ...(stored.successCriteria ? { successCriteria: stored.successCriteria } : {}),
    ...(normalizeValue(stored.collaborationMode)
      ? { collaborationMode: stored.collaborationMode as GroupProfile["collaborationMode"] }
      : {}),
    ...(normalizeValue(stored.workspacePath)
      ? { workspacePath: normalizeValue(stored.workspacePath) as string }
      : {}),
    ...(stored.finalDecisionPolicy ? { finalDecisionPolicy: stored.finalDecisionPolicy } : {}),
    createdAtMs: stored.createdAtMs,
    updatedAtMs: stored.updatedAtMs,
  };
}

export function unwrapStoredGroupProfile(
  value: StoredGroupProfile | { profile?: StoredGroupProfile | null } | null,
): StoredGroupProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  if ("profile" in value) {
    return isStoredGroupProfile(value.profile) ? value.profile : null;
  }
  return isStoredGroupProfile(value) ? value : null;
}

export function coerceManagedMirrorProfile(
  value: unknown,
  groupId: string,
): StoredGroupProfile | null {
  const stored = unwrapStoredGroupProfile(
    value as StoredGroupProfile | { profile?: StoredGroupProfile | null } | null,
  );
  if (stored) {
    return stored;
  }
  const candidate =
    value && typeof value === "object" && "profile" in value
      ? (value as { profile?: unknown }).profile
      : value;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const resolvedGroupId =
    normalizeValue(record.groupId as string | null | undefined) ??
    normalizeValue(record.id as string | null | undefined) ??
    groupId;
  const displayName =
    normalizeValue(record.displayName as string | null | undefined) ??
    normalizeValue(record.name as string | null | undefined) ??
    normalizeValue(record.groupCode as string | null | undefined) ??
    resolvedGroupId;
  if (!resolvedGroupId) {
    return null;
  }
  const now = Date.now();
  const createdAtMs =
    typeof record.createdAtMs === "number" && Number.isFinite(record.createdAtMs)
      ? record.createdAtMs
      : now;
  const updatedAtMs =
    typeof record.updatedAtMs === "number" && Number.isFinite(record.updatedAtMs)
      ? record.updatedAtMs
      : now;
  return {
    ...record,
    id: resolvedGroupId,
    groupId: resolvedGroupId,
    name: displayName,
    displayName,
    createdAtMs,
    updatedAtMs,
  } as StoredGroupProfile;
}

export function createWorkspaceGroupStoreFunctions(
  fileStore: ReturnType<typeof createGroupFileStore>,
  stateDir: string,
  primaryGroupRootDir: string,
) {
  // Profile/members persist only to the trusted group root.
  // {stateDir}/spaces/{groupId} is leftover read-only hydrate, not a live write root.
  return {
    loadGroupProfile: async (
      groupId: string,
      baseDir?: string,
    ): Promise<StoredGroupProfile | null> => {
      const profile = await fileStore.readGroupFile<StoredGroupProfile>({
        groupId,
        filename: "profile.json",
        baseDir,
      });
      return isStoredGroupProfile(profile) ? profile : null;
    },
    saveGroupProfile: async (space: StoredGroupProfile, baseDir?: string) => {
      const groupId = resolveStoredProfileGroupId(space);
      if (!groupId) {
        throw new Error("group profile is missing groupId");
      }
      const workspacePath =
        normalizeValue(space.workspacePath) ??
        resolveGroupWorkspacePath(baseDir ?? primaryGroupRootDir, groupId);
      const nextSpace = {
        ...space,
        workspacePath,
      };
      await fileStore.writeGroupFile({
        groupId,
        filename: "profile.json",
        data: nextSpace,
        baseDir,
      });
    },
    loadGroupMembers: async (groupId: string, baseDir?: string) => {
      const membersFromFile = parseStoredGroupMembersFile(
        await fileStore.readGroupFile<
          CollaborationMember[] | { members?: CollaborationMember[] | null }
        >({
          groupId,
          filename: "members.json",
          baseDir,
        }),
      );
      if (membersFromFile != null) {
        return membersFromFile;
      }
      const profile = await fileStore.readGroupFile<StoredGroupProfile>({
        groupId,
        filename: "profile.json",
        baseDir,
      });
      const managedMembersRaw = await readManagedSpaceFile<
        CollaborationMember[] | { members?: CollaborationMember[] | null }
      >(stateDir, groupId, "members.json");
      const managedMembers = Array.isArray(managedMembersRaw)
        ? managedMembersRaw
        : Array.isArray(managedMembersRaw?.members)
          ? managedMembersRaw.members
          : null;
      const embeddedMembers = buildMembersFromEmbeddedProfile(
        isStoredGroupProfile(profile) ? profile : coerceManagedMirrorProfile(profile, groupId),
        managedMembers,
      );
      return embeddedMembers;
    },
    saveGroupMembers: async (groupId: string, members: CollaborationMember[], baseDir?: string) => {
      const memberSnapshot = buildProfileMemberSnapshot(members);
      const updatedAtMs = Date.now();
      const runtimeProfileRaw = await fileStore.readGroupFile<
        StoredGroupProfile | { profile?: StoredGroupProfile | null }
      >({
        groupId,
        filename: "profile.json",
        baseDir,
      });
      const existingRuntimeProfile =
        unwrapStoredGroupProfile(runtimeProfileRaw) ??
        coerceManagedMirrorProfile(runtimeProfileRaw, groupId);
      if (existingRuntimeProfile) {
        await fileStore.writeGroupFile({
          groupId,
          filename: "profile.json",
          data: {
            ...existingRuntimeProfile,
            members: memberSnapshot,
            updatedAtMs,
          },
          baseDir,
        });
      }
      await fileStore.writeGroupFile({
        groupId,
        filename: "members.json",
        data: members,
        baseDir,
      });
    },
    loadGroupBindings: async (groupId: string, baseDir?: string) => {
      const bindings = await fileStore.readGroupFile<CollaborationBinding[]>({
        groupId,
        filename: "bindings.json",
        baseDir,
      });
      return Array.isArray(bindings) ? bindings : [];
    },
    saveGroupBindings: async (
      groupId: string,
      bindings: CollaborationBinding[],
      baseDir?: string,
    ) => {
      await fileStore.writeGroupFile({
        groupId,
        filename: "bindings.json",
        data: bindings,
        baseDir,
      });
    },
    loadGroupParticipations: async (groupId: string, baseDir?: string) => {
      const participations = await fileStore.readGroupFile<BotParticipationProfile[]>({
        groupId,
        filename: "participations.json",
        baseDir,
      });
      return Array.isArray(participations) ? participations : [];
    },
    saveGroupParticipations: async (
      groupId: string,
      participations: BotParticipationProfile[],
      baseDir?: string,
    ) => {
      await fileStore.writeGroupFile({
        groupId,
        filename: "participations.json",
        data: participations,
        baseDir,
      });
    },
  };
}

export function resolveConfiguredCollaborationWorkspaceRoot(cfg: ReturnType<typeof loadConfig>) {
  return resolveLiveCollaborationWorkspaceRoot(cfg);
}

export {
  materializeGroupCollaborationWorkspace,
  resolveGroupCollaborationPaths,
  resolveGroupPublicTranscriptPath,
  isGroupPublicTranscriptSessionFile,
} from "./collaboration-paths.js";
export type { GroupCollaborationPaths } from "./collaboration-paths.js";
export { bindGroupPublicTranscript } from "./group-public-transcript.js";
// Memory-workspace freeze P1: keep resolveAgentWorkspaceDir on inventoried line 1308.
// Do not collapse the lines above this function.
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
// freeze-pin
export function createWorkspaceCollaborationStores(cfg?: ReturnType<typeof loadConfig>) {
  const resolvedCfg = cfg ?? loadConfig();
  const workspaceDir = resolveAgentWorkspaceDir(resolvedCfg, resolveDefaultAgentId(resolvedCfg));
  return createWorkspaceCollaborationStoresForDir(resolvedCfg, workspaceDir);
}

/** Build stores for an already-resolved workspace. Do not call resolveAgentWorkspaceDir here. */
export function createWorkspaceCollaborationStoresForDir(
  cfg: ReturnType<typeof loadConfig>,
  workspaceDir: string,
) {
  const stateDir = resolveStateDir();
  const preferredWorkspaceDir = rewriteOpenclawPathToOpenbotIfPresent(workspaceDir);
  const collaborationWorkspaceRoot = rewriteOpenclawPathToOpenbotIfPresent(
    resolveConfiguredCollaborationWorkspaceRoot(cfg),
  );
  const groupRootDir = resolveCollaborationSharedGroupRoot(collaborationWorkspaceRoot);
  const fileStore = createGroupFileStore(groupRootDir);
  const groupStoreFunctions = createWorkspaceGroupStoreFunctions(fileStore, stateDir, groupRootDir);
  return {
    stateDir,
    workspaceDir: preferredWorkspaceDir,
    collaborationWorkspaceRoot,
    groupRootDir,
    fileStore,
    groupStorage: new OpenBotGroupStorage(undefined, groupStoreFunctions),
    learningStorage: new OpenBotLearningStorage(undefined, fileStore),
    memoryStorage: new OpenBotMemoryStorage(undefined, fileStore),
    metadataStorage: new OpenBotMetadataStorage(undefined, fileStore),
    objectStorage: new OpenBotObjectStorage(undefined, fileStore),
  };
}

export async function listWorkspaceCollaborationGroupIds(groupRootDir: string) {
  const rootDir = path.resolve(groupRootDir);
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const groups = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const dirPath = path.join(rootDir, entry.name);
          const profilePath = path.join(dirPath, "profile.json");
          const membersPath = path.join(dirPath, "members.json");
          const [profileStat, membersStat] = await Promise.allSettled([
            fs.stat(profilePath),
            fs.stat(membersPath),
          ]);
          const decodeName = () => {
            try {
              return decodeURIComponent(entry.name);
            } catch {
              return entry.name;
            }
          };
          if (profileStat.status === "fulfilled") {
            return decodeName();
          }
          if (membersStat.status !== "fulfilled") {
            return null;
          }
          const { value: storedMembers } = await readJsonFileWithFallback<
            CollaborationMember[] | { members?: CollaborationMember[] | null } | null
          >(membersPath, null);
          const hasSupportedMembers =
            Array.isArray(storedMembers) ||
            Boolean(
              storedMembers &&
              typeof storedMembers === "object" &&
              Array.isArray(storedMembers.members),
            );
          return hasSupportedMembers ? decodeName() : null;
        }),
    );
    return groups
      .filter((groupId): groupId is string => Boolean(groupId))
      .toSorted((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function listUserScopedCollaborationExtras(params: {
  workspaceDir: string;
  primaryGroupRootDir: string;
}): Promise<{ root: string; groupIds: string[] }> {
  const root = resolveAgentCollaborationGroupRoot(params.workspaceDir);
  if (path.resolve(root) === path.resolve(params.primaryGroupRootDir)) {
    return { root, groupIds: [] };
  }
  return { root, groupIds: await listWorkspaceCollaborationGroupIds(root) };
}

export async function readWorkspaceSpaceSnapshotFromRoot(params: {
  groupRootDir: string;
  groupId: string;
}): Promise<ReturnType<typeof buildWorkspaceSpaceSnapshot> | null> {
  const fileStore = createGroupFileStore(params.groupRootDir);
  const [profile, membersFile, operatingState] = await Promise.all([
    fileStore.readGroupFile({ groupId: params.groupId, filename: "profile.json" }),
    fileStore.readGroupFile({ groupId: params.groupId, filename: "members.json" }),
    fileStore.readGroupFile({
      groupId: params.groupId,
      filename: "operating-state.json",
    }),
  ]);
  const members =
    parseStoredGroupMembersFile(membersFile as Parameters<typeof parseStoredGroupMembersFile>[0]) ??
    [];
  const groupProfile = toGroupProfile(isStoredGroupProfile(profile) ? profile : null);
  if (!groupProfile && members.length === 0 && !operatingState) {
    return null;
  }
  return buildWorkspaceSpaceSnapshot({
    groupId: params.groupId,
    profile: groupProfile,
    members,
    operatingState: (operatingState ?? null) as Parameters<
      typeof buildWorkspaceSpaceSnapshot
    >[0]["operatingState"],
  });
}

export async function listManagedSpaceGroupIds(stateDir: string) {
  const rootDir = resolveManagedSpacesRoot(stateDir);
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const groups = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const dirPath = path.join(rootDir, entry.name);
          const profilePath = path.join(dirPath, "profile.json");
          const membersPath = path.join(dirPath, "members.json");
          const [profileStat, membersStat] = await Promise.allSettled([
            fs.stat(profilePath),
            fs.stat(membersPath),
          ]);
          if (profileStat.status === "fulfilled") {
            try {
              return decodeURIComponent(entry.name);
            } catch {
              return entry.name;
            }
          }
          if (membersStat.status !== "fulfilled") {
            return null;
          }
          const { value: managedMembers } = await readJsonFileWithFallback<
            CollaborationMember[] | { members?: CollaborationMember[] | null } | null
          >(membersPath, null);
          const hasSupportedManagedMembers =
            Array.isArray(managedMembers) ||
            Boolean(
              managedMembers &&
              typeof managedMembers === "object" &&
              Array.isArray(managedMembers.members),
            );
          if (!hasSupportedManagedMembers) {
            return null;
          }
          try {
            return decodeURIComponent(entry.name);
          } catch {
            return entry.name;
          }
        }),
    );
    return groups
      .filter((groupId): groupId is string => Boolean(groupId))
      .toSorted((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Resolve authoritative tenant for a collaboration group.
 *
 * - With `tenantId` context: look up ownership for `(tenantId, groupId)` only.
 *   Never fall through to another tenant's binding for the same groupId.
 * - Without tenant context: return the tenant only when exactly one active
 *   ownership exists for the groupId. Zero or multiple matches → null
 *   (fail-closed on cross-tenant groupId collision).
 */
export function resolveCollaborationGroupTenantId(
  groupId: string,
  tenantId?: string | null,
): string | null {
  const normalizedGroupId = normalizeValue(groupId);
  if (!normalizedGroupId) {
    return null;
  }
  const explicitTenant = normalizeValue(tenantId);
  if (explicitTenant) {
    const ownership = findActiveOwnershipRecord({
      tenantId: explicitTenant,
      subjectKind: "group",
      subjectId: normalizedGroupId,
    });
    return ownership ? explicitTenant : null;
  }

  const tenants = new Set<string>();
  for (const entry of listOwnershipRecords()) {
    if (
      entry.subjectKind !== "group" ||
      entry.subjectId !== normalizedGroupId ||
      entry.bindingStatus === "revoked"
    ) {
      continue;
    }
    const ownedTenant = normalizeValue(entry.tenantId);
    if (ownedTenant) {
      tenants.add(ownedTenant);
    }
  }
  if (tenants.size !== 1) {
    return null;
  }
  return [...tenants][0] ?? null;
}

export function buildWorkspaceSpaceSnapshot(params: {
  groupId: string;
  profile: GroupProfile | null;
  groupCapabilities?: GroupCapabilityProfile | null;
  operatingState?: GatewayCollaborationGroupOperatingState | null;
  members: CollaborationMember[];
  presence?: PresenceState[];
  taskAssignments?: TaskAssignment[];
  titleFallback?: string | null;
  workspacePath?: string | null;
  /** Explicit tenant from create/update; otherwise resolved from ownership. */
  tenantId?: string | null;
}) {
  const presenceByAgentId = new Map((params.presence ?? []).map((entry) => [entry.agentId, entry]));
  const openTasksByOwner = new Map<string, TaskAssignment[]>();
  for (const assignment of params.taskAssignments ?? []) {
    if (assignment.status === "completed" || assignment.status === "rejected") {
      continue;
    }
    const existing = openTasksByOwner.get(assignment.ownerAgentId) ?? [];
    existing.push(assignment);
    openTasksByOwner.set(assignment.ownerAgentId, existing);
  }
  const mapHumanSnapshot = (member: CollaborationMember) => {
    const userId = normalizeValue(member.userId) as string;
    const presence = resolveUserPresence([userId]);
    const extras = member as CollaborationMember & { email?: string; handle?: string };
    const email = normalizeValue(extras.email) ?? (userId.includes("@") ? userId : undefined);
    const handle = normalizeValue(extras.handle);
    return {
      userId,
      ...(normalizeValue(member.name) ? { name: normalizeValue(member.name) as string } : {}),
      ...(email ? { email } : {}),
      ...(handle ? { handle } : {}),
      ...(member.governanceRole ? { governanceRole: member.governanceRole } : {}),
      status: member.status,
      presenceStatus: presence.online ? ("online" as const) : ("offline" as const),
      ...(presence.lastActiveAtMs
        ? { lastActiveAt: new Date(presence.lastActiveAtMs).toISOString() }
        : {}),
    };
  };
  const activeHumans = params.members
    .filter((member) => member.memberKind === "human" && member.status === "active")
    .filter((member) => normalizeValue(member.userId))
    .map(mapHumanSnapshot);
  const invitedHumans = params.members
    .filter((member) => member.memberKind === "human" && member.status === "invited")
    .filter((member) => normalizeValue(member.userId))
    .map(mapHumanSnapshot);
  const activeBots = params.members
    .filter((member) => member.memberKind === "bot" && member.status === "active")
    .filter((member) => normalizeValue(member.agentId))
    .map((member) => {
      const agentId = normalizeValue(member.agentId) as string;
      const presence = presenceByAgentId.get(agentId);
      const openTasks = openTasksByOwner.get(agentId) ?? [];
      const runtimeStatus: GatewayCollaborationBotMemberSnapshot["runtimeStatus"] = presence
        ? presence.online
          ? presence.currentTask || openTasks.some((task) => task.status === "running")
            ? "busy"
            : "online"
          : "offline"
        : openTasks.length > 0
          ? "busy"
          : "unknown";
      return {
        agentId,
        ...((resolveConfiguredBotDisplayName(agentId) ?? normalizeValue(member.name))
          ? {
              name: (resolveConfiguredBotDisplayName(agentId) ??
                normalizeValue(member.name)) as string,
            }
          : {}),
        ...(normalizeValue(member.ownerUserId)
          ? { ownerUserId: normalizeValue(member.ownerUserId) as string }
          : {}),
        status: member.status,
        ...(runtimeStatus !== "unknown" ? { runtimeStatus } : {}),
        ...(presence?.lastActiveAt ? { lastActiveAt: presence.lastActiveAt } : {}),
        ...(presence?.currentTask ? { currentTask: presence.currentTask } : {}),
        ...(openTasks.length > 0 ? { openTaskCount: openTasks.length } : {}),
      };
    });
  const invitedBots = params.members
    .filter((member) => member.memberKind === "bot" && member.status === "invited")
    .filter((member) => normalizeValue(member.agentId))
    .map((member) => ({
      agentId: normalizeValue(member.agentId) as string,
      ...((resolveConfiguredBotDisplayName(normalizeValue(member.agentId)) ??
      normalizeValue(member.name))
        ? {
            name: (resolveConfiguredBotDisplayName(normalizeValue(member.agentId)) ??
              normalizeValue(member.name)) as string,
          }
        : {}),
      ...(normalizeValue(member.ownerUserId)
        ? { ownerUserId: normalizeValue(member.ownerUserId) as string }
        : {}),
      status: member.status,
    }));
  const snapshotWorkspacePath =
    normalizeValue(params.workspacePath) ?? normalizeValue(params.profile?.workspacePath);
  const tenantId =
    normalizeValue(params.tenantId) ?? resolveCollaborationGroupTenantId(params.groupId);
  return {
    id: params.groupId,
    groupId: params.groupId,
    title:
      normalizeValue(params.profile?.displayName) ??
      normalizeValue(params.profile?.groupCode) ??
      normalizeValue(params.titleFallback) ??
      params.groupId,
    tenantId,
    avatar: normalizeValue(params.profile?.avatar) ?? null,
    visibilityScope: normalizeValue(params.profile?.visibilityScope) ?? null,
    ownerUserId: normalizeValue(params.profile?.ownerUserId) ?? null,
    purpose: normalizeValue(params.profile?.purpose) ?? null,
    currentMission: normalizeValue(params.profile?.currentMission) ?? null,
    coordinatorBotId: normalizeValue(params.profile?.coordinatorBotId) ?? null,
    collaborationMode: normalizeValue(params.profile?.collaborationMode) ?? null,
    successCriteria: normalizeStringList(params.profile?.successCriteria),
    systemInstructions: normalizeStringList(params.groupCapabilities?.systemInstructions),
    confidentialityTier: normalizeValue(params.groupCapabilities?.confidentialityTier) ?? null,
    finalDecisionPolicy: params.profile?.finalDecisionPolicy ?? null,
    operatingState: params.operatingState ?? null,
    ...(snapshotWorkspacePath ? { workspacePath: snapshotWorkspacePath } : {}),
    members: {
      humans: activeHumans,
      bots: activeBots,
    },
    invites: {
      humans: invitedHumans,
      bots: invitedBots,
    },
  };
}

export function buildSpaceAliasSessionKey(groupId: string) {
  return toCollaborationSpaceSessionKey(groupId).toLowerCase();
}

/** Leftover name — destination is always `space:<groupId>`. */
export function buildBotGroupSessionKey(_agentId: string, groupId: string) {
  return toCollaborationSpaceSessionKey(groupId).toLowerCase();
}

export function resolveSessionGroupId(session: StoredSessionMetadata) {
  const directGroupId = normalizeValue(session.groupId);
  if (directGroupId) {
    return directGroupId;
  }
  const lineageGroupId = normalizeValue(session.lineage?.groupId);
  if (lineageGroupId) {
    return lineageGroupId;
  }
  const homeDomainId = normalizeValue(session.homeDomainId);
  if (!homeDomainId) {
    return null;
  }
  const scopedMatch = homeDomainId.match(/(?:^|:)space:([^:]+)$/);
  return normalizeValue(scopedMatch?.[1]);
}

export function resolveSessionSpaceTitle(session: StoredSessionMetadata) {
  return (
    normalizeValue(session.displayName) ??
    normalizeValue(session.label) ??
    normalizeValue(session.subject) ??
    normalizeValue(session.space)
  );
}

export async function readSessionDerivedSpaceTitles(stateDir: string) {
  const agentsRoot = path.join(stateDir, "agents");
  try {
    const agentEntries = await fs.readdir(agentsRoot, { withFileTypes: true });
    const titles = new Map<string, { title: string; updatedAt: number }>();
    await Promise.all(
      agentEntries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const sessionsPath = path.join(agentsRoot, entry.name, "sessions", "sessions.json");
          const { value } = await readJsonFileWithFallback<Record<string, StoredSessionMetadata>>(
            sessionsPath,
            {},
          );
          if (!value || typeof value !== "object") {
            return;
          }
          for (const session of Object.values(value)) {
            const groupId = resolveSessionGroupId(session);
            const title = resolveSessionSpaceTitle(session);
            if (!groupId || !title) {
              continue;
            }
            const updatedAt = typeof session.updatedAt === "number" ? session.updatedAt : 0;
            const existing = titles.get(groupId);
            if (!existing || updatedAt >= existing.updatedAt) {
              titles.set(groupId, { title, updatedAt });
            }
          }
        }),
    );
    return new Map([...titles.entries()].map(([groupId, entry]) => [groupId, entry.title]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map<string, string>();
    }
    throw error;
  }
}

export function deriveGroupConversationSeed(messages: unknown[]) {
  let purpose: string | null = null;
  let currentMission: string | null = null;

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = (message as { role?: unknown }).role;
    if (role !== "user") {
      continue;
    }
    const text = extractTranscriptMessageText(message);
    if (!text) {
      continue;
    }
    purpose ??= derivePurposeFromConversationSeed(text);
    currentMission ??= deriveCurrentMissionFromConversationSeed(text);
    if (purpose && currentMission) {
      break;
    }
  }

  return { purpose, currentMission };
}

export async function readGroupConversationSeed(params: { stateDir: string; groupId: string }) {
  const cfg = loadConfig();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const aliasSessionKey = buildSpaceAliasSessionKey(params.groupId);
  const storeContexts = [
    {
      agentId: defaultAgentId,
      storePath: resolveStorePath(cfg.session?.store, { agentId: defaultAgentId }),
    },
    ...(await listAgentSessionStores(params.stateDir)),
  ];
  const visitedStores = new Set<string>();

  for (const storeContext of storeContexts) {
    const normalizedStorePath = path.resolve(storeContext.storePath);
    if (visitedStores.has(normalizedStorePath)) {
      continue;
    }
    visitedStores.add(normalizedStorePath);

    let store: Record<string, SessionEntry>;
    try {
      store = loadSessionStore(storeContext.storePath);
    } catch (err) {
      // Legacy STATE_DIR/agents/* stores escape operators/<id> root under ALS.
      // Seed enrichment is best-effort; skip rather than failing spaces.list.
      if (String(err).includes(CROSS_OPERATOR_STATE_DENIED)) {
        continue;
      }
      throw err;
    }
    const directEntry = store[aliasSessionKey];
    const candidates: SessionEntry[] = [];
    if (directEntry) {
      candidates.push(directEntry);
    }
    for (const [key, entry] of Object.entries(store)) {
      if (!entry || key === aliasSessionKey) {
        continue;
      }
      if (!matchesCollaborationGroupSession({ key, entry, groupId: params.groupId })) {
        continue;
      }
      candidates.push(entry);
    }

    for (const candidate of candidates) {
      if (!candidate.sessionId) {
        continue;
      }
      const messages = readSessionMessages(
        candidate.sessionId,
        storeContext.storePath,
        candidate.sessionFile,
      );
      const derivedSeed = deriveGroupConversationSeed(messages);
      if (derivedSeed.purpose || derivedSeed.currentMission) {
        return derivedSeed;
      }
    }
  }

  return {
    purpose: null,
    currentMission: null,
  };
}

export function findExistingMember(
  members: CollaborationMember[],
  kind: "human" | "bot",
  identity: string,
) {
  return (
    members.find((member) =>
      kind === "human"
        ? member.memberKind === "human" && normalizeValue(member.userId) === identity
        : member.memberKind === "bot" && normalizeValue(member.agentId) === identity,
    ) ?? null
  );
}

export function applyDefaultBotCollaborationRoles(
  members: CollaborationMember[],
  coordinatorBotId: string | null,
) {
  const normalizedCoordinatorBotId = normalizeValue(coordinatorBotId);
  return members.map((member) => {
    if (
      member.memberKind !== "bot" ||
      member.collaborationRole ||
      member.status === "removed" ||
      (member.status as string) === "revoked"
    ) {
      return member;
    }
    const agentId = normalizeValue(member.agentId);
    if (!agentId) {
      return member;
    }
    return {
      ...member,
      collaborationRole:
        normalizedCoordinatorBotId && agentId === normalizedCoordinatorBotId
          ? "coordinator"
          : "contributor",
    } satisfies CollaborationMember;
  });
}

export function buildPersistedMember(params: {
  existingMembers: CollaborationMember[];
  kind: "human" | "bot";
  identity: string;
  name?: string;
  status: "active" | "invited";
  now: number;
}) {
  const existing = findExistingMember(params.existingMembers, params.kind, params.identity);
  const name = normalizeValue(params.name) ?? normalizeValue(existing?.name);
  const status =
    params.status === "active" && existing?.status === "paused" ? "paused" : params.status;
  return {
    memberId: existing?.memberId ?? `${params.kind}:${params.identity}`,
    memberKind: params.kind,
    ...(params.kind === "human" ? { userId: params.identity } : { agentId: params.identity }),
    ...(params.kind === "bot" && existing?.ownerUserId
      ? { ownerUserId: existing.ownerUserId }
      : {}),
    ...(name ? { name } : {}),
    governanceRole: existing?.governanceRole ?? "member",
    ...(existing?.collaborationRole ? { collaborationRole: existing.collaborationRole } : {}),
    ...(existing?.visibility ? { visibility: existing.visibility } : {}),
    status,
    ...(status === "invited"
      ? { invitedAtMs: existing?.invitedAtMs ?? params.now }
      : { joinedAtMs: existing?.joinedAtMs ?? params.now }),
    updatedAtMs: params.now,
  } satisfies CollaborationMember;
}

export function buildPersistedMembers(params: {
  existingMembers: CollaborationMember[];
  members: GatewayWorkspaceMemberRoster;
  invites?: GatewayWorkspaceMemberRoster;
  now: number;
}) {
  const activeHumans = (params.members.humans ?? [])
    .map((entry) => {
      const userId = normalizeValue(entry.userId);
      return userId
        ? buildPersistedMember({
            existingMembers: params.existingMembers,
            kind: "human",
            identity: userId,
            name: entry.name,
            status: "active",
            now: params.now,
          })
        : null;
    })
    .filter(Boolean) as CollaborationMember[];
  const activeBots = (params.members.bots ?? [])
    .map((entry) => {
      const agentId = normalizeValue(entry.agentId);
      return agentId
        ? buildPersistedMember({
            existingMembers: params.existingMembers,
            kind: "bot",
            identity: agentId,
            name: entry.name,
            status: "active",
            now: params.now,
          })
        : null;
    })
    .filter(Boolean) as CollaborationMember[];
  const invitedHumans = (params.invites?.humans ?? [])
    .map((entry) => {
      const userId = normalizeValue(entry.userId);
      return userId
        ? buildPersistedMember({
            existingMembers: params.existingMembers,
            kind: "human",
            identity: userId,
            name: entry.name,
            status: "invited",
            now: params.now,
          })
        : null;
    })
    .filter(Boolean) as CollaborationMember[];
  const invitedBots = (params.invites?.bots ?? [])
    .map((entry) => {
      const agentId = normalizeValue(entry.agentId);
      return agentId
        ? buildPersistedMember({
            existingMembers: params.existingMembers,
            kind: "bot",
            identity: agentId,
            name: entry.name,
            status: "invited",
            now: params.now,
          })
        : null;
    })
    .filter(Boolean) as CollaborationMember[];

  // The UI currently manages active humans, active bots, and human invites explicitly.
  // Any bot invite omitted by older clients should remain pending until it is promoted or
  // explicitly replaced by a newer payload that includes `invites.bots`.
  if (!params.invites || !("bots" in params.invites)) {
    for (const member of params.existingMembers) {
      if (member.memberKind !== "bot" || member.status !== "invited") {
        continue;
      }
      const agentId = normalizeValue(member.agentId);
      if (!agentId) {
        continue;
      }
      const alreadyIncluded = [...activeBots, ...invitedBots].some(
        (entry) => normalizeValue(entry.agentId) === agentId,
      );
      if (!alreadyIncluded) {
        invitedBots.push(member);
      }
    }
  }

  return [...activeHumans, ...activeBots, ...invitedHumans, ...invitedBots];
}

export async function loadManagedSpaceMembersForVacancyHeal(
  stateDir: string,
  groupId: string,
): Promise<CollaborationMember[] | null> {
  const managedMembersRaw = await readManagedSpaceFile<
    CollaborationMember[] | { members?: CollaborationMember[] | null }
  >(stateDir, groupId, "members.json");
  return parseStoredGroupMembersFile(managedMembersRaw);
}

export function readConfiguredAgentOwnership(agentId: string): ConfiguredAgentOwnership | null {
  const normalizedAgentId = normalizeValue(agentId);
  if (!normalizedAgentId) {
    return null;
  }
  const cfg = loadConfig();
  const entry = cfg.agents?.list?.find(
    (candidate) => normalizeValue(candidate.id) === normalizedAgentId,
  );
  if (!entry) {
    return null;
  }
  return {
    ownerId: normalizeValue(entry.ownerId),
    ownerName: normalizeValue(entry.ownerName),
    ownerType: entry.ownerType ?? null,
    scope: normalizeValue(entry.scope),
  };
}

export function assertSharedBotActivationsAuthorized(params: {
  existingMembers: CollaborationMember[];
  nextMembers: CollaborationMember[];
  actor?: string;
  actorEmployeeUserId?: string;
  botOwnerUserIdByAgentId?: ReadonlyMap<string, string>;
}) {
  for (const member of params.nextMembers) {
    if (member.memberKind !== "bot" || member.status !== "active") {
      continue;
    }
    const agentId = normalizeValue(member.agentId);
    if (!agentId) {
      continue;
    }
    const existing = findExistingMember(params.existingMembers, "bot", agentId);
    if (existing?.status === "active" || existing?.status === "paused") {
      continue;
    }
    const ownership = readConfiguredAgentOwnership(agentId);
    const ownerId = normalizeValue(ownership?.ownerId);
    const scope = normalizeValue(ownership?.scope);
    const isSharedRobot = scope === "shared" || scope === "team" || Boolean(ownerId);
    if (!isSharedRobot || !ownerId) {
      continue;
    }
    if (
      isActorAuthorizedBotOwner({
        actor: params.actor,
        actorEmployeeUserId: params.actorEmployeeUserId,
        agentId,
        botOwnerUserIdByAgentId: params.botOwnerUserIdByAgentId,
      })
    ) {
      continue;
    }
    const ownerLabel = normalizeValue(ownership?.ownerName) ?? ownerId;
    throw new Error(`机器人 ${agentId} 需要由主人 ${ownerLabel} 同意后才能加入协作小组`);
  }
}

export async function ensureWorkspaceSpaceProfile(params: {
  groupStorage: OpenBotGroupStorage;
  groupId: string;
  title?: string;
  avatar?: string;
  visibilityScope?: string;
  ownerUserId?: string | null;
  coordinatorBotId?: string | null;
  purpose?: string;
  currentMission?: string;
  successCriteria?: string[];
  collaborationMode?: string;
  workspacePath?: string;
  finalDecisionPolicy?: GroupProfile["finalDecisionPolicy"];
  lifecycleStatus?: GroupProfile["lifecycleStatus"];
}) {
  const now = Date.now();
  const profile = await params.groupStorage.readProfile(params.groupId);
  const displayName =
    normalizeValue(params.title) ??
    normalizeValue(profile?.displayName) ??
    normalizeValue(profile?.groupCode) ??
    params.groupId;
  await params.groupStorage.writeProfile({
    groupId: params.groupId,
    groupCode: profile?.groupCode ?? params.groupId,
    displayName,
    ...(normalizeValue(params.avatar) ? { avatar: normalizeValue(params.avatar) as string } : {}),
    ...(!normalizeValue(params.avatar) && normalizeValue(profile?.avatar)
      ? { avatar: normalizeValue(profile?.avatar) as string }
      : {}),
    ...(normalizeValue(params.visibilityScope)
      ? {
          visibilityScope: normalizeValue(
            params.visibilityScope,
          ) as GroupProfile["visibilityScope"],
        }
      : !normalizeValue(params.visibilityScope) && profile?.visibilityScope
        ? { visibilityScope: profile.visibilityScope }
        : {}),
    ...(profile?.groupType ? { groupType: profile.groupType } : {}),
    ...(params.lifecycleStatus
      ? { lifecycleStatus: params.lifecycleStatus }
      : profile?.lifecycleStatus
        ? { lifecycleStatus: profile.lifecycleStatus }
        : {}),
    ...(normalizeValue(params.ownerUserId)
      ? { ownerUserId: normalizeValue(params.ownerUserId) as string }
      : {}),
    ...(!normalizeValue(params.ownerUserId) && profile?.ownerUserId
      ? { ownerUserId: profile.ownerUserId }
      : {}),
    ...("coordinatorBotId" in params
      ? normalizeValue(params.coordinatorBotId)
        ? { coordinatorBotId: normalizeValue(params.coordinatorBotId) as string }
        : { coordinatorBotId: "" }
      : profile?.coordinatorBotId
        ? { coordinatorBotId: profile.coordinatorBotId }
        : {}),
    ...(normalizeValue(params.purpose)
      ? { purpose: normalizeValue(params.purpose) as string }
      : !normalizeValue(params.purpose) && profile?.purpose
        ? { purpose: profile.purpose }
        : {}),
    ...(normalizeValue(params.currentMission)
      ? { currentMission: normalizeValue(params.currentMission) as string }
      : !normalizeValue(params.currentMission) && profile?.currentMission
        ? { currentMission: profile.currentMission }
        : {}),
    ...(params.successCriteria && params.successCriteria.length > 0
      ? { successCriteria: normalizeStringList(params.successCriteria) }
      : !params.successCriteria && profile?.successCriteria
        ? { successCriteria: profile.successCriteria }
        : {}),
    ...(profile?.exitCriteria ? { exitCriteria: profile.exitCriteria } : {}),
    ...(normalizeValue(params.collaborationMode)
      ? {
          collaborationMode: normalizeValue(
            params.collaborationMode,
          ) as GroupProfile["collaborationMode"],
        }
      : !normalizeValue(params.collaborationMode) && profile?.collaborationMode
        ? { collaborationMode: profile.collaborationMode }
        : {}),
    ...(params.finalDecisionPolicy
      ? { finalDecisionPolicy: params.finalDecisionPolicy }
      : profile?.finalDecisionPolicy
        ? { finalDecisionPolicy: profile.finalDecisionPolicy }
        : {}),
    ...(profile?.directoryBindingId ? { directoryBindingId: profile.directoryBindingId } : {}),
    ...(normalizeValue(params.workspacePath)
      ? { workspacePath: normalizeValue(params.workspacePath) as string }
      : !normalizeValue(params.workspacePath) && profile?.workspacePath
        ? { workspacePath: profile.workspacePath }
        : {}),
    createdAtMs: profile?.createdAtMs ?? now,
    updatedAtMs: now,
  });
}

import {
  resolveNextCoordinatorBotId,
  stripBuiltinStewardGroupMembers,
} from "./coordinator-policy.js";
export { resolveNextCoordinatorBotId, stripBuiltinStewardGroupMembers };

export function buildBootstrapSystemInstructions(params: {
  title: string;
  profile: GroupProfile | null;
  members: CollaborationMember[];
  extraInstructions?: string[] | null;
}) {
  const ownerUserId = normalizeValue(params.profile?.ownerUserId);
  const coordinatorBotId = normalizeValue(params.profile?.coordinatorBotId);
  const ownerLabel = findHumanMemberLabel(params.members, ownerUserId);
  const coordinatorLabel = findBotMemberLabel(params.members, coordinatorBotId);
  return normalizeStringList([
    `协作小组名称：${params.title}`,
    ownerLabel ? `群主：${ownerLabel}` : "",
    coordinatorLabel ? `协调机器人：${coordinatorLabel}` : "",
    normalizeValue(params.profile?.purpose)
      ? `小组定位：${normalizeValue(params.profile?.purpose)}`
      : "",
    normalizeValue(params.profile?.currentMission)
      ? `当前使命：${normalizeValue(params.profile?.currentMission)}`
      : "",
    params.profile?.successCriteria && params.profile.successCriteria.length > 0
      ? `成功标准：${normalizeStringList(params.profile.successCriteria).join("；")}`
      : "",
    "新加入成员应先简要介绍自己的角色，并围绕当前使命继续协作。",
    "讨论输出应保持清晰，确保后加入成员能够快速恢复上下文。",
    ...(params.extraInstructions ?? []),
  ]);
}

export async function writeGroupBootstrapState(params: {
  groupId: string;
  title: string;
  profile: GroupProfile | null;
  members: CollaborationMember[];
  metadataStorage: OpenBotMetadataStorage;
  memoryStorage: OpenBotMemoryStorage;
  learningStorage: OpenBotLearningStorage;
  requestedSystemInstructions?: string[];
  requestedConfidentialityTier?: string | null;
}) {
  const now = Date.now();
  const existingCapabilities = await params.metadataStorage.readGroupCapabilities(params.groupId);
  const confidentialityTier = normalizeConfidentialityTier(
    normalizeValue(params.requestedConfidentialityTier) ??
      normalizeValue(existingCapabilities?.confidentialityTier) ??
      "internal",
  );
  // Rebuild roster/owner-facing lines from the current snapshot; keep only
  // custom (non-bootstrap-managed) instructions from prior capability writes.
  const systemInstructions = buildBootstrapSystemInstructions({
    title: params.title,
    profile: params.profile,
    members: params.members,
    extraInstructions: [
      ...retainCustomSystemInstructions(existingCapabilities?.systemInstructions),
      ...(params.requestedSystemInstructions ?? []),
    ],
  });

  await params.metadataStorage.writeGroupCapabilities(params.groupId, {
    groupId: params.groupId,
    ...(existingCapabilities?.enabledSkills
      ? { enabledSkills: existingCapabilities.enabledSkills }
      : {}),
    ...(existingCapabilities?.requiredSkillSets
      ? { requiredSkillSets: existingCapabilities.requiredSkillSets }
      : {}),
    ...(existingCapabilities?.blockedSkills
      ? { blockedSkills: existingCapabilities.blockedSkills }
      : {}),
    systemInstructions,
    confidentialityTier,
    updatedAtMs: now,
    ...(existingCapabilities?.metadata ? { metadata: existingCapabilities.metadata } : {}),
  });

  const ownerUserId = normalizeValue(params.profile?.ownerUserId);
  const coordinatorBotId = normalizeValue(params.profile?.coordinatorBotId);
  const ownerLabel = findHumanMemberLabel(params.members, ownerUserId);
  const coordinatorLabel = findBotMemberLabel(params.members, coordinatorBotId);
  const summaryParts = normalizeStringList([
    ownerLabel ? `群主：${ownerLabel}` : "",
    coordinatorLabel ? `协调机器人：${coordinatorLabel}` : "",
    normalizeValue(params.profile?.purpose)
      ? `定位：${normalizeValue(params.profile?.purpose)}`
      : "",
    normalizeValue(params.profile?.currentMission)
      ? `当前使命：${normalizeValue(params.profile?.currentMission)}`
      : "",
  ]);
  const summary =
    summaryParts.length > 0
      ? summaryParts.join("；")
      : "协作小组的群主、使命与协作规则初始化记录。";

  const memories = await params.memoryStorage.readMemories<GroupBootstrapMemoryRecord>(
    params.groupId,
  );
  const nextMemory: GroupBootstrapMemoryRecord = {
    memoryId: `bootstrap:${params.groupId}`,
    groupId: params.groupId,
    kind: "group_bootstrap",
    title: `${params.title} 初始化记录`,
    summary,
    content: {
      ownerUserId,
      ownerLabel,
      coordinatorBotId,
      coordinatorBotLabel: coordinatorLabel,
      purpose: normalizeValue(params.profile?.purpose),
      currentMission: normalizeValue(params.profile?.currentMission),
      collaborationMode: normalizeValue(params.profile?.collaborationMode),
      successCriteria: normalizeStringList(params.profile?.successCriteria),
      systemInstructions,
      memberCount: params.members.filter((member) => member.status === "active").length,
    },
    createdAtMs: now,
    updatedAtMs: now,
  };
  await params.memoryStorage.writeMemories(params.groupId, [
    ...memories.filter((entry) => entry.memoryId !== nextMemory.memoryId),
    nextMemory,
  ]);

  await params.learningStorage.appendCapsule(params.groupId, {
    capsuleId: `group-bootstrap:${params.groupId}`,
    groupId: params.groupId,
    sourceType: "session",
    sourceIds: [`space:${params.groupId}`],
    capsuleType: "playbook",
    title: `${params.title} 小组章程`,
    summary,
    structuredContent: {
      ownerUserId,
      ownerLabel,
      coordinatorBotId,
      coordinatorLabel,
      purpose: normalizeValue(params.profile?.purpose),
      currentMission: normalizeValue(params.profile?.currentMission),
      collaborationMode: normalizeValue(params.profile?.collaborationMode),
      successCriteria: normalizeStringList(params.profile?.successCriteria),
      systemInstructions,
      members: buildProfileMemberSnapshot(params.members),
    },
    sensitivity: mapTierToSensitivity(confidentialityTier),
    reusability: mapTierToReusability(confidentialityTier),
    confidentialityScope: mapTierToConfidentialityScope(confidentialityTier),
    createdBy: coordinatorBotId ?? ownerUserId ?? "system",
    approvedBy: ownerUserId ?? coordinatorBotId ?? "system",
    approvedAt: now,
    status: "approved",
    createdAt: now,
    updatedAt: now,
    metadata: {
      origin: "group_bootstrap",
      groupId: params.groupId,
    },
  });
}

export async function hydrateGroupArtifactsFromManagedMirror(params: {
  stateDir: string;
  groupId: string;
  profile: StoredGroupProfile | null;
  members: CollaborationMember[];
}) {
  let profile = params.profile;
  let members = params.members;
  let hydratedFromMirror = false;

  if (!profile) {
    const managedProfile = coerceManagedMirrorProfile(
      await readManagedSpaceFile<StoredGroupProfile | { profile?: StoredGroupProfile | null }>(
        params.stateDir,
        params.groupId,
        "profile.json",
      ),
      params.groupId,
    );
    if (managedProfile) {
      profile = managedProfile;
      hydratedFromMirror = true;
    }
  }

  if (members.length === 0) {
    const managedMembersRaw = await readManagedSpaceFile<
      CollaborationMember[] | { members?: CollaborationMember[] | null }
    >(params.stateDir, params.groupId, "members.json");
    if (Array.isArray(managedMembersRaw)) {
      members = managedMembersRaw;
      hydratedFromMirror = true;
    } else if (Array.isArray(managedMembersRaw?.members)) {
      members = managedMembersRaw.members;
      hydratedFromMirror = true;
    } else {
      const embeddedMembers = buildMembersFromEmbeddedProfile(profile);
      if (embeddedMembers.length > 0) {
        members = embeddedMembers;
        hydratedFromMirror = true;
      }
    }
  }

  return { profile, members, hydratedFromMirror };
}

export async function ensureWorkspaceGroupBootstrapArtifacts(params: {
  stateDir: string;
  fileStore: ReturnType<typeof createGroupFileStore>;
  groupStorage: OpenBotGroupStorage;
  metadataStorage: OpenBotMetadataStorage;
  memoryStorage: OpenBotMemoryStorage;
  learningStorage: OpenBotLearningStorage;
  objectStorage: OpenBotObjectStorage;
  groupId: string;
  titleFallback?: string | null;
}) {
  const [
    existingProfile,
    existingMembers,
    existingCapabilities,
    existingOperatingState,
    memories,
    capsules,
  ] = await Promise.all([
    params.groupStorage.readProfile(params.groupId),
    params.groupStorage.readMembers(params.groupId),
    params.metadataStorage.readGroupCapabilities(params.groupId),
    readGroupOperatingState({ fileStore: params.fileStore, groupId: params.groupId }),
    params.memoryStorage.readMemories<GroupBootstrapMemoryRecord>(params.groupId),
    params.learningStorage.readCapsules(params.groupId),
  ]);
  const mirrorHydration = await hydrateGroupArtifactsFromManagedMirror({
    stateDir: params.stateDir,
    groupId: params.groupId,
    profile: toStoredGroupProfile(existingProfile),
    members: existingMembers,
  });
  let resolvedProfile = mirrorHydration.profile;
  let resolvedMembers = mirrorHydration.members;

  if (!resolvedProfile && resolvedMembers.length === 0) {
    const operatingState = await syncGroupOperatingState({
      fileStore: params.fileStore,
      groupStorage: params.groupStorage,
      metadataStorage: params.metadataStorage,
      memoryStorage: params.memoryStorage,
      learningStorage: params.learningStorage,
      objectStorage: params.objectStorage,
      groupId: params.groupId,
      titleFallback: params.titleFallback,
    });
    return {
      profile: toGroupProfile(resolvedProfile),
      members: resolvedMembers,
      groupCapabilities: existingCapabilities,
      operatingState,
    };
  }

  const conversationSeed = await readGroupConversationSeed({
    stateDir: params.stateDir,
    groupId: params.groupId,
  });
  const runtimeProfile = toGroupProfile(resolvedProfile);
  const ownerUserId = resolveEffectiveGroupOwnerUserId({
    profile: runtimeProfile,
    members: resolvedMembers,
  });
  const membersBeforeRepair = resolvedMembers;
  resolvedMembers = stripBuiltinStewardGroupMembers(resolvedMembers);
  const coordinatorBotId = resolveNextCoordinatorBotId({
    profile: runtimeProfile,
    members: resolvedMembers,
  });
  const nextMembers = applyDefaultBotCollaborationRoles(
    applyGroupOwnerRole(resolvedMembers, ownerUserId),
    coordinatorBotId,
  );
  const title =
    normalizeValue(resolvedProfile?.displayName) ??
    normalizeValue(resolvedProfile?.groupCode) ??
    normalizeValue(params.titleFallback) ??
    params.groupId;
  const purpose = normalizeValue(resolvedProfile?.purpose) ?? conversationSeed.purpose ?? undefined;
  const currentMission =
    normalizeValue(resolvedProfile?.currentMission) ?? conversationSeed.currentMission ?? undefined;
  const existingOwnerUserId = normalizeValue(resolvedProfile?.ownerUserId);
  const existingCoordinatorBotId = normalizeValue(resolvedProfile?.coordinatorBotId);
  const profileNeedsWrite =
    mirrorHydration.hydratedFromMirror ||
    !resolvedProfile ||
    existingOwnerUserId !== normalizeValue(ownerUserId) ||
    existingCoordinatorBotId !== normalizeValue(coordinatorBotId) ||
    (!normalizeValue(resolvedProfile?.purpose) && Boolean(purpose)) ||
    (!normalizeValue(resolvedProfile?.currentMission) && Boolean(currentMission));
  const membersNeedWrite =
    mirrorHydration.hydratedFromMirror ||
    JSON.stringify(nextMembers) !== JSON.stringify(membersBeforeRepair);

  if (profileNeedsWrite) {
    await ensureWorkspaceSpaceProfile({
      groupStorage: params.groupStorage,
      groupId: params.groupId,
      title,
      avatar: normalizeValue(resolvedProfile?.avatar) ?? undefined,
      visibilityScope: normalizeValue(resolvedProfile?.visibilityScope) ?? undefined,
      ownerUserId,
      coordinatorBotId,
      purpose,
      currentMission,
      successCriteria: normalizeStringList(resolvedProfile?.successCriteria),
      collaborationMode: normalizeValue(resolvedProfile?.collaborationMode) ?? undefined,
      workspacePath: normalizeValue(resolvedProfile?.workspacePath) ?? undefined,
      finalDecisionPolicy: resolvedProfile?.finalDecisionPolicy,
    });
  }
  if (membersNeedWrite) {
    await params.groupStorage.writeMembers(params.groupId, nextMembers);
  }

  const profile = profileNeedsWrite
    ? toGroupProfile(await params.groupStorage.readProfile(params.groupId))
    : toGroupProfile(resolvedProfile);
  const members = membersNeedWrite ? nextMembers : resolvedMembers;
  const hasBootstrapMemory = memories.some(
    (entry) => entry.kind === "group_bootstrap" && entry.memoryId === `bootstrap:${params.groupId}`,
  );
  const hasBootstrapCapsule = capsules.some(
    (entry) =>
      entry.capsuleId === `group-bootstrap:${params.groupId}` ||
      entry.metadata?.origin === "group_bootstrap",
  );
  const hasSystemInstructions =
    normalizeStringList(existingCapabilities?.systemInstructions).length > 0;
  const shouldWriteBootstrap =
    Boolean(profile) &&
    (!hasBootstrapMemory ||
      !hasBootstrapCapsule ||
      !hasSystemInstructions ||
      profileNeedsWrite ||
      membersNeedWrite);

  if (shouldWriteBootstrap) {
    await writeGroupBootstrapState({
      groupId: params.groupId,
      title,
      profile,
      members,
      metadataStorage: params.metadataStorage,
      memoryStorage: params.memoryStorage,
      learningStorage: params.learningStorage,
      requestedSystemInstructions: existingCapabilities?.systemInstructions,
      requestedConfidentialityTier: existingCapabilities?.confidentialityTier,
    });
  }

  const groupCapabilities = shouldWriteBootstrap
    ? await params.metadataStorage.readGroupCapabilities(params.groupId)
    : existingCapabilities;
  const syncedOperatingState = await syncGroupOperatingState({
    fileStore: params.fileStore,
    groupStorage: params.groupStorage,
    metadataStorage: params.metadataStorage,
    memoryStorage: params.memoryStorage,
    learningStorage: params.learningStorage,
    objectStorage: params.objectStorage,
    groupId: params.groupId,
    titleFallback: title,
  });
  const operatingState = existingOperatingState
    ? {
        ...syncedOperatingState,
        activeContext: existingOperatingState.activeContext,
        updatedAtMs: Date.now(),
      }
    : syncedOperatingState;
  if (existingOperatingState) {
    // Business-only follow-up after sync (activeContext carry). Auth is preserved by merge.
    await writeGroupOperatingState({
      fileStore: params.fileStore,
      groupId: params.groupId,
      state: operatingState,
      writeKind: "business",
    });
  }

  return {
    profile,
    members,
    groupCapabilities,
    operatingState,
  };
}

export function matchesCollaborationGroupSession(params: {
  key: string;
  entry: SessionEntry;
  groupId: string;
}) {
  const normalizedGroupId = params.groupId.trim().toLowerCase();
  const normalizedKey = params.key.trim().toLowerCase();
  if (normalizedKey === `space:${normalizedGroupId}`) {
    return true;
  }
  if (normalizedKey.endsWith(`:space:${normalizedGroupId}`)) {
    return true;
  }
  const candidates = [
    params.entry.groupId,
    params.entry.space,
    params.entry.collaborationGroupProfile?.groupId,
    resolveSessionParticipationGroupId(params.entry.collaborationParticipationOverlay),
  ]
    .map((value) => normalizeValue(value)?.toLowerCase())
    .filter(Boolean);
  return candidates.includes(normalizedGroupId);
}

export async function listAgentSessionStores(stateDir: string) {
  const agentsRoot = path.join(stateDir, "agents");
  try {
    const agentEntries = await fs.readdir(agentsRoot, { withFileTypes: true });
    return agentEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        agentId: entry.name,
        storePath: path.join(agentsRoot, entry.name, "sessions", "sessions.json"),
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function deletePathIfExists(targetPath: string) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function resetCollaborationGroupSessionData(stateDir: string, groupId: string) {
  const stores = await listAgentSessionStores(stateDir);
  let removedSessionEntries = 0;
  const transcriptPaths = new Set<string>();
  try {
    const { resolveGroupPublicTranscriptPath } = await import("./collaboration-paths.js");
    transcriptPaths.add(resolveGroupPublicTranscriptPath(groupId));
  } catch {
    // best-effort shared transcript cleanup
  }
  for (const storeContext of stores) {
    const store = loadSessionStore(storeContext.storePath);
    const matches = Object.entries(store).filter(([key, entry]) =>
      entry ? matchesCollaborationGroupSession({ key, entry, groupId }) : false,
    );
    if (matches.length === 0) {
      continue;
    }
    for (const [, entry] of matches) {
      if (!entry?.sessionId) {
        continue;
      }
      const candidates = resolveSessionTranscriptCandidates(
        entry.sessionId,
        storeContext.storePath,
        entry.sessionFile,
        storeContext.agentId,
      );
      for (const candidate of candidates) {
        transcriptPaths.add(candidate);
      }
    }
    for (const [key] of matches) {
      delete store[key];
      removedSessionEntries += 1;
    }
    await writeJsonFileAtomically(storeContext.storePath, store);
  }
  let removedTranscriptFiles = 0;
  for (const transcriptPath of transcriptPaths) {
    try {
      await fs.rm(transcriptPath, { force: true });
      removedTranscriptFiles += 1;
    } catch {
      // best-effort
    }
  }
  return {
    removedSessionEntries,
    removedTranscriptFiles,
  };
}

export async function resetCollaborationGroupStorage(params: {
  stateDir: string;
  groupId: string;
  groupRootDir: string;
}) {
  const managedDirs = resolveManagedSpaceDirCandidates(params.stateDir, params.groupId);
  const groupDir = resolveGroupWorkspacePath(params.groupRootDir, params.groupId);
  await Promise.all([...managedDirs, groupDir].map((dir) => deletePathIfExists(dir)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Growth OS — group growth status accessors (spec: agent-growth-lifecycle).
// Read/write the `growthStatus` embedded in a group's operating-state.json.
// Owned by the AGS landing stream; keeps group growth I/O out of MERGE-C spaces.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Read a group's GrowthStatus from operating-state.json; null if the group/state is absent. */
export async function readGroupGrowthStatusById(groupId: string): Promise<GrowthStatus | null> {
  const stores = createWorkspaceCollaborationStores();
  const state = await readGroupOperatingState({ fileStore: stores.fileStore, groupId });
  return state?.growthStatus ?? null;
}

/**
 * Apply `updater` to a group's GrowthStatus and persist it back into operating-state.json.
 * Initializes a birth-state GrowthStatus when missing. Returns the resulting status, or null
 * when the group has no operating state yet (cannot persist).
 */
export async function updateGroupGrowthStatusById(
  groupId: string,
  updater: (current: GrowthStatus) => GrowthStatus,
): Promise<GrowthStatus | null> {
  const stores = createWorkspaceCollaborationStores();
  const state = await readGroupOperatingState({ fileStore: stores.fileStore, groupId });
  if (!state) {
    return null;
  }
  const current =
    state.growthStatus ?? createInitialGrowthStatus({ kind: "group", atMs: Date.now() });
  const next = updater(current);
  await writeGroupOperatingState({
    fileStore: stores.fileStore,
    groupId,
    state: { ...state, growthStatus: next, updatedAtMs: Date.now() },
  });
  return next;
}
