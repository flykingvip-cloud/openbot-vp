import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../../../memory/embeddings.js";
import { buildKnowledgeResourceId } from "../../data-governance/knowledge-register.js";
import { ownershipProofFromLocalUser } from "../../data-governance/ownership-proof.js";
import {
  getLatestKnowledgeDocumentVersion,
  listKnowledgeChunksForVersion,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "../kb-index.js";
import { createKnowledgeBase, getKnowledgeBase } from "../knowledge-base-store.js";
import { getKnowledgeVectorizeQueueRow } from "../vectorize-queue-store.js";
import {
  deleteLocalFolderBinding,
  upsertLocalFolderBinding,
} from "./local-folder-binding-store.js";
import {
  buildLocalFolderDocId,
  isLocalFolderDocId,
  isPathIncluded,
  matchSimpleGlob,
  scanLocalFolderBinding,
  walkLocalFolderFiles,
} from "./local-folder-runtime.js";
import { bindKnowledgeSource, unbindKnowledgeSource } from "./source-binding-store.js";
import { resolveSourcePlane } from "./source-descriptor.js";
import { listSourceDocumentLinks } from "./source-document-link-store.js";

const tmpRoot = path.join(
  os.tmpdir(),
  `openbot-local-folder-${Math.random().toString(36).slice(2)}`,
);

function writeText(filePath: string, body: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

const governanceOwnershipProof = ownershipProofFromLocalUser({ userId: "user-a" });

describe("local-folder-runtime (P1)", () => {
  let folderRoot: string;
  let bindingStore: string;
  let linkStore: string;
  let kbStore: string;
  let indexRoot: string;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    folderRoot = path.join(tmpRoot, "notes");
    bindingStore = path.join(tmpRoot, "local-folder-bindings.json");
    linkStore = path.join(tmpRoot, "source-document-links.json");
    kbStore = path.join(tmpRoot, "knowledge-bases.json");
    indexRoot = path.join(tmpRoot, "index");
    writeText(path.join(folderRoot, "a.md"), "# A\n\nhello knowledge");
    writeText(path.join(folderRoot, "nested", "b.md"), "# B\n\nsecond doc");
    writeText(path.join(folderRoot, "skip.bin"), "not-supported");
    writeText(path.join(folderRoot, "node_modules", "x.md"), "# ignored");
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("buildLocalFolderDocId satisfies governance SAFE_ID without a colon", () => {
    const sourceDescriptorId = "src-folder";
    const relativePath = "nested\\notes/a.pdf";
    const hex = createHash("sha256")
      .update(`${sourceDescriptorId}::nested/notes/a.pdf`)
      .digest("hex")
      .slice(0, 28);
    const docId = buildLocalFolderDocId(sourceDescriptorId, relativePath);
    expect(docId).toBe(`lfdoc-${hex}`);
    expect(docId).not.toContain(":");
    expect(docId).toMatch(/^lfdoc-[0-9a-f]{28}$/);
    expect(isLocalFolderDocId(docId)).toBe(true);
    expect(isLocalFolderDocId(`lfdoc:${hex}`)).toBe(true);
    expect(
      buildKnowledgeResourceId({
        tenantId: "t1",
        contentClass: "document_version",
        docId,
        versionId: "v1",
      }),
    ).toBe(`knowledge:t1:doc:${docId}:v1`);
  });

  it("matchSimpleGlob covers **/* and excludes", () => {
    expect(matchSimpleGlob("**/*", "a/b.md")).toBe(true);
    expect(matchSimpleGlob("**/*.md", "nested/b.md")).toBe(true);
    expect(matchSimpleGlob("**/node_modules/**", "node_modules/x.md")).toBe(true);
    expect(
      isPathIncluded({
        relativePath: "node_modules/x.md",
        includeGlobs: ["**/*"],
        excludeGlobs: ["**/node_modules/**"],
      }),
    ).toBe(false);
  });

  it("walkLocalFolderFiles filters by supported extensions and exclude globs", () => {
    const walked = walkLocalFolderFiles({
      rootPath: folderRoot,
      includeGlobs: ["**/*"],
      excludeGlobs: ["**/node_modules/**"],
    });
    const rels = walked.files.map((f) => f.relativePath).toSorted();
    expect(rels).toEqual(["a.md", "nested/b.md"]);
  });

  it("scan ingests files, keeps absolute path off descriptor, and snapshot-delete marks links", async () => {
    const kb = createKnowledgeBase(
      {
        title: "Team notes",
        visibility: "private",
        ownerId: "user-a",
      },
      kbStore,
    );
    const descriptor = bindKnowledgeSource(
      {
        kind: "localFolder",
        title: "Notes",
        knowledgeBaseId: kb.id,
        ownerId: "user-a",
        visibility: "private",
        metadata: { folderLabel: "Notes" },
      },
      path.join(tmpRoot, "source-bindings.json"),
    );
    expect(resolveSourcePlane(descriptor.kind)).toBe("passive");
    expect(descriptor.endpoint).toBeUndefined();
    expect(JSON.stringify(descriptor)).not.toContain(folderRoot);

    const binding = upsertLocalFolderBinding(
      {
        sourceDescriptorId: descriptor.id,
        knowledgeBaseId: kb.id,
        deviceId: "local",
        rootPath: folderRoot,
        rootLabel: "Notes",
        deletePolicy: "snapshot",
      },
      bindingStore,
    );
    expect(binding.rootPath).toBe(path.resolve(folderRoot));

    const summary = await scanLocalFolderBinding({
      binding,
      knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
      ownerId: "user-a",
      indexRoot,
      kbStorePath: kbStore,
      bindingStorePath: bindingStore,
      linkStorePath: linkStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    });
    expect(summary.scanned).toBe(2);
    expect(summary.ingested).toBeGreaterThanOrEqual(1);
    expect(summary.errors).toEqual([]);

    const links = listSourceDocumentLinks(
      { sourceDescriptorId: descriptor.id, state: "active" },
      linkStore,
    );
    expect(links).toHaveLength(2);
    expect(links.every((l) => !l.relativePath.startsWith("/"))).toBe(true);

    // Delete one file and rescan with snapshot policy.
    fs.rmSync(path.join(folderRoot, "a.md"));
    const rescan = await scanLocalFolderBinding({
      binding,
      knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
      ownerId: "user-a",
      indexRoot,
      kbStorePath: kbStore,
      bindingStorePath: bindingStore,
      linkStorePath: linkStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    });
    expect(rescan.snapshotted).toBe(1);
    const snapshotted = listSourceDocumentLinks(
      { sourceDescriptorId: descriptor.id, state: "snapshotted_deleted" },
      linkStore,
    );
    expect(snapshotted).toHaveLength(1);
    expect(snapshotted[0]?.docId).toBe(buildLocalFolderDocId(descriptor.id, "a.md"));

    unbindKnowledgeSource(descriptor.id, path.join(tmpRoot, "source-bindings.json"));
    deleteLocalFolderBinding(binding.bindingId, bindingStore);
  });

  it("sync deletePolicy tombstones and purges on missing file", async () => {
    const kb = createKnowledgeBase(
      {
        title: "Sync notes",
        visibility: "private",
        ownerId: "user-a",
      },
      kbStore,
    );
    const descriptor = bindKnowledgeSource(
      {
        kind: "localFolder",
        title: "Sync",
        knowledgeBaseId: kb.id,
        ownerId: "user-a",
        visibility: "private",
      },
      path.join(tmpRoot, "source-bindings.json"),
    );
    const binding = upsertLocalFolderBinding(
      {
        sourceDescriptorId: descriptor.id,
        knowledgeBaseId: kb.id,
        deviceId: "local",
        rootPath: folderRoot,
        rootLabel: "Sync",
        deletePolicy: "sync",
      },
      bindingStore,
    );
    await scanLocalFolderBinding({
      binding,
      knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
      ownerId: "user-a",
      indexRoot,
      kbStorePath: kbStore,
      bindingStorePath: bindingStore,
      linkStorePath: linkStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    });
    fs.rmSync(path.join(folderRoot, "nested", "b.md"));
    const rescan = await scanLocalFolderBinding({
      binding,
      knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
      ownerId: "user-a",
      indexRoot,
      kbStorePath: kbStore,
      bindingStorePath: bindingStore,
      linkStorePath: linkStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    });
    expect(rescan.tombstoned).toBe(1);
    const tombstoned = listSourceDocumentLinks(
      { sourceDescriptorId: descriptor.id, state: "tombstoned" },
      linkStore,
    );
    expect(tombstoned).toHaveLength(1);
  });

  it("ingests with FTS first and queues background vectorize even if embedding would fail", async () => {
    const kb = createKnowledgeBase(
      { title: "Deferred folder", visibility: "private", ownerId: "user-a" },
      kbStore,
    );
    const descriptor = bindKnowledgeSource(
      {
        kind: "localFolder",
        title: "Notes",
        knowledgeBaseId: kb.id,
        ownerId: "user-a",
        visibility: "private",
      },
      path.join(tmpRoot, "source-bindings.json"),
    );
    const binding = upsertLocalFolderBinding(
      {
        sourceDescriptorId: descriptor.id,
        knowledgeBaseId: kb.id,
        deviceId: "local",
        rootPath: folderRoot,
        rootLabel: "Notes",
        deletePolicy: "snapshot",
      },
      bindingStore,
    );
    const explodingProvider: EmbeddingProvider = {
      id: "openai",
      model: "text-embedding-004",
      embedQuery: async () => {
        throw new Error("no such module: vec0");
      },
      embedBatch: async () => {
        throw new Error("no such module: vec0");
      },
    };
    const summary = await scanLocalFolderBinding({
      binding,
      knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
      ownerId: "user-a",
      indexRoot,
      kbStorePath: kbStore,
      bindingStorePath: bindingStore,
      linkStorePath: linkStore,
      embeddingProvider: explodingProvider,
      governanceOwnershipProof,
    });
    expect(summary.errors).toEqual([]);
    expect(summary.ingested).toBeGreaterThanOrEqual(1);

    const docId = buildLocalFolderDocId(descriptor.id, "a.md");
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: "user-a",
      tenantId: null,
      indexRoot,
    });
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const queued = getKnowledgeVectorizeQueueRow(index.db, kb.id, docId);
      expect(queued?.status).toBe("pending");
      const latest = getLatestKnowledgeDocumentVersion(index.db, docId);
      expect(latest?.versionId).toBeTruthy();
      const chunks = listKnowledgeChunksForVersion({
        db: index.db,
        docId,
        versionId: latest!.versionId,
      });
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.map((entry) => entry.model)).toEqual(chunks.map(() => "fts-only"));
    } finally {
      index.close();
    }
  });
});
