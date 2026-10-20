/**
 * Runtime mapping layer (layer 3): sourceDescriptorId ↔ docId via relativePath.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../../utils.js";
import type { SourceDocumentLink, SourceDocumentLinkState } from "./local-folder-types.js";

type SourceDocumentLinkStoreFile = {
  links: Record<string, SourceDocumentLink>;
};

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "source-document-links.json");

export function defaultSourceDocumentLinkStorePath(): string {
  return DEFAULT_STORE_FILE;
}

function linkKey(sourceDescriptorId: string, relativePath: string): string {
  return `${sourceDescriptorId}::${relativePath.replace(/\\/g, "/")}`;
}

function readStore(storePath: string): SourceDocumentLinkStoreFile {
  try {
    if (!fs.existsSync(storePath)) {
      return { links: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const links =
      typeof record.links === "object" && record.links !== null && !Array.isArray(record.links)
        ? (record.links as Record<string, SourceDocumentLink>)
        : {};
    return { links };
  } catch {
    return { links: {} };
  }
}

function writeStore(store: SourceDocumentLinkStoreFile, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function upsertSourceDocumentLink(
  link: SourceDocumentLink,
  storePath: string = DEFAULT_STORE_FILE,
): SourceDocumentLink {
  const store = readStore(storePath);
  const key = linkKey(link.sourceDescriptorId, link.relativePath);
  const existing = store.links[key];
  const next: SourceDocumentLink = {
    ...existing,
    ...link,
    relativePath: link.relativePath.replace(/\\/g, "/"),
  };
  store.links[key] = next;
  writeStore(store, storePath);
  return next;
}

export function listSourceDocumentLinks(
  filter: { sourceDescriptorId?: string; state?: SourceDocumentLinkState } = {},
  storePath: string = DEFAULT_STORE_FILE,
): SourceDocumentLink[] {
  const store = readStore(storePath);
  return Object.values(store.links)
    .filter((item) =>
      filter.sourceDescriptorId ? item.sourceDescriptorId === filter.sourceDescriptorId : true,
    )
    .filter((item) => (filter.state ? item.state === filter.state : true));
}

/** Lookup by projected document id (layer 3). Prefers active links when duplicates exist. */
export function findSourceDocumentLinkByDocId(
  docId: string,
  storePath: string = DEFAULT_STORE_FILE,
): SourceDocumentLink | null {
  const trimmed = docId.trim();
  if (!trimmed) {
    return null;
  }
  const matches = listSourceDocumentLinks({}, storePath).filter((item) => item.docId === trimmed);
  if (matches.length === 0) {
    return null;
  }
  return matches.find((item) => item.state === "active") ?? matches[0] ?? null;
}

export function countActiveSourceDocumentLinks(
  sourceDescriptorId: string,
  storePath: string = DEFAULT_STORE_FILE,
): number {
  return listSourceDocumentLinks({ sourceDescriptorId, state: "active" }, storePath).length;
}

export function updateSourceDocumentLinkState(
  params: {
    sourceDescriptorId: string;
    relativePath: string;
    state: SourceDocumentLinkState;
    lastSeenAt?: number;
  },
  storePath: string = DEFAULT_STORE_FILE,
): SourceDocumentLink | null {
  const store = readStore(storePath);
  const key = linkKey(params.sourceDescriptorId, params.relativePath);
  const existing = store.links[key];
  if (!existing) {
    return null;
  }
  const next: SourceDocumentLink = {
    ...existing,
    state: params.state,
    lastSeenAt: params.lastSeenAt ?? existing.lastSeenAt,
  };
  store.links[key] = next;
  writeStore(store, storePath);
  return next;
}

export function deleteSourceDocumentLinksForDocId(
  docId: string,
  storePath: string = DEFAULT_STORE_FILE,
): number {
  const trimmed = docId.trim();
  if (!trimmed) {
    return 0;
  }
  const store = readStore(storePath);
  let removed = 0;
  for (const [key, link] of Object.entries(store.links)) {
    if (link.docId === trimmed) {
      delete store.links[key];
      removed += 1;
    }
  }
  if (removed > 0) {
    writeStore(store, storePath);
  }
  return removed;
}

export function deleteSourceDocumentLinksForSource(
  sourceDescriptorId: string,
  storePath: string = DEFAULT_STORE_FILE,
): number {
  const store = readStore(storePath);
  let removed = 0;
  for (const [key, link] of Object.entries(store.links)) {
    if (link.sourceDescriptorId === sourceDescriptorId) {
      delete store.links[key];
      removed += 1;
    }
  }
  if (removed > 0) {
    writeStore(store, storePath);
  }
  return removed;
}
