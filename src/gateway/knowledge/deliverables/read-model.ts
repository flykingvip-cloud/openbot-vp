import type { CollaborationMember, Deliverable } from "@openbot/collaboration-core";
import { isEmployeeBuiltinStewardSessionOwnedByUser } from "../../../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../../../agents/builtin-steward/identity.js";
import {
  createWorkspaceCollaborationStores,
  listWorkspaceCollaborationGroupIds,
} from "../../collaboration-learning/shared.js";
import {
  type DeliverableArtifactRef,
  listPersonalSkillAssets,
  type SkillLifecycleState,
} from "../../skill-lifecycle-store.js";
import { enrichWorkspaceDeliverableArtifactFields } from "./artifact-fields.js";
import {
  resolveConfiguredAgentDisplayName,
  resolvePrimaryCreatorDisplayName,
  looksLikeOpaqueDeliverableCreatorId,
} from "./creator-display.js";
import { mapSkillLifecycleToDeliverableStatus } from "./lifecycle-map.js";
import type {
  ListWorkspaceDeliverablesParams,
  ListWorkspaceDeliverablesResult,
  WorkspaceDeliverable,
  WorkspaceDeliverableKind,
} from "./types.js";

function inferDeliverableKind(title: string, contentType?: string): WorkspaceDeliverableKind {
  const haystack = `${title} ${contentType ?? ""}`.toLowerCase();
  if (/(ppt|slides|deck|演示)/i.test(haystack)) {
    return "ppt";
  }
  if (/(proposal|方案|建议书)/i.test(haystack)) {
    return "proposal";
  }
  if (/(analysis|分析|洞察)/i.test(haystack)) {
    return "analysis";
  }
  if (/(meeting|会议|纪要)/i.test(haystack)) {
    return "meeting";
  }
  if (/(report|报告|总结|复盘)/i.test(haystack)) {
    return "report";
  }
  return "other";
}

function isActiveMember(member: CollaborationMember, userId: string): boolean {
  if (member.status !== "active" && member.status !== "invited") {
    return false;
  }
  return member.userId === userId;
}

function mapCollaborationDeliverable(params: {
  deliverable: Deliverable;
  groupId: string;
  groupTitle: string;
  members: CollaborationMember[];
}): WorkspaceDeliverable {
  const creators = [
    params.deliverable.submittedBy,
    params.deliverable.createdBy,
    params.deliverable.publishedBy,
  ].filter((value): value is string => Boolean(value?.trim()));
  const uniqueCreators = [...new Set(creators)];
  const primaryCreatorName = resolvePrimaryCreatorDisplayName(uniqueCreators, params.members, {
    groupTitle: params.groupTitle,
  });
  return enrichWorkspaceDeliverableArtifactFields({
    deliverableId: params.deliverable.deliverableId,
    title: params.deliverable.title,
    kind: inferDeliverableKind(params.deliverable.title, params.deliverable.contentType),
    source: params.deliverable.taskId ? "task" : "group",
    creators: uniqueCreators,
    primaryCreatorName,
    groupId: params.groupId,
    groupTitle: params.groupTitle,
    taskId: params.deliverable.taskId,
    status: params.deliverable.status,
    updatedAtMs: params.deliverable.updatedAtMs,
    contentType: params.deliverable.contentType,
  });
}

function resolveDeliverableArtifactFields(
  artifact: DeliverableArtifactRef | undefined,
): Partial<Pick<WorkspaceDeliverable, "previewKind" | "artifactFilename" | "openUrl">> {
  if (artifact?.previewKind === "file" && artifact.filename) {
    return { previewKind: "file", artifactFilename: artifact.filename };
  }
  if (artifact?.previewKind === "published" && artifact.url) {
    return { previewKind: "published", openUrl: artifact.url };
  }
  return {};
}

function mapAgentSkillDeliverable(asset: {
  id: string;
  profile: { name: string; summary: string; assetType: string; category: string };
  sourceRobot: { id: string; name: string } | null;
  lastUsedAt: number | null;
  lifecycle: SkillLifecycleState;
  deliverableArtifact?: DeliverableArtifactRef;
}): WorkspaceDeliverable | null {
  if (!asset.sourceRobot) {
    return null;
  }
  const robotId = asset.sourceRobot.id.trim();
  const rawRobotName = asset.sourceRobot.name.trim();
  const primaryCreatorName =
    (rawRobotName && !looksLikeOpaqueDeliverableCreatorId(rawRobotName)
      ? rawRobotName
      : undefined) ||
    resolveConfiguredAgentDisplayName(robotId) ||
    rawRobotName ||
    undefined;
  return enrichWorkspaceDeliverableArtifactFields({
    deliverableId: `skill:${asset.id}`,
    title: asset.profile.name,
    kind: inferDeliverableKind(asset.profile.name, asset.profile.category),
    source: "agent",
    creators: [robotId || rawRobotName],
    primaryCreatorName,
    status: mapSkillLifecycleToDeliverableStatus(asset.lifecycle),
    updatedAtMs: asset.lastUsedAt ?? Date.now(),
    contentType: asset.profile.assetType,
    ...resolveDeliverableArtifactFields(asset.deliverableArtifact),
  });
}

