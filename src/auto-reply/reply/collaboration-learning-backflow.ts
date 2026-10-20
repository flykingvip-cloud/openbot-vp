import fs from "node:fs";
import path from "node:path";
import type { ParticipationConfidentialityTier } from "@openbot/collaboration-core";
import type { SessionEntry } from "../../config/sessions.js";
import { recordMemoryFlushSatisfactionBestEffort } from "../../gateway/collaboration-learning/collaboration-satisfaction.js";
import {
  recordMemoryFlushOutcomeCapsule,
  type MemoryFlushOutcomeInput,
} from "../../gateway/collaboration-learning/memory-flush-outcome-capsule.js";
import { resolveSessionParticipationOverlay } from "../../gateway/collaboration-learning/session-participation-overlay.js";
import { logVerbose } from "../../globals.js";
import type { MemoryFlushCompletionEvent } from "./agent-runner-memory.js";

type CollaborationLearningScope = {
  groupId: string;
  botId: string;
  participationId?: string;
  confidentialityTier: ParticipationConfidentialityTier;
};

type CollaborationLearningBackflowResult = {
  skipped?: string;
  capsuleId?: string;
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

function resolveScope(sessionEntry?: SessionEntry): CollaborationLearningScope | null {
  const groupId =
    sessionEntry?.collaborationGroupProfile?.groupId?.trim() ?? sessionEntry?.groupId?.trim();
  // Shared space sessions store overlays per botId; without a bot hint only a
  // single-entry bag / legacy overlay resolves (no cross-bot guess).
  const overlay = resolveSessionParticipationOverlay({
    field: sessionEntry?.collaborationParticipationOverlay,
  });
  const participationId = overlay?.participationId?.trim();
  const botId = overlay?.botId?.trim() ?? participationId?.split("::").at(1)?.trim();
  if (!groupId || !botId) {
    return null;
  }
  return {
    groupId,
    botId,
    ...(participationId ? { participationId } : {}),
    confidentialityTier: normalizeConfidentialityTier(
      overlay?.confidentialityTier ??
        sessionEntry?.collaborationGroupProfile?.confidentialityTier ??
        "internal",
    ),
  };
}

function resolveMemoryFlushAbsolutePath(params: {
  workspaceDir: string;
  relativePath: string;
}): string | null {
  const workspaceRoot = path.resolve(params.workspaceDir);
  const absolutePath = path.resolve(workspaceRoot, params.relativePath);
  const relative = path.relative(workspaceRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return absolutePath;
}

async function readAppendedMemoryFlushMarkdown(
  event: MemoryFlushCompletionEvent,
): Promise<string | null> {
  const absolutePath = resolveMemoryFlushAbsolutePath({
    workspaceDir: event.workspaceDir,
    relativePath: event.memoryFlushWritePath,
  });
  if (!absolutePath) {
    return null;
  }

  let raw = "";
  try {
    raw = await fs.promises.readFile(absolutePath, "utf-8");
  } catch {
    return null;
  }

  const beforeBytes = Math.max(0, event.memoryFlushFileSizeBefore);
  if (beforeBytes <= 0) {
    return raw.trim() ? raw : null;
  }

  const fullBuffer = Buffer.from(raw, "utf-8");
  const appended = fullBuffer.subarray(Math.min(beforeBytes, fullBuffer.length)).toString("utf-8");
  return appended.trim() ? appended : null;
}

function toMemoryFlushOutcomeInput(
  event: MemoryFlushCompletionEvent,
  scope: CollaborationLearningScope,
  appendedMarkdown: string,
): MemoryFlushOutcomeInput {
  return {
    groupId: scope.groupId,
    botId: scope.botId,
    ...(scope.participationId ? { participationId: scope.participationId } : {}),
    confidentialityTier: scope.confidentialityTier,
    memoryFlushWritePath: event.memoryFlushWritePath,
    appendedMarkdown,
    flushedAt: event.flushedAt,
    memoryCompactionCompleted: event.memoryCompactionCompleted,
    workspaceDir: event.workspaceDir,
    ...(event.sessionKey ? { sessionKey: event.sessionKey } : {}),
    ...(event.result.meta?.agentMeta?.sessionId
      ? { sessionId: event.result.meta.agentMeta.sessionId }
      : {}),
  };
}

/**
 * Memory flush 协作学习回流：产出 candidate 胶囊，走与 task/review 相同的治理审批链。
 * 投影/晋升仅在 `collaboration.capsule.transition(approved)` 后发生。
 */
export async function runCollaborationLearningBackflow(
  event: MemoryFlushCompletionEvent,
): Promise<CollaborationLearningBackflowResult> {
  const scope = resolveScope(event.sessionEntry);
  if (!scope) {
    return { skipped: "missing_collaboration_scope" };
  }

  const appendedMarkdown = await readAppendedMemoryFlushMarkdown(event);
  if (!appendedMarkdown) {
    void recordMemoryFlushSatisfactionBestEffort({ botId: scope.botId });
    return { skipped: "no_appended_memory" };
  }

  const result = await recordMemoryFlushOutcomeCapsule(
    toMemoryFlushOutcomeInput(event, scope, appendedMarkdown),
  );
  void recordMemoryFlushSatisfactionBestEffort({ botId: scope.botId });
  return {
    ...(result.capsuleId ? { capsuleId: result.capsuleId } : {}),
    ...(result.skipped ? { skipped: result.skipped } : {}),
  };
}

export async function runCollaborationLearningBackflowSafely(
  event: MemoryFlushCompletionEvent,
): Promise<void> {
  try {
    const result = await runCollaborationLearningBackflow(event);
    logVerbose(
      `collaboration learning backflow: sessionKey=${event.sessionKey ?? "unknown"} ` +
        `groupId=${event.sessionEntry?.collaborationGroupProfile?.groupId ?? event.sessionEntry?.groupId ?? "unknown"} ` +
        `capsule=${result.capsuleId ?? "none"} skipped=${result.skipped ?? "none"}`,
    );
  } catch (err) {
    logVerbose(`collaboration learning backflow failed: ${String(err)}`);
  }
}
