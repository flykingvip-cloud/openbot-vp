import { MENTION_ALL_AGENT_ID } from "../../../../../src/organization/mention-target.js";
import type {
  MentionCandidate,
  MentionMetadata,
} from "../../../../../src/organization/mention-types.js";
import { createMentionId } from "./mention-serializer.ts";

const ALL_DISPLAY_NAMES = new Set(["所有人", "all", "everyone"]);

/**
 * Extract structured mention metadata from plain message text by matching
 * `@displayName` against known candidates (longest displayName first).
 */
export function buildMentionsFromMessage(
  message: string,
  candidates: MentionCandidate[],
  options?: { createMentionId?: () => string },
): MentionMetadata[] {
  if (!message.includes("@")) {
    return [];
  }
  const aliases = candidates.flatMap((candidate) => {
    const texts = [candidate.displayName, candidate.userId, candidate.agentId];
    return texts
      .map((value) => value?.trim() ?? "")
      .filter((value) => value.length > 0)
      .map((text) => ({ text, candidate }));
  });
  const ranked = aliases.toSorted((left, right) => right.text.length - left.text.length);
  const mentions: MentionMetadata[] = [];
  const occupied = new Set<number>();
  const mintId = options?.createMentionId ?? createMentionId;

  const tryAdd = (
    displayName: string,
    build: (offset: number, length: number) => MentionMetadata,
  ) => {
    const needle = `@${displayName}`;
    let from = 0;
    while (from < message.length) {
      const offset = message.indexOf(needle, from);
      if (offset < 0) {
        break;
      }
      const length = needle.length;
      const overlaps = Array.from({ length }, (_, index) => offset + index).some((index) =>
        occupied.has(index),
      );
      if (!overlaps) {
        mentions.push(build(offset, length));
        for (let index = offset; index < offset + length; index += 1) {
          occupied.add(index);
        }
      }
      from = offset + length;
    }
  };

  for (const { text, candidate } of ranked) {
    tryAdd(text, (offset, length) => {
      if (candidate.kind === "human" || candidate.userId) {
        const userId = candidate.userId ?? "";
        return {
          mention_id: mintId(),
          displayName: candidate.displayName,
          offset,
          length,
          target: { kind: "human", userId },
          targetKind: "human",
          targetId: userId,
        };
      }
      if (candidate.kind === "all" || candidate.agentId === MENTION_ALL_AGENT_ID) {
        return {
          mention_id: mintId(),
          agentId: MENTION_ALL_AGENT_ID,
          displayName: candidate.displayName,
          offset,
          length,
          target: { kind: "all" },
          targetKind: "all",
          targetId: MENTION_ALL_AGENT_ID,
        };
      }
      if (candidate.kind === "plugin") {
        const pluginId = candidate.agentId.trim();
        return {
          mention_id: mintId(),
          displayName: candidate.displayName,
          offset,
          length,
          target: { kind: "plugin", pluginId },
          targetKind: "plugin",
          targetId: pluginId,
        };
      }
      return {
        mention_id: mintId(),
        agentId: candidate.agentId,
        displayName: candidate.displayName,
        offset,
        length,
        target: { kind: "agent", agentId: candidate.agentId },
        targetKind: "agent",
        targetId: candidate.agentId,
      };
    });
  }

  // Bare @所有人 / @all when not present as a candidate entry.
  for (const displayName of ALL_DISPLAY_NAMES) {
    tryAdd(displayName, (offset, length) => ({
      mention_id: mintId(),
      agentId: MENTION_ALL_AGENT_ID,
      displayName,
      offset,
      length,
      target: { kind: "all" },
      targetKind: "all",
      targetId: MENTION_ALL_AGENT_ID,
    }));
  }

  return mentions.toSorted((left, right) => left.offset - right.offset);
}
