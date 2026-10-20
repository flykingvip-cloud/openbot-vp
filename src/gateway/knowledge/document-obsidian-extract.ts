/**
 * P2: extract Obsidian-style explicit signals from Markdown.
 * Frontmatter reuses src/markdown/frontmatter.ts (no second YAML stack).
 */
import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";

export type ObsidianWikilink = {
  /** Target note/page name (before | alias). */
  target: string;
  alias?: string;
  raw: string;
};

export type ObsidianExplicitMetadata = {
  wikilinks: ObsidianWikilink[];
  tags: string[];
  frontmatter: Record<string, string>;
};

const WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g;
const HASHTAG_RE = /(^|[\s([{])#([^\s#\]),.;:!?/\\]+)/g;

function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#/, "")
    .replace(/[.,;:!?)]+$/g, "")
    .toLowerCase();
}

function normalizeTitleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/\.markdown$/i, "")
    .replace(/\s+/g, " ");
}

export function extractObsidianWikilinks(text: string): ObsidianWikilink[] {
  const links: ObsidianWikilink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKILINK_RE)) {
    const raw = match[1]?.trim() ?? "";
    if (!raw) {
      continue;
    }
    // Strip block/heading anchors: Page#heading or Page^block
    const withoutAnchor = raw.split(/[#^]/)[0] ?? raw;
    const [targetPart, aliasPart] = withoutAnchor.split("|");
    const target = (targetPart ?? "").trim();
    if (!target) {
      continue;
    }
    const alias = aliasPart?.trim() || undefined;
    const key = `${target}::${alias ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    links.push({ target, alias, raw: match[0] ?? `[[${raw}]]` });
  }
  return links;
}

export function extractObsidianHashtags(text: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(HASHTAG_RE)) {
    const raw = match[2] ?? "";
    const tag = normalizeTag(raw);
    if (!tag || tag.length < 2) {
      continue;
    }
    // Skip pure numbers / hex colors-ish
    if (/^\d+$/.test(tag)) {
      continue;
    }
    if (seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function tagsFromFrontmatter(frontmatter: Record<string, string>): string[] {
  const raw = frontmatter.tags ?? frontmatter.tag ?? "";
  if (!raw.trim()) {
    return [];
  }
  // Support JSON array string from structured frontmatter, or comma/space lists.
  let candidates: string[] = [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        candidates = parsed.map((item) => String(item));
      }
    } catch {
      candidates = trimmed
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((item) => item.replace(/^["'\s]+|["'\s]+$/g, ""));
    }
  } else {
    candidates = trimmed.split(/[,\s]+/).map((item) => item.trim());
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    const tag = normalizeTag(item);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/**
 * Extract explicit Obsidian metadata from Markdown/plain text.
 * Non-markdown content still benefits from wikilink/hashtag scan when present.
 */
export function extractObsidianExplicitMetadata(text: string): ObsidianExplicitMetadata {
  const frontmatter = parseFrontmatterBlock(text);
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const wikilinks = extractObsidianWikilinks(body);
  const hashTags = extractObsidianHashtags(body);
  const fmTags = tagsFromFrontmatter(frontmatter);
  const tags = [...new Set([...fmTags, ...hashTags])];
  return {
    wikilinks,
    tags,
    frontmatter,
  };
}

export function titleKeysForWikilinkTarget(target: string): string[] {
  const base = normalizeTitleKey(target);
  if (!base) {
    return [];
  }
  const keys = new Set<string>([base]);
  // path/to/Note → note basename
  const slash = base.lastIndexOf("/");
  if (slash >= 0) {
    keys.add(base.slice(slash + 1));
  }
  return [...keys];
}

export function normalizeKnowledgeTitleKey(title: string): string {
  return normalizeTitleKey(title);
}
