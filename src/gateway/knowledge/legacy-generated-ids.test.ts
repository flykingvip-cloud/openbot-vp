import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildKnowledgeResourceId } from "../data-governance/knowledge-register.js";
import {
  getKnowledgeDocument,
  getKnowledgeChunkText,
  openKnowledgeIndex,
  upsertKnowledgeDocument,
  upsertKnowledgeChunks,
} from "./kb-index.js";
import { listKnowledgeBaseDatasetsInIndex } from "./knowledge-base-library-content.js";
import { createKnowledgeBase } from "./knowledge-base-store.js";
import {
  findSourceDocumentLinkByDocId,
  upsertSourceDocumentLink,
} from "./sources/source-document-link-store.js";

describe("persisted legacy generated knowledge IDs", () => {
  it("reads colon IDs and dataset grouping after reopen without allowing unsafe new governance writes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-legacy-ids-"));
    const dbPath = path.join(root, "legacy.db");
    const ids = [
      "dataset:0123456789abcdef0123:0",
      "dataset:0123456789abcdef0123:1",
      "srcdir:0123456789abcdef0123456789abcdef",
    ];
    let index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const kb = createKnowledgeBase(
        { title: "Legacy", ownerId: "owner-local", tenantId: null },
        path.join(root, "bases.json"),
      );
      // Persistence-level historical fixture, not a new ingest. The public
      // governance write boundary below still rejects every old colon ID.
      for (const [n, docId] of ids.entries()) {
        upsertKnowledgeDocument({
          db: index.db,
          docId,
          kbId: kb.id,
          title: `Legacy rows #${n + 1}`,
          contentType: "text/markdown",
          currentVersionId: `v-${n}`,
        });
        upsertKnowledgeChunks({
          index,
          chunks: [
            {
              id: `chunk-${n}`,
              text: `Legacy body ${n}`,
              model: "local",
              kbId: kb.id,
              docId,
              versionId: `v-${n}`,
              heading: null,
              section: null,
              startLine: 1,
              endLine: 1,
              visibility: "private",
              source: null,
            },
          ],
        });
        expect(() =>
          buildKnowledgeResourceId({
            contentClass: "document_version",
            tenantId: "tenant-local",
            versionId: "v1",
            docId,
          }),
        ).toThrow("governance_knowledge_invalid:docId");
      }
      const links = path.join(root, "links.json");
      upsertSourceDocumentLink(
        {
          sourceDescriptorId: "source-local",
          relativePath: "/",
          docId: ids[2],
          state: "active",
          lastSeenAt: 1,
        },
        links,
      );
      index.close();
      index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
      for (const [n, id] of ids.entries()) {
        expect(getKnowledgeDocument(index.db, id)?.docId).toBe(id);
        expect(getKnowledgeChunkText(index.db, `chunk-${n}`)).toBe(`Legacy body ${n}`);
      }
      const datasets = listKnowledgeBaseDatasetsInIndex(index.db, { ...kb, documentIds: ids });
      expect(datasets).toHaveLength(1);
      expect(datasets[0]?.recordCount).toBe(2);
      expect(findSourceDocumentLinkByDocId(ids[2], links)?.docId).toBe(ids[2]);
    } finally {
      index.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
