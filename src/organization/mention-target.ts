/**
 * Mention target helpers — normalize legacy `{ agentId }` payloads into a
 * discriminated `MentionTarget` without disguising human userIds as agentIds.
 */

import type { MentionMetadata, MentionTarget } from "./mention-types.js";

export const MENTION_ALL_AGENT_ID = "__all__";

export function isMentionTarget(value: unknown): value is MentionTarget {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "all") {
    return true;
  }
  if (record.kind === "agent") {
    return typeof record.agentId === "string" && record.agentId.trim().length > 0;
  }
  if (record.kind === "human") {
    return typeof record.userId === "string" && record.userId.trim().length > 0;
  }
  if (record.kind === "plugin") {
    return typeof record.pluginId === "string" && record.pluginId.trim().length > 0;
  }
  return false;
}

/** Resolve the canonical target from new or legacy mention metadata. */
export function resolveMentionTarget(mention: {
  target?: MentionTarget;
  agentId?: string;
  targetKind?: "agent" | "human" | "all" | "plugin";
  targetId?: string;
}): MentionTarget | null {
  if (mention.target && isMentionTarget(mention.target)) {
    return mention.target;
  }
  if (mention.targetKind === "all") {
    return { kind: "all" };
  }
  if (mention.targetKind === "human" && typeof mention.targetId === "string" && mention.targetId) {
    return { kind: "human", userId: mention.targetId };
  }
  if (mention.targetKind === "plugin" && typeof mention.targetId === "string" && mention.targetId) {
    return { kind: "plugin", pluginId: mention.targetId };
  }
  if (mention.targetKind === "agent" && typeof mention.targetId === "string" && mention.targetId) {
    return { kind: "agent", agentId: mention.targetId };
  }
  const agentId = typeof mention.agentId === "string" ? mention.agentId.trim() : "";
  if (!agentId) {
    return null;
  }
  if (agentId === MENTION_ALL_AGENT_ID) {
    return { kind: "all" };
  }
  return { kind: "agent", agentId };
}

/** Normalize mention metadata for transport (keeps legacy agentId when applicable). */
export function normalizeMentionMetadata(mention: MentionMetadata): MentionMetadata {
  const target = resolveMentionTarget(mention);
  if (!target) {
    return mention;
  }
  if (target.kind === "all") {
    return {
      ...mention,
      target,
      agentId: MENTION_ALL_AGENT_ID,
      targetKind: "all",
      targetId: MENTION_ALL_AGENT_ID,
    };
  }
  if (target.kind === "agent") {
    return {
      ...mention,
      target,
      agentId: target.agentId,
      targetKind: "agent",
      targetId: target.agentId,
    };
  }
  if (target.kind === "plugin") {
    // plugin — never invent an agentId disguise (same rule as humans)
    const { agentId: _discard, ...rest } = mention;
    return {
      ...rest,
      target,
      targetKind: "plugin",
      targetId: target.pluginId,
    };
  }
  // human — never invent an agentId disguise
  const { agentId: _discard, ...rest } = mention;
  return {
    ...rest,
    target,
    targetKind: "human",
    targetId: target.userId,
  };
}

export function mentionTargetKey(target: MentionTarget): string {
  if (target.kind === "all") {
    return "all";
  }
  if (target.kind === "agent") {
    return `agent:${target.agentId}`;
  }
  if (target.kind === "plugin") {
    return `plugin:${target.pluginId}`;
  }
  return `human:${target.userId}`;
}
