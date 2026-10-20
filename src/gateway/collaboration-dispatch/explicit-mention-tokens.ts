import type { MentionMetadata } from "../../organization/mention-types.js";

/**
 * Match tokens for a structured composer mention.
 *
 * `mention_id` is a UI anchor (random UUID, or `mention-<time>-<counter>`).
 * It is not a member identity and must not be required to match.
 * Match displayName, agentId, and targetId (plus the structured target's
 * agentId / userId, which are those same ids).
 */
export function resolveExplicitMentionTokens(mentions?: MentionMetadata[]): string[] {
  return (mentions ?? []).flatMap((entry) => {
    const tokens = [entry.displayName];
    if (entry.agentId) {
      tokens.push(entry.agentId);
    }
    if (entry.target?.kind === "human" && entry.target.userId) {
      tokens.push(entry.target.userId);
    } else if (entry.target?.kind === "plugin" && entry.target.pluginId) {
      tokens.push(entry.target.pluginId);
    } else if (entry.target?.kind === "agent" && entry.target.agentId) {
      tokens.push(entry.target.agentId);
    } else if ((entry.targetKind === "human" || entry.targetKind === "plugin") && entry.targetId) {
      tokens.push(entry.targetId);
    } else if (entry.targetId) {
      tokens.push(entry.targetId);
    }
    return tokens;
  });
}
