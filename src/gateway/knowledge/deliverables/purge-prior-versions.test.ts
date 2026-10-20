// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  insertKnowledgeChunks,
  insertKnowledgeDocumentVersion,
  listKnowledgeChunksForVersion,
  listKnowledgeDocumentVersions,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
  updateKnowledgeDocumentCurrentVersion,
  upsertKnowledgeDocument,
} from "../kb-index.js";
import { purgePriorKnowledgeDocumentVersions } from "./purge-prior-versions.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-purge-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("purgePriorKnowledgeDocumentVersions", () => {
  it("keeps only the current version and deletes prior chunks", async () => {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-a",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    const docId = "doc-overwrite";
    const v1 = randomUUID();
    const v2 = randomUUID();
    const now = Date.now();
    try {
      upsertKnowledgeDocument({
        db: index.db,
        docId,
        kbId: "kb-1",
        title: "Brief",
        contentType: "markdown",
        now,
      });
      insertKnowledgeDocumentVersion({
        db: index.db,
        versionId: v1,
        docId,
        versionLabel: "V1",
        rawHash: "hash-old",
        semanticHash: "sem-old",
        now,
      });
      insertKnowledgeDocumentVersion({
        db: index.db,
        versionId: v2,
        docId,
        versionLabel: "V2",
        rawHash: "hash-new",
        semanticHash: "sem-new",
        now: now + 1,
      });
      updateKnowledgeDocumentCurrentVersion({ db: index.db, docId, versionId: v2, now: now + 1 });
      insertKnowledgeChunks({
        index,
        chunks: [
          {
            id: "chunk-old",
            text: "old body",
            model: "fts-only",
            kbId: "kb-1",
            docId,
            versionId: v1,
            heading: null,
            section: null,
            startLine: 1,
            endLine: 1,
            visibility: null,
            source: "old.md",
          },
          {
            id: "chunk-new",
            text: "new body",
            model: "fts-only",
            kbId: "kb-1",
            docId,
            versionId: v2,
            heading: null,
            section: null,
            startLine: 1,
            endLine: 1,
            visibility: null,
            source: "new.md",
          },
        ],
      });
    } finally {
      index.close();
    }

    const result = await purgePriorKnowledgeDocumentVersions({
      docId,
      ownerId: "user-a",
      indexRoot,
    });
    expect(result.keptVersionId).toBe(v2);
    expect(result.purgedVersionIds).toEqual([v1]);
    expect(result.purgedChunkIds).toEqual(["chunk-old"]);

    const verify = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const versions = listKnowledgeDocumentVersions(verify.db, docId);
      expect(versions.map((version) => version.versionId)).toEqual([v2]);
      expect(listKnowledgeChunksForVersion({ db: verify.db, docId, versionId: v1 })).toEqual([]);
      expect(
        listKnowledgeChunksForVersion({ db: verify.db, docId, versionId: v2 }).map(
          (chunk) => chunk.chunkId,
        ),
      ).toEqual(["chunk-new"]);
    } finally {
      verify.close();
    }
  });
});
