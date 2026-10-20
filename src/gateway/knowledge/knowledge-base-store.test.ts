// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachDocumentToKnowledgeBase,
  createKnowledgeBase,
  deleteDocumentFromKnowledgeBase,
  deleteKnowledgeBase,
  detachDocumentFromKnowledgeBase,
  getKnowledgeBase,
  KnowledgeBaseStoreError,
  listKnowledgeBases,
  restoreDocumentToKnowledgeBase,
  updateKnowledgeBase,
} from "./knowledge-base-store.js";

let storePath: string;

beforeEach(() => {
  storePath = path.join(os.tmpdir(), `kb-store-${randomUUID()}`, "bases.json");
});

afterEach(() => {
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

describe("knowledge-base-store", () => {
  it("creates and reads back a knowledge base", () => {
    const kb = createKnowledgeBase(
      { title: "Sales KB", description: "sales", ownerId: "user-1", tags: ["sales"] },
      storePath,
    );
    expect(kb.id).toMatch(/^kb_/);
    expect(kb.visibility).toBe("private");
    expect(kb.backendKind).toBe("personal");
    expect(kb.documentCount).toBe(0);

    const loaded = getKnowledgeBase(kb.id, storePath);
    expect(loaded?.title).toBe("Sales KB");
    expect(loaded?.tags).toEqual(["sales"]);
  });

  it("rejects creation without title or owner", () => {
    expect(() => createKnowledgeBase({ title: "", ownerId: "user-1" }, storePath)).toThrow(
      KnowledgeBaseStoreError,
    );
    expect(() => createKnowledgeBase({ title: "X", ownerId: "" }, storePath)).toThrow(
      KnowledgeBaseStoreError,
    );
  });

  it("lists with owner/tenant filters, newest first", () => {
    createKnowledgeBase({ title: "A", ownerId: "user-1" }, storePath);
    createKnowledgeBase(
      { title: "B", ownerId: "user-2", tenantId: "tenant-a", visibility: "enterprise" },
      storePath,
    );
    expect(listKnowledgeBases({}, storePath)).toHaveLength(2);
    expect(listKnowledgeBases({ ownerId: "user-1" }, storePath).map((k) => k.title)).toEqual(["A"]);
    expect(listKnowledgeBases({ tenantId: "tenant-a" }, storePath).map((k) => k.title)).toEqual([
      "B",
    ]);
  });

  it("updates mutable fields and bumps updatedAt", () => {
    const kb = createKnowledgeBase({ title: "Old", ownerId: "user-1" }, storePath);
    const updated = updateKnowledgeBase(
      kb.id,
      { title: "New", description: "desc", visibility: "team", tags: ["t"] },
      storePath,
    );
    expect(updated.title).toBe("New");
    expect(updated.description).toBe("desc");
    expect(updated.visibility).toBe("team");
    expect(updated.tags).toEqual(["t"]);
    expect(updated.updatedAtMs).toBeGreaterThanOrEqual(kb.updatedAtMs);
  });

  it("rejects updating to an empty title and unknown ids", () => {
    const kb = createKnowledgeBase({ title: "Keep", ownerId: "user-1" }, storePath);
    expect(() => updateKnowledgeBase(kb.id, { title: "  " }, storePath)).toThrow(
      KnowledgeBaseStoreError,
    );
    expect(() => updateKnowledgeBase("kb_missing", { title: "x" }, storePath)).toThrow(
      KnowledgeBaseStoreError,
    );
  });

  it("attaches documents idempotently and tracks count", () => {
    const kb = createKnowledgeBase({ title: "Docs", ownerId: "user-1" }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-1", storePath);
    const after = attachDocumentToKnowledgeBase(kb.id, "doc-1", storePath);
    expect(after.documentIds).toEqual(["doc-1"]);
    expect(after.documentCount).toBe(1);
    const more = attachDocumentToKnowledgeBase(kb.id, "doc-2", storePath);
    expect(more.documentIds).toEqual(["doc-1", "doc-2"]);
    expect(more.documentCount).toBe(2);
  });

  it("detaches and restores documents via recycle list", () => {
    const kb = createKnowledgeBase({ title: "Recycle", ownerId: "user-1" }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-1", storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-2", storePath);

    const detached = detachDocumentFromKnowledgeBase(kb.id, "doc-1", storePath);
    expect(detached.documentIds).toEqual(["doc-2"]);
    expect(detached.recycledDocumentIds).toEqual(["doc-1"]);
    expect(detached.documentCount).toBe(1);

    const restored = restoreDocumentToKnowledgeBase(kb.id, "doc-1", storePath);
    expect(restored.documentIds).toEqual(["doc-2", "doc-1"]);
    expect(restored.recycledDocumentIds).toEqual([]);
    expect(restored.documentCount).toBe(2);
  });

  it("removes document from recycle when re-attached", () => {
    const kb = createKnowledgeBase({ title: "Reattach", ownerId: "user-1" }, storePath);
    attachDocumentToKnowledgeBase(kb.id, "doc-1", storePath);
    detachDocumentFromKnowledgeBase(kb.id, "doc-1", storePath);
    const reattached = attachDocumentToKnowledgeBase(kb.id, "doc-1", storePath);
    expect(reattached.documentIds).toEqual(["doc-1"]);
    expect(reattached.recycledDocumentIds).toEqual([]);
  });

  it("deletes a knowledge base and persists across reload", () => {
    const kb = createKnowledgeBase({ title: "Temp", ownerId: "user-1" }, storePath);
    expect(deleteKnowledgeBase(kb.id, storePath)).toEqual({ ok: true });
    expect(getKnowledgeBase(kb.id, storePath)).toBeNull();
    expect(() => deleteKnowledgeBase(kb.id, storePath)).toThrow(KnowledgeBaseStoreError);
  });

  it("refuses to attach skill assets as knowledge documents", () => {
    const kb = createKnowledgeBase({ title: "Skills stay out", ownerId: "user-1" }, storePath);
    const after = attachDocumentToKnowledgeBase(kb.id, "skill_9b2c46eaedd4", storePath);
    expect(after.documentIds).toEqual([]);
    expect(getKnowledgeBase(kb.id, storePath)?.documentIds).toEqual([]);
  });

  it("refuses to restore skill assets into a knowledge base", () => {
    const kb = createKnowledgeBase({ title: "Recycle", ownerId: "user-1" }, storePath);
    const raw = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
      bases: Array<{ recycledDocumentIds: string[] }>;
    };
    raw.bases[0].recycledDocumentIds = ["skill_legacy123"];
    fs.writeFileSync(storePath, `${JSON.stringify(raw, null, 2)}\n`);
    expect(() => restoreDocumentToKnowledgeBase(kb.id, "skill_legacy123", storePath)).toThrow(
      /skill assets cannot be restored/,
    );
    expect(getKnowledgeBase(kb.id, storePath)?.documentIds).toEqual([]);
  });

  it("hides leftover skill asset membership when reading the store", () => {
    const kb = createKnowledgeBase({ title: "Legacy", ownerId: "user-1" }, storePath);
    const raw = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
      bases: Array<{ documentIds: string[]; documentCount: number }>;
    };
    raw.bases[0].documentIds = ["skill_legacy123", "lfdoc-6ad9fbcbc7b63784231845b09b92"];
    raw.bases[0].documentCount = 2;
    fs.writeFileSync(storePath, `${JSON.stringify(raw, null, 2)}\n`);
    const loaded = getKnowledgeBase(kb.id, storePath);
    expect(loaded?.documentIds).toEqual(["lfdoc-6ad9fbcbc7b63784231845b09b92"]);
    expect(loaded?.documentCount).toBe(1);
    const persisted = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
      bases: Array<{ documentIds: string[] }>;
    };
    expect(persisted.bases[0]?.documentIds).toEqual(["lfdoc-6ad9fbcbc7b63784231845b09b92"]);
  });

  it("deletes unattached cabin-tree shells without throwing", () => {
    const kb = createKnowledgeBase({ title: "个人成果", ownerId: "user-1" }, storePath);
    const next = deleteDocumentFromKnowledgeBase(kb.id, "kbdoc-folder-shell", storePath);
    expect(next.documentIds).toEqual([]);
    expect(getKnowledgeBase(kb.id, storePath)?.id).toBe(kb.id);
  });

  it("returns empty list when store file contains invalid JSON", () => {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{not-json", "utf-8");
    expect(listKnowledgeBases({}, storePath)).toEqual([]);
    expect(getKnowledgeBase("kb_missing", storePath)).toBeNull();
  });
});
