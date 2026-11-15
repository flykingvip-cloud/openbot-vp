/**
 * Production consumers for S5 owner / brief / contribution / first-stage hold
 * projections. These wrap existing stores, control locks and context assembly
 * — they are not a second scheduler or collaboration executor.
 */
import type { Task } from "@openbot/collaboration-core";
import {
  classifyAuthoritativeMemberContribution,
  evaluateFirstStageAcceptanceHold,
  isFirstStageAcceptanceHoldBlocking,
  legalOrganizerId,
  mergeFirstStageHoldTag,
  projectCollaborationWorkBrief,
  readFirstStageHoldFromTags,
  type FirstStageAcceptanceHold,
  type MemberContributionDecision,
  type MemberContributionKind,
} from "../../agent-runtime/policy/collaboration-current-goal-binding.js";
import type { TaskResponsibility } from "../../agent-runtime/policy/collaboration-policy-model.js";
import type { OpenBotConfig } from "../../config/types.js";
import { applyBusinessTaskPatchUnderControlLock } from "../collaboration-dispatch/task-control-cas.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function projectBoundTaskWorkBrief(task: Task | null | undefined): string | undefined {
  if (!task) {
    return undefined;
  }
  const responsibility = (task as Task & { responsibility?: TaskResponsibility }).responsibility;
  if (!responsibility) {
    return undefined;
  }
  return projectCollaborationWorkBrief({
    goal: compact(task.title) || compact(task.description) || compact(task.taskId),
    constraints: compact(task.description) ? [compact(task.description)] : [],
    responsibility,
  });
}

export function organizerFromTask(task: Task | null | undefined): string {
  const responsibility = (task as (Task & { responsibility?: TaskResponsibility }) | undefined)
    ?.responsibility;
  if (responsibility) {
    return legalOrganizerId(responsibility);
  }
  return compact(task?.ownerMemberId);
}

export async function persistFirstStageAcceptanceHold(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
  groupRootDir?: string;
  objectStorage?: {
    readObject: <T>(groupId: string, kind: string, id: string) => Promise<T | null>;
    writeObject: (groupId: string, kind: string, id: string, value: unknown) => Promise<void>;
  };
  ownerIntegrated: boolean;
  userAskedToWaitForAcceptance: boolean;
  memberAccepted?: boolean;
}): Promise<FirstStageAcceptanceHold> {
  const hold = evaluateFirstStageAcceptanceHold({
    ownerIntegrated: params.ownerIntegrated,
    userAskedToWaitForAcceptance: params.userAskedToWaitForAcceptance,
    memberAccepted: params.memberAccepted,
  });
  await applyBusinessTaskPatchUnderControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg: params.cfg,
    groupRootDir: params.groupRootDir,
    objectStorage: params.objectStorage,
    buildPatch: (live) => ({
      tags: mergeFirstStageHoldTag(live.tags, hold.kind),
      updatedAtMs: Date.now(),
    }),
  });
  return hold;
}

export async function recordAuthoritativeMemberContribution(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
  groupRootDir?: string;
  objectStorage?: {
    readObject: <T>(groupId: string, kind: string, id: string) => Promise<T | null>;
    writeObject: (groupId: string, kind: string, id: string, value: unknown) => Promise<void>;
  };
  actorId: string;
  memberId: string;
  kind: MemberContributionKind;
  runOwnerId?: string | null;
  artifactAuthorId?: string | null;
  artifactId?: string | null;
  runId?: string | null;
  memberStatus?: string | null;
  text?: string | null;
}): Promise<MemberContributionDecision> {
  const decision = classifyAuthoritativeMemberContribution({
    actorId: params.actorId,
    memberId: params.memberId,
    kind: params.kind,
    runOwnerId: params.runOwnerId,
    artifactAuthorId: params.artifactAuthorId,
    memberStatus: params.memberStatus,
    text: params.text,
  });
  if (!decision.accepted) {
    return decision;
  }
  await applyBusinessTaskPatchUnderControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg: params.cfg,
    groupRootDir: params.groupRootDir,
    objectStorage: params.objectStorage,
    buildPatch: (live) => {
      const note = [
        `member-contribution:${decision.kind}:${decision.actorId}`,
        params.runId ? `run:${params.runId}` : "",
        params.artifactId ? `artifact:${params.artifactId}` : "",
      ]
        .filter(Boolean)
        .join("/");
      const tags = [...(live.tags ?? [])];
      if (!tags.includes(note)) {
        tags.push(note);
      }
      const description = compact(live.description);
      const line = compact(params.text);
      return {
        tags,
        description:
          line && !description.includes(line)
            ? [description, `${decision.actorId}: ${line}`].filter(Boolean).join("\n")
            : live.description,
        ...(decision.kind === "block" && live.status !== "cancelled"
          ? { status: "blocked" as const }
          : {}),
        updatedAtMs: Date.now(),
      };
    },
  });
  return decision;
}

export function shouldSuppressWakeForFirstStageHold(
  tags: readonly string[] | null | undefined,
): boolean {
  return isFirstStageAcceptanceHoldBlocking(readFirstStageHoldFromTags(tags));
}
