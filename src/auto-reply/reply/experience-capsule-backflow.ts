/**
 * 失败 → 候选经验胶囊 的落盘链路（fire-and-forget，绝不影响回复）。
 *
 * 与 `collaboration-learning-backflow.ts`（压缩前存档，自动晋升）的区别：
 *  - 触发源是**真实失败/驳回/接管**，不是"上下文快满了"；
 *  - 落盘状态是 `candidate`，**不自动晋升**，必须走审批（`capsule-governance.ts`）；
 *  - 单聊也有作用域（`agent:<agentId>`），失败经验不会因为没有群而丢掉。
 */

import type {
  GroupMemoryCapsule,
  ParticipationConfidentialityTier,
} from "@openbot/collaboration-core";
import type { SessionEntry } from "../../config/sessions.js";
import {
  deriveCandidateCapsule,
  type ExperienceTrigger,
} from "../../gateway/agent-growth/experience-capsule.js";
import { resolveSessionParticipationOverlay } from "../../gateway/collaboration-learning/session-participation-overlay.js";
import { createWorkspaceCollaborationStores } from "../../gateway/collaboration-learning/shared.js";
import { logVerbose } from "../../globals.js";
import { resolvePersonalLearningScopeId } from "./learning-recall.js";

export type ExperienceScope = {
  scopeId: string;
  botId: string;
  confidentialityTier: ParticipationConfidentialityTier;
  participationId?: string;
};

function normalizeConfidentialityTier(
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

/**
 * 解析经验作用域：优先协作群，其次单聊个人作用域。
 *
 * 纯函数，便于单测（不读盘）。
 */
export function resolveExperienceScope(params: {
  agentId?: string | null;
  sessionEntry?: SessionEntry;
}): ExperienceScope | null {
  const overlay = resolveSessionParticipationOverlay({
    field: params.sessionEntry?.collaborationParticipationOverlay,
    botId: params.agentId,
  });
  const groupId =
    params.sessionEntry?.collaborationGroupProfile?.groupId?.trim() ??
    params.sessionEntry?.groupId?.trim();
  const participationId = overlay?.participationId?.trim();
  const groupBotId = overlay?.botId?.trim() ?? participationId?.split("::").at(1)?.trim();
  const confidentialityTier = normalizeConfidentialityTier(
    overlay?.confidentialityTier ??
      params.sessionEntry?.collaborationGroupProfile?.confidentialityTier ??
      "internal",
  );

  if (groupId && groupBotId) {
    return {
      scopeId: groupId,
      botId: groupBotId,
      confidentialityTier,
      ...(participationId ? { participationId } : {}),
    };
  }

  const agentId = params.agentId?.trim();
  if (!agentId) {
    return null;
  }
  return {
    scopeId: resolvePersonalLearningScopeId(agentId),
    botId: agentId,
    confidentialityTier,
  };
}

export type RecordExperienceParams = {
  trigger: ExperienceTrigger;
  agentId?: string | null;
  sessionEntry?: SessionEntry;
  reason: string;
  detail?: string | null;
  sessionKey?: string;
  atMs?: number;
};

export type RecordExperienceResult = {
  skipped?: string;
  capsuleId?: string;
  scopeId?: string;
};

/** 去重窗口：同一作用域 + 同一 trigger/reason 在窗口内只留一条候选。 */
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

function isDuplicate(
  existing: GroupMemoryCapsule[],
  candidate: GroupMemoryCapsule,
  nowMs: number,
): boolean {
  return existing.some((entry) => {
    if (entry.status !== "candidate") {
      return false;
    }
    if (entry.metadata?.origin !== "experience_derivation") {
      return false;
    }
    if (entry.structuredContent?.trigger !== candidate.structuredContent?.trigger) {
      return false;
    }
    if (entry.structuredContent?.reason !== candidate.structuredContent?.reason) {
      return false;
    }
    return nowMs - (entry.updatedAt ?? entry.createdAt ?? 0) < DEDUPE_WINDOW_MS;
  });
}

export async function recordExperienceCapsule(
  params: RecordExperienceParams,
): Promise<RecordExperienceResult> {
  const scope = resolveExperienceScope({
    agentId: params.agentId,
    sessionEntry: params.sessionEntry,
  });
  if (!scope) {
    return { skipped: "missing_experience_scope" };
  }
  const now = params.atMs ?? Date.now();
  const capsule = deriveCandidateCapsule({
    trigger: params.trigger,
    scopeId: scope.scopeId,
    botId: scope.botId,
    reason: params.reason,
    detail: params.detail ?? null,
    confidentialityTier: scope.confidentialityTier,
    ...(scope.participationId ? { participationId: scope.participationId } : {}),
    ...(params.sessionKey ? { sourceIds: [params.sessionKey] } : {}),
    atMs: now,
  });
  if (!capsule) {
    return { skipped: "insufficient_experience_input" };
  }

  const { learningStorage } = createWorkspaceCollaborationStores();
  const existing = await learningStorage.readCapsules(scope.scopeId);
  if (isDuplicate(existing, capsule, now)) {
    return { skipped: "duplicate_experience", scopeId: scope.scopeId };
  }
  await learningStorage.appendCapsule(scope.scopeId, capsule);
  return { capsuleId: capsule.capsuleId, scopeId: scope.scopeId };
}

/** 永不 reject 的包装，供 runner 失败路径 fire-and-forget 调用。 */
export function recordExperienceCapsuleSafely(params: RecordExperienceParams): void {
  void recordExperienceCapsule(params)
    .then((result) => {
      logVerbose(
        `experience capsule: trigger=${params.trigger} reason=${params.reason} ` +
          `scope=${result.scopeId ?? "none"} capsule=${result.capsuleId ?? "none"} ` +
          `skipped=${result.skipped ?? "none"}`,
      );
    })
    .catch((err) => {
      logVerbose(`experience capsule failed: ${String(err)}`);
    });
}