function shouldSurfaceSkillAssetAsDeliverable(asset: {
  profile: { assetType: string; category: string };
}): boolean {
  if (asset.profile.assetType !== "knowledge") {
    return true;
  }
  const category = asset.profile.category.trim();
  // Knowledge-universe uploads / collects are already first-class knowledge documents.
  // Showing them again in 成果中心 makes them look like agent-generated outputs.
  if (category === "上传文档" || category === "知识收录") {
    return false;
  }
  return true;
}

export async function listWorkspaceDeliverables(
  params: ListWorkspaceDeliverablesParams,
): Promise<ListWorkspaceDeliverablesResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const { groupRootDir, groupStorage, objectStorage } = createWorkspaceCollaborationStores();

  const discoveredGroupIds = await listWorkspaceCollaborationGroupIds(groupRootDir);
  const scopedGroupIds = params.groupIds?.map((id) => id.trim()).filter(Boolean) ?? [];
  const groupIds =
    scopedGroupIds.length > 0
      ? discoveredGroupIds.filter((groupId) => scopedGroupIds.includes(groupId))
      : discoveredGroupIds;

  const deliverables: WorkspaceDeliverable[] = [];

  for (const groupId of groupIds) {
    const [profile, members] = await Promise.all([
      groupStorage.readProfile(groupId),
      groupStorage.readMembers(groupId),
    ]);
    if (!members.some((member) => isActiveMember(member, params.userId))) {
      continue;
    }
    const groupTitle = profile?.displayName?.trim() || profile?.groupCode?.trim() || groupId;
    const groupDeliverables = await objectStorage.listObjects<Deliverable>(groupId, "deliverable");
    // Only surface the FINAL version of each deliverable: an edited-many-times article must show
    // once (the latest), not one row per revision. Drop explicitly superseded versions and any
    // version another one supersedes via previousVersionId (i.e. keep the version-chain head).
    const supersededVersionIds = new Set(
      groupDeliverables
        .map((item) => item.previousVersionId?.trim())
        .filter((id): id is string => Boolean(id)),
    );
    for (const item of groupDeliverables) {
      if (item.status === "superseded") {
        continue;
      }
      if (supersededVersionIds.has(item.deliverableId)) {
        continue;
      }
      deliverables.push(
        mapCollaborationDeliverable({
          deliverable: item,
          groupId,
          groupTitle,
          members,
        }),
      );
    }
  }

  // Agent skill-asset deliverables live in a single machine-global store with no
  // per-user partition, so they must be scoped here. When `visibleAgentIds` is
  // provided (employee/enterprise actor present), only surface assets whose
  // source robot is an agent the caller owns/controls; when omitted (local /
  // admin / platform views), preserve back-compat and include them all.
  const visibleAgentIdSet = params.visibleAgentIds
    ? new Set(
        params.visibleAgentIds.map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0),
      )
    : null;
  // Owner used to scope builtin-steward assets back to the caller (see below).
  const stewardOwnerUserId = params.userId?.trim() || null;
  for (const asset of listPersonalSkillAssets()) {
    if (!shouldSurfaceSkillAssetAsDeliverable(asset)) {
      continue;
    }
    if (visibleAgentIdSet) {
      const robotId = asset.sourceRobot?.id?.trim().toLowerCase();
      if (!robotId) {
        continue;
      }
      if (isBuiltinStewardAgent(robotId)) {
        // The builtin steward (大白) reuses agent `main`, so a plain agent-id
        // match would leak every user's steward output from the machine-global
        // skill store. Surface a steward asset only when it was captured in
        // THIS caller's own employee steward session: the session key (persisted
        // as `sourceLineageId` at capture time) embeds the owner's platform user
        // id, so ownership is verifiable without an owner column on the asset.
        const lineageSessionKey = asset.sourceLineageId?.trim();
        const ownedByCaller =
          Boolean(stewardOwnerUserId) &&
          Boolean(lineageSessionKey) &&
          isEmployeeBuiltinStewardSessionOwnedByUser({
            sessionKey: lineageSessionKey as string,
            platformUserId: stewardOwnerUserId as string,
          });
        if (!ownedByCaller) {
          continue;
        }
      } else if (!visibleAgentIdSet.has(robotId)) {
        continue;
      }
    }
    const mapped = mapAgentSkillDeliverable(asset);
    if (mapped) {
      deliverables.push(mapped);
    }
  }

  const filtered = deliverables
    .filter((item) => (params.source ? item.source === params.source : true))
    .filter((item) => (params.status ? item.status === params.status : true))
    .toSorted((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, limit);

  return { deliverables: filtered };
}
