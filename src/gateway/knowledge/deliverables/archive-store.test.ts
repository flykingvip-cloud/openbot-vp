// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findDeliverableArchiveByDocumentId,
  findDeliverableArchiveByLogicalId,
  getDeliverableArchiveKnowledgeBaseId,
  getDeliverableArchiveRecord,
  setDeliverableArchiveKnowledgeBaseId,
  setDeliverableArchiveRecord,
  syncDeliverableArchiveRawHash,
} from "./archive-store.js";

let storePath: string;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deliverable-archives-"));
  storePath = path.join(dir, "deliverable-archives.json");
});

afterEach(() => {
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

describe("deliverable archive store", () => {
  it("keeps legacy kb-only rows readable", () => {
    setDeliverableArchiveKnowledgeBaseId({
      deliverableId: "skill:old",
      knowledgeBaseId: "kb-1",
      storePath,
    });
    expect(getDeliverableArchiveKnowledgeBaseId("skill:old", storePath)).toBe("kb-1");
    expect(getDeliverableArchiveRecord("skill:old", storePath)?.knowledgeBaseId).toBe("kb-1");
  });

  it("stores document identity and finds by logical id", () => {
    setDeliverableArchiveRecord({
      deliverableId: "skill:a",
      knowledgeBaseId: "kb-team",
      documentId: "doc-1",
      logicalId: "weekly-brief",
      rawHash: "hash-1",
      filename: "deliverables/weekly-brief.md",
      archivedByAgentId: "bot-1",
      storePath,
    });
    expect(findDeliverableArchiveByDocumentId("doc-1", storePath)?.deliverableId).toBe("skill:a");
    expect(
      findDeliverableArchiveByLogicalId({
        knowledgeBaseId: "kb-team",
        logicalId: "weekly-brief",
        storePath,
      })?.record.rawHash,
    ).toBe("hash-1");
  });

  it("syncs overwrite hash to every chip pointing at the same document", () => {
    setDeliverableArchiveRecord({
      deliverableId: "skill:a",
      knowledgeBaseId: "kb-team",
      documentId: "doc-1",
      rawHash: "hash-1",
      storePath,
    });
    setDeliverableArchiveRecord({
      deliverableId: "skill:b",
      knowledgeBaseId: "kb-team",
      documentId: "doc-1",
      rawHash: "hash-1",
      storePath,
    });
    syncDeliverableArchiveRawHash({
      documentId: "doc-1",
      rawHash: "hash-2",
      filename: "brief-v2.md",
      storePath,
    });
    expect(getDeliverableArchiveRecord("skill:a", storePath)?.rawHash).toBe("hash-2");
    expect(getDeliverableArchiveRecord("skill:b", storePath)?.rawHash).toBe("hash-2");
    expect(getDeliverableArchiveRecord("skill:a", storePath)?.filename).toBe("brief-v2.md");
  });
});
