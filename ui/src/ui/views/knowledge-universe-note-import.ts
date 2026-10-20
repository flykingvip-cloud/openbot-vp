export const NOTE_TAG_HISTORY_STORAGE_KEY = "openbot.ku.note-tag-history";
export const NOTE_TAG_HISTORY_LIMIT = 24;

export const DEFAULT_NOTE_TAG_SUGGESTIONS = [
  "效率提升",
  "知识管理",
  "会议纪要",
  "产品设计",
  "技术方案",
  "灵感片段",
  "项目复盘",
  "学习笔记",
] as const;

const NOTE_TAG_RULES: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /会议|纪要|sync|meeting|standup/i, tag: "会议纪要" },
  { pattern: /效率|提效|productivity|自动化/i, tag: "效率提升" },
  { pattern: /知识库|知识管理|沉淀|knowledge/i, tag: "知识管理" },
  { pattern: /产品|需求|prd|用户故事/i, tag: "产品设计" },
  { pattern: /架构|api|代码|技术|实现|bug|修复/i, tag: "技术方案" },
  { pattern: /灵感|想法|idea|洞察/i, tag: "灵感片段" },
  { pattern: /复盘|回顾|总结|retrospective/i, tag: "项目复盘" },
  { pattern: /学习|教程|笔记|study/i, tag: "学习笔记" },
];

export function parseNoteTagsInput(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeNoteTags(tags: string[]): string {
  return tags.join(", ");
}

export function normalizeNoteTag(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function addNoteTag(tags: string[], raw: string): string[] {
  const next = normalizeNoteTag(raw);
  if (!next) {
    return tags;
  }
  const exists = tags.some((tag) => tag.toLowerCase() === next.toLowerCase());
  if (exists) {
    return tags;
  }
  return [...tags, next];
}

export function removeNoteTag(tags: string[], tag: string): string[] {
  return tags.filter((entry) => entry !== tag);
}

export function readNoteTagHistory(): string[] {
  if (typeof localStorage === "undefined") {
    return [...DEFAULT_NOTE_TAG_SUGGESTIONS];
  }
  try {
    const raw = localStorage.getItem(NOTE_TAG_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [...DEFAULT_NOTE_TAG_SUGGESTIONS];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_NOTE_TAG_SUGGESTIONS];
    }
    const cleaned = parsed
      .map((item) => (typeof item === "string" ? normalizeNoteTag(item) : ""))
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : [...DEFAULT_NOTE_TAG_SUGGESTIONS];
  } catch {
    return [...DEFAULT_NOTE_TAG_SUGGESTIONS];
  }
}

export function rememberNoteTags(tags: string[]): void {
  if (typeof localStorage === "undefined" || tags.length === 0) {
    return;
  }
  const merged = [...tags, ...readNoteTagHistory()].filter(
    (tag, index, list) =>
      list.findIndex((entry) => entry.toLowerCase() === tag.toLowerCase()) === index,
  );
  localStorage.setItem(
    NOTE_TAG_HISTORY_STORAGE_KEY,
    JSON.stringify(merged.slice(0, NOTE_TAG_HISTORY_LIMIT)),
  );
}

export function filterNoteTagSuggestions(params: {
  history: string[];
  selected: string[];
  query: string;
  limit?: number;
}): string[] {
  const needle = params.query.trim().toLowerCase();
  const selected = new Set(params.selected.map((tag) => tag.toLowerCase()));
  const pool = [...params.history, ...DEFAULT_NOTE_TAG_SUGGESTIONS];
  const unique: string[] = [];
  for (const tag of pool) {
    const normalized = normalizeNoteTag(tag);
    if (!normalized || selected.has(normalized.toLowerCase())) {
      continue;
    }
    if (unique.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      continue;
    }
    if (needle && !normalized.toLowerCase().includes(needle)) {
      continue;
    }
    unique.push(normalized);
    if (unique.length >= (params.limit ?? 8)) {
      break;
    }
  }
  return unique;
}

export function extractNoteTitleFromContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }
  const firstLine =
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? trimmed;
  if (firstLine.length <= 48) {
    return firstLine;
  }
  const sentence = firstLine.match(/^[^。！？.!?]{1,48}/)?.[0]?.trim();
  return sentence && sentence.length > 0 ? sentence : `${firstLine.slice(0, 48).trim()}…`;
}

export function suggestNoteTagsFromContent(content: string, limit = 3): string[] {
  const haystack = content.trim();
  if (!haystack) {
    return [];
  }
  const tags: string[] = [];
  for (const rule of NOTE_TAG_RULES) {
    if (rule.pattern.test(haystack) && !tags.includes(rule.tag)) {
      tags.push(rule.tag);
    }
    if (tags.length >= limit) {
      return tags;
    }
  }
  if (tags.length === 0) {
    tags.push(haystack.split(/\r?\n/).filter(Boolean).length > 3 ? "会议纪要" : "灵感片段");
  }
  if (tags.length < 2 && !tags.includes("知识管理")) {
    tags.push("知识管理");
  }
  return tags.slice(0, limit);
}

export function suggestNoteMetadataFromContent(content: string): {
  title: string;
  tags: string[];
} {
  return {
    title: extractNoteTitleFromContent(content),
    tags: suggestNoteTagsFromContent(content),
  };
}

export function createEmptyNoteImportState() {
  return {
    libraryWorkspaceNoteTags: [] as string[],
    libraryWorkspaceNoteTagDraft: "",
    libraryWorkspaceNoteTagSuggestionsOpen: false,
    libraryWorkspaceNoteAiBusy: false,
  };
}
