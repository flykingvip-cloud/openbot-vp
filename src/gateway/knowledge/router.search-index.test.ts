// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetKnowledgeRetrievalServiceForTests } from "../../retrieval/retrieval-service.js";
import { resetKnowledgeRetrievalSourceRegistrationForTests } from "../../retrieval/sources/knowledge-source.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";
import { createKnowledgeBase } from "./knowledge-base-store.js";
import { knowledgeSearch } from "./router.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-kb-router-search-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("./context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    userId: "user-router",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  })),
}));

describe("knowledgeSearch indexed fallback", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prefers indexed evidence over bundle substring when chunks exist", async () => {
    const storePath = path.join(tmpDir, "knowledge", "bases.json");
    const kb = createKnowledgeBase({ title: "Router KB", ownerId: "user-router" }, storePath);
    await ingestKnowledgeDocument({
      kbId: kb.id,
      docId: "doc-router",
      title: "Router Refund Guide",
      fileName: "router.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Refunds\n\nUnique router refund escalation phrase.", "utf8"),
      ownerId: "user-router",
      tenantId: null,
      indexRoot: path.join(tmpDir, "knowledge", "index"),
      embeddingProvider: null,
    });

    const result = await knowledgeSearch(
      { connect: {} as never, user: "test@example.com" },
      { query: "router refund escalation", limit: 5 },
    );
    expect(result.searchMode).toBe("indexed");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.results).toEqual([]);
  });

  it("falls back to bundle substring when no indexed chunks exist", async () => {
    const result = await knowledgeSearch(
      { connect: {} as never, user: "test@example.com" },
      { query: "policy", limit: 5 },
    );
    expect(result.searchMode).toBe("substring");
    expect(result.evidence).toEqual([]);
    expect(Array.isArray(result.results)).toBe(true);
  });
});
