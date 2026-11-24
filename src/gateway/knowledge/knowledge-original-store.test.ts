import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteKnowledgeOriginal,
  findKnowledgeOriginalByFileName,
  hasKnowledgeOriginal,
  listKnowledgeOriginalDocumentIds,
  persistKnowledgeOriginal,
  readKnowledgeOriginal,
  withKnowledgeDocumentMutation,
} from "./knowledge-original-store.js";

describe("knowledge-original-store", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-original-"));
    roots.push(root);
    return root;
  }

  it("persists, reads, lists, and deletes originals", () => {
    const originalsRoot = tempRoot();
    const buffer = Buffer.from("# hello\n", "utf8");
    const manifest = persistKnowledgeOriginal({
      kbId: "kb-1",
      docId: "doc-1",
      fileName: "note.md",
      mimeType: "text/markdown",
      buffer,
      originalsRoot,
    });
    expect(manifest?.fileName).toBe("note.md");
    expect(hasKnowledgeOriginal({ kbId: "kb-1", docId: "doc-1", originalsRoot })).toBe(true);
    expect([...listKnowledgeOriginalDocumentIds({ kbId: "kb-1", originalsRoot })]).toEqual([
      "doc-1",
    ]);

    const read = readKnowledgeOriginal({ kbId: "kb-1", docId: "doc-1", originalsRoot });
    expect(read?.buffer.toString("utf8")).toBe("# hello\n");

    deleteKnowledgeOriginal({ kbId: "kb-1", docId: "doc-1", originalsRoot });
    expect(hasKnowledgeOriginal({ kbId: "kb-1", docId: "doc-1", originalsRoot })).toBe(false);
  });

  it("fail-closes oversized payloads", () => {
    const originalsRoot = tempRoot();
    const huge = Buffer.alloc(9_000_000, 1);
    const manifest = persistKnowledgeOriginal({
      kbId: "kb-1",
      docId: "doc-huge",
      fileName: "huge.bin",
      mimeType: "application/octet-stream",
      buffer: huge,
      originalsRoot,
    });
    expect(manifest).toBeNull();
    expect(hasKnowledgeOriginal({ kbId: "kb-1", docId: "doc-huge", originalsRoot })).toBe(false);
  });

  it("finds a retained original by human filename across knowledge bases", () => {
    const originalsRoot = tempRoot();
    persistKnowledgeOriginal({
      kbId: "kb-other",
      docId: "doc-other",
      fileName: "如何让“数字人”真正活着.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 alias", "utf8"),
      originalsRoot,
    });
    const found = findKnowledgeOriginalByFileName({
      fileName: "如何让数字人真正活着.pdf",
      preferKbId: "kb-1",
      originalsRoot,
    });
    expect(found?.manifest.kbId).toBe("kb-other");
    expect(found?.buffer.toString("utf8")).toContain("%PDF-1.4 alias");
  });
});

describe("knowledge document mutation locking", () => {
  it("serializes independent mutations for the same document across KB scopes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-mutation-"));
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const first = withKnowledgeDocumentMutation(
      { originalsRoot: root, kbId: "kb-a", docId: "same" },
      async () => {
        order.push("first");
        entered();
        await barrier;
        order.push("released");
      },
    );
    try {
      await held;
      const second = withKnowledgeDocumentMutation(
        { originalsRoot: root, kbId: "kb-b", docId: "same" },
        async () => {
          order.push("second");
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(order).toEqual(["first"]);
      release();
      await Promise.all([first, second]);
      expect(order).toEqual(["first", "released", "second"]);
    } finally {
      release();
      await first;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
