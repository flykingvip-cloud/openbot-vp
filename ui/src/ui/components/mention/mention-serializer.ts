import type {
  MentionChipData,
  MentionMetadata,
} from "../../../../../src/organization/mention-types.js";

export type MentionSerializableChip = Omit<MentionChipData, "mention_id"> & {
  mention_id?: string;
};

export type MentionSerializablePart =
  | string
  | MentionSerializableChip
  | { type: "text"; text: string }
  | { type: "mention"; chip: MentionSerializableChip };

export interface MentionSerializationOptions {
  createMentionId?: () => string;
  reuseExistingMentionIds?: boolean;
}

export interface MentionSerializationResult {
  text: string;
  mentions: MentionMetadata[];
}

export interface InternalAnchorSerializationResult extends MentionSerializationResult {
  value: string;
}

export interface ParseInternalAnchorsOptions {
  resolveAgentId?: (anchor: {
    mention_id: string;
    displayName: string;
    offset: number;
    length: number;
  }) => string | null | undefined;
  defaultAgentId?: string;
}

const MENTION_ANCHOR_PATTERN = /<mention\b([^>]*)>([\s\S]*?)<\/mention>/gi;
const ATTRIBUTE_PATTERN = /([a-zA-Z_:][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;

let fallbackMentionIdCounter = 0;

export function createMentionId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  fallbackMentionIdCounter += 1;
  return `mention-${Date.now().toString(36)}-${fallbackMentionIdCounter.toString(36)}`;
}

function isMentionChip(value: MentionSerializablePart): value is MentionSerializableChip {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    "agentId" in value &&
    "displayName" in value &&
    "isAll" in value
  );
}

function normalizeMentionPart(part: MentionSerializablePart): MentionSerializableChip | null {
  if (isMentionChip(part)) {
    return part;
  }
  if (typeof part === "object" && part.type === "mention") {
    return part.chip;
  }
  return null;
}

function normalizeTextPart(part: MentionSerializablePart): string | null {
  if (typeof part === "string") {
    return part;
  }
  if (typeof part === "object" && "type" in part && part.type === "text") {
    return part.text;
  }
  return null;
}

function toPlainMentionText(chip: MentionSerializableChip): string {
  return `@${chip.displayName}`;
}

function nextMentionId(
  chip: MentionSerializableChip,
  options: MentionSerializationOptions | undefined,
): string {
  if (options?.reuseExistingMentionIds && chip.mention_id) {
    return chip.mention_id;
  }
  return (options?.createMentionId ?? createMentionId)();
}

export function serializeMentions(
  parts: MentionSerializablePart[],
  options?: MentionSerializationOptions,
): MentionSerializationResult {
  let text = "";
  const mentions: MentionMetadata[] = [];

  for (const part of parts) {
    const textPart = normalizeTextPart(part);
    if (textPart !== null) {
      text += textPart;
      continue;
    }

    const chip = normalizeMentionPart(part);
    if (!chip) {
      continue;
    }

    const mentionText = toPlainMentionText(chip);
    const mention_id = nextMentionId(chip, options);
    const isHuman = chip.kind === "human" || Boolean(chip.userId && !chip.isAll);
    if (chip.isAll || chip.kind === "all") {
      mentions.push({
        mention_id,
        agentId: chip.agentId || "__all__",
        displayName: chip.displayName,
        offset: text.length,
        length: mentionText.length,
        target: { kind: "all" },
        targetKind: "all",
        targetId: "__all__",
      });
    } else if (isHuman && chip.userId) {
      mentions.push({
        mention_id,
        displayName: chip.displayName,
        offset: text.length,
        length: mentionText.length,
        target: { kind: "human", userId: chip.userId },
        targetKind: "human",
        targetId: chip.userId,
      });
    } else if (chip.kind === "plugin" && chip.agentId) {
      mentions.push({
        mention_id,
        displayName: chip.displayName,
        offset: text.length,
        length: mentionText.length,
        target: { kind: "plugin", pluginId: chip.agentId },
        targetKind: "plugin",
        targetId: chip.agentId,
      });
    } else {
      mentions.push({
        mention_id,
        agentId: chip.agentId,
        displayName: chip.displayName,
        offset: text.length,
        length: mentionText.length,
        target: { kind: "agent", agentId: chip.agentId },
        targetKind: "agent",
        targetId: chip.agentId,
      });
    }
    text += mentionText;
  }

  return { text, mentions };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function unescapeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1]] = unescapeHtml(match[3]);
  }
  return attributes;
}

export function toInternalAnchors(
  parts: MentionSerializablePart[],
  options?: MentionSerializationOptions,
): InternalAnchorSerializationResult {
  let text = "";
  let value = "";
  const mentions: MentionMetadata[] = [];

  for (const part of parts) {
    const textPart = normalizeTextPart(part);
    if (textPart !== null) {
      text += textPart;
      value += escapeHtml(textPart);
      continue;
    }

    const chip = normalizeMentionPart(part);
    if (!chip) {
      continue;
    }

    const mentionText = toPlainMentionText(chip);
    const mention_id = nextMentionId(chip, options);
    mentions.push({
      mention_id,
      agentId: chip.agentId,
      displayName: chip.displayName,
      offset: text.length,
      length: mentionText.length,
    });
    text += mentionText;
    value += `<mention id="${escapeHtml(mention_id)}">${escapeHtml(mentionText)}</mention>`;
  }

  return { value, text, mentions };
}

export function parseInternalAnchors(
  value: string,
  options: ParseInternalAnchorsOptions = {},
): MentionSerializationResult {
  let text = "";
  const mentions: MentionMetadata[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(MENTION_ANCHOR_PATTERN)) {
    const matchIndex = match.index ?? 0;
    text += unescapeHtml(value.slice(lastIndex, matchIndex));

    const attributes = parseAttributes(match[1]);
    const mention_id = attributes.id;
    if (!mention_id) {
      text += unescapeHtml(match[0]);
      lastIndex = matchIndex + match[0].length;
      continue;
    }

    const mentionText = unescapeHtml(match[2]);
    const displayName = mentionText.startsWith("@") ? mentionText.slice(1) : mentionText;
    const plainMentionText = mentionText.startsWith("@") ? mentionText : `@${mentionText}`;
    const offset = text.length;
    const length = plainMentionText.length;
    const agentId =
      options.resolveAgentId?.({
        mention_id,
        displayName,
        offset,
        length,
      }) ??
      options.defaultAgentId ??
      mention_id;

    mentions.push({
      mention_id,
      agentId,
      displayName,
      offset,
      length,
    });
    text += plainMentionText;
    lastIndex = matchIndex + match[0].length;
  }

  text += unescapeHtml(value.slice(lastIndex));
  return { text, mentions };
}
