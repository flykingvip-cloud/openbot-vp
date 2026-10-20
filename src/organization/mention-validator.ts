import {
  MENTION_ALL_AGENT_ID,
  normalizeMentionMetadata,
  resolveMentionTarget,
} from "./mention-target.js";
import type { MentionMetadata, ValidationResult } from "./mention-types.js";
import { isMentionMetadata } from "./mention-types.js";
import type { RuntimeOrganizationContext } from "./runtime.js";

const ACTIVE_HUMAN_STATUSES = new Set(["active"]);

/**
 * Validate a mentions array against schema rules and the organization registry.
 *
 * Validation checks (in order):
 * 1. Each entry passes `isMentionMetadata()` type guard
 * 2. All `mention_id` values are unique (no duplicates)
 * 3. `offset` and `offset + length` are within message text bounds
 * 4. `message.substring(offset, offset + length)` matches "@displayName"
 * 5. Target resolves to all | agent-in-members | active-human-in-roster
 * 6. Invalid targets are marked with reason but do NOT throw
 *
 * This function is pure (no I/O, no file reads).
 */
export function validateMentions(
  mentions: unknown,
  message: string,
  context: RuntimeOrganizationContext,
): ValidationResult {
  const valid: MentionMetadata[] = [];
  const invalid: ValidationResult["invalid"] = [];

  if (!Array.isArray(mentions)) {
    return {
      valid,
      invalid: [
        {
          mention: mentions,
          reason: "Mentions payload must be an array",
        },
      ],
    };
  }

  const seenMentionIds = new Set<string>();
  const duplicateMentionIds = new Set<string>();

  for (const mention of mentions) {
    if (!isMentionMetadata(mention)) {
      continue;
    }
    if (seenMentionIds.has(mention.mention_id)) {
      duplicateMentionIds.add(mention.mention_id);
    }
    seenMentionIds.add(mention.mention_id);
  }

  const activeAgentIds = new Set(context.members.map((member) => member.agentId));
  const humansById = new Map(
    (context.humans ?? []).map((human) => [human.userId.trim().toLowerCase(), human]),
  );

  for (const mention of mentions) {
    if (!isMentionMetadata(mention)) {
      invalid.push({
        mention,
        reason: "Entry does not satisfy MentionMetadata schema",
      });
      continue;
    }

    if (duplicateMentionIds.has(mention.mention_id)) {
      invalid.push({
        mention,
        reason: `Duplicate mention_id: "${mention.mention_id}"`,
      });
      continue;
    }

    if (mention.offset + mention.length > message.length) {
      invalid.push({
        mention,
        reason: `Offset ${mention.offset} + length ${mention.length} exceeds message length ${message.length}`,
      });
      continue;
    }

    const substring = message.substring(mention.offset, mention.offset + mention.length);
    const expectedMentionText = `@${mention.displayName}`;
    if (substring !== expectedMentionText) {
      invalid.push({
        mention,
        reason: `Text at offset ${mention.offset} does not match "${expectedMentionText}"`,
      });
      continue;
    }

    const target = resolveMentionTarget(mention);
    if (!target) {
      invalid.push({
        mention,
        reason: "Mention target could not be resolved",
      });
      continue;
    }

    if (target.kind === "all") {
      valid.push(normalizeMentionMetadata({ ...mention, target, agentId: MENTION_ALL_AGENT_ID }));
      continue;
    }

    if (target.kind === "agent") {
      if (!activeAgentIds.has(target.agentId)) {
        invalid.push({
          mention,
          reason: `Agent "${target.agentId}" not found in organization members`,
        });
        continue;
      }
      valid.push(normalizeMentionMetadata({ ...mention, target, agentId: target.agentId }));
      continue;
    }

    if (target.kind === "plugin") {
      const pluginId = target.pluginId.trim();
      if (!pluginId) {
        invalid.push({
          mention,
          reason: "Plugin mention is missing pluginId",
        });
        continue;
      }
      // MCP connectors / plugins are not org members; accept as structured
      // mentions for the host agent without roster membership checks.
      valid.push(normalizeMentionMetadata({ ...mention, target }));
      continue;
    }

    // human
    const human = humansById.get(target.userId.trim().toLowerCase());
    if (!human) {
      invalid.push({
        mention,
        reason: `Human "${target.userId}" not found in collaboration group roster`,
      });
      continue;
    }
    if (!ACTIVE_HUMAN_STATUSES.has(human.status)) {
      invalid.push({
        mention,
        reason: `Human "${target.userId}" is not an active group member (status=${human.status})`,
      });
      continue;
    }
    valid.push(
      normalizeMentionMetadata({
        ...mention,
        target,
        // Prefer roster display name for downstream notifications; keep client
        // displayName for offset matching which already passed.
        displayName: mention.displayName,
      }),
    );
  }

  return { valid, invalid };
}
