/**
 * P2 store for Obsidian-style explicit graph metadata per ingested document.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type { ObsidianExplicitMetadata } from "./document-obsidian-extract.js";

export type ExplicitDocumentMetadataRecord = {
  docId: string;
  title: string;
  knowledgeBaseId?: string;
  wikilinks: ObsidianExplicitMetadata["wikilinks"];
  tags: string[];
  frontmatter: Record<string, string>;
  updatedAtMs: number;
};

type ExplicitMetadataStoreFile = {
  documents: Record<string, ExplicitDocumentMetadataRecord>;
};

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "explicit-document-metadata.json");

export function defaultExplicitMetadataStorePath(): string {
  return DEFAULT_STORE_FILE;
}

function readStore(storePath: string): ExplicitMetadataStoreFile {
  try {
    if (!fs.existsSync(storePath)) {
      return { documents: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const documents =
      typeof record.documents === "object" &&
      record.documents !== null &&
      !Array.isArray(record.documents)
        ? (record.documents as Record<string, ExplicitDocumentMetadataRecord>)
        : {};
    return { documents };
  } catch {
    return { documents: {} };
  }
}

function writeStore(store: ExplicitMetadataStoreFile, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function upsertExplicitDocumentMetadata(
  params: {
    docId: string;
    title: string;
    knowledgeBaseId?: string;
    metadata: ObsidianExplicitMetadata;
  },
  storePath: string = DEFAULT_STORE_FILE,
): ExplicitDocumentMetadataRecord {
  const store = readStore(storePath);
  const record: ExplicitDocumentMetadataRecord = {
    docId: params.docId,
    title: params.title.trim() || params.docId,
    knowledgeBaseId: params.knowledgeBaseId,
    wikilinks: params.metadata.wikilinks,
    tags: params.metadata.tags,
    frontmatter: params.metadata.frontmatter,
    updatedAtMs: Date.now(),
  };
  store.documents[params.docId] = record;
  writeStore(store, storePath);
  return record;
}

export function listExplicitDocumentMetadata(
  filter: { knowledgeBaseId?: string } = {},
  storePath: string = DEFAULT_STORE_FILE,
): ExplicitDocumentMetadataRecord[] {
  const store = readStore(storePath);
  return Object.values(store.documents).filter((item) =>
    filter.knowledgeBaseId ? item.knowledgeBaseId === filter.knowledgeBaseId : true,
  );
}

export function getExplicitDocumentMetadata(
  docId: string,
  storePath: string = DEFAULT_STORE_FILE,
): ExplicitDocumentMetadataRecord | null {
  const store = readStore(storePath);
  return store.documents[docId.trim()] ?? null;
}

export function deleteExplicitDocumentMetadata(
  docId: string,
  storePath: string = DEFAULT_STORE_FILE,
): boolean {
  const store = readStore(storePath);
  if (!store.documents[docId.trim()]) {
    return false;
  }
  delete store.documents[docId.trim()];
  writeStore(store, storePath);
  return true;
}
