// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewKnowledgeIndexCapability } from "./capability-preview.js";
import { KNOWLEDGE_INDEX_CAPABILITY_ID } from "./feed/data-capability-feed-adapter.js";
import { ingestKnowledgeDocument } from "./kb-ingest.js";

let indexRoot: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-cap-preview-${randomUUID()}`);
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
});

describe("previewKnowledgeIndexCapability", () => {
  it("returns an empty preview when no index exists", async () => {
    const preview = await previewKnowledgeIndexCapability({
      ownerId: "user-empty",
      tenantId: null,
      indexRoot,
    });
    expect(preview.capabilityId).toBe(KNOWLEDGE_INDEX_CAPABILITY_ID);
    expect(preview.indexedChunkCount).toBe(0);
    expect(preview.items).toEqual([]);
  });

  it("returns real indexed chunk previews after ingest", async () => {
    const ownerId = "user-preview";
    const kbId = "kb_preview";
    await ingestKnowledgeDocument({
      kbId,
      docId: "doc-a",
      title: "Refund Policy",
      fileName: "a.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Refund Policy\nEnterprise refunds escalate within 24 hours to the duty manager.",
        "utf8",
      ),
      ownerId,
      tenantId: null,
      indexRoot,
      embeddingProvider: null,
    });

    const preview = await previewKnowledgeIndexCapability({
      ownerId,
      tenantId: null,
      indexRoot,
      limit: 5,
    });

    expect(preview.capabilityId).toBe(KNOWLEDGE_INDEX_CAPABILITY_ID);
    expect(preview.indexedChunkCount).toBeGreaterThan(0);
    expect(preview.items.length).toBeGreaterThan(0);
    const first = preview.items[0];
    expect(first.docId).toBe("doc-a");
    expect(first.docTitle).toBe("Refund Policy");
    expect(first.kbId).toBe(kbId);
    expect(first.snippet.length).toBeGreaterThan(0);
  });
});
