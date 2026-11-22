import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  queueRetrievalSummary,
  readRetrievalSummary,
  generateRetrievalSummary,
  editRetrievalSummary,
} from "./retrieval-summary-store.js";
const controls = {
  readAuthorizedSource: async () => ({
    versionId: "v1",
    contentHash: "h1",
    body: "Only approved invoices may be paid.",
  }),
};
it("queues idempotently and does not expose metadata across KB grants", () => {
  const db = new DatabaseSync(":memory:");
  const input = { docId: "d", kbId: "private", versionId: "v1", contentHash: "h1" };
  queueRetrievalSummary(db, input);
  queueRetrievalSummary(db, input);
  expect(readRetrievalSummary(db, "d", new Set())).toBeUndefined();
  expect(readRetrievalSummary(db, "d", new Set(["private"]))?.state).toBe("pending");
  db.close();
});
it("failed generation leaves body storage untouched and late results cannot overwrite new revisions", async () => {
  const db = new DatabaseSync(":memory:");
  const allowed = new Set(["k"]);
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v1", contentHash: "h1" });
  expect(
    await generateRetrievalSummary(
      db,
      "d",
      allowed,
      async () => {
        throw Error("no model");
      },
      controls,
    ),
  ).toBe(false);
  expect(readRetrievalSummary(db, "d", allowed)?.state).toBe("failed");
  expect(
    await generateRetrievalSummary(
      db,
      "d",
      allowed,
      async () => {
        queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v2", contentHash: "h2" });
        return {
          schemaVersion: 1,
          state: "ready",
          documentType: "other",
          sourceVersionId: "v1",
          sourceContentHash: "h1",
          templateVersion: "1",
          fields: { purpose: "test", keyPoints: [], coverage: [], entities: [], boundaries: [] },
        };
      },
      controls,
    ),
  ).toBe(false);
  expect(readRetrievalSummary(db, "d", allowed)?.sourceVersionId).toBe("v2");
  db.close();
});

it("recovers expired claims and rechecks authorization after generation", async () => {
  const db = new DatabaseSync(":memory:");
  const allowed = new Set(["k"]);
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v1", contentHash: "h1" });
  db.prepare("UPDATE retrieval_summaries SET state='processing',claim='dead',updated_at=0").run();
  const read = vi
    .fn()
    .mockResolvedValueOnce({ versionId: "v1", contentHash: "h1", body: "source" })
    .mockResolvedValueOnce({ versionId: "v1", contentHash: "h1", body: "source" })
    .mockResolvedValueOnce(undefined);
  const generator = vi.fn(async (source) => ({
    schemaVersion: 1 as const,
    state: "ready" as const,
    documentType: "other" as const,
    sourceVersionId: source.versionId,
    sourceContentHash: source.contentHash,
    templateVersion: "1",
    fields: { purpose: "test", keyPoints: [], coverage: [], entities: [], boundaries: [] },
  }));
  expect(
    await generateRetrievalSummary(db, "d", allowed, generator, {
      readAuthorizedSource: read,
      now: () => 1_000_000,
    }),
  ).toBe(false);
  expect(generator).toHaveBeenCalledWith(expect.objectContaining({ body: "source" }));
  expect(read).toHaveBeenCalledTimes(3);
  expect(readRetrievalSummary(db, "d", allowed)?.state).toBe("failed");
  db.close();
});

it("unauthorized generation cannot recover or modify another KB lease", async () => {
  const db = new DatabaseSync(":memory:");
  queueRetrievalSummary(db, { docId: "d", kbId: "private", versionId: "v1", contentHash: "h1" });
  db.prepare("UPDATE retrieval_summaries SET state='processing',claim='dead',updated_at=0").run();
  const generator = vi.fn();
  expect(await generateRetrievalSummary(db, "d", new Set(), generator, controls)).toBe(false);
  expect(
    db.prepare("SELECT state,claim FROM retrieval_summaries WHERE doc_id='d'").get(),
  ).toMatchObject({ state: "processing", claim: "dead" });
  expect(generator).not.toHaveBeenCalled();
  db.close();
});

it("preserves a human v1 draft and accepts a human edit for current v2", async () => {
  const db = new DatabaseSync(":memory:");
  const allowed = new Set(["k"]);
  const fields = { purpose: "v1", keyPoints: [], coverage: [], entities: [], boundaries: [] };
  expect(
    await editRetrievalSummary(db, "d", fields, async () => ({
      kbId: "k",
      versionId: "v1",
      contentHash: "h1",
    })),
  ).toBe(true);
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v2", contentHash: "h2" });
  expect(readRetrievalSummary(db, "d", allowed)).toMatchObject({
    state: "stale",
    sourceVersionId: "v1",
    currentSourceVersionId: "v2",
  });
  expect(
    await editRetrievalSummary(db, "d", { ...fields, purpose: "v2" }, async () => ({
      kbId: "k",
      versionId: "v2",
      contentHash: "h2",
    })),
  ).toBe(true);
  expect(readRetrievalSummary(db, "d", allowed)).toMatchObject({
    state: "ready",
    sourceVersionId: "v2",
    method: "human",
  });
  db.close();
});

it("does not publish when the source is deleted during generation", async () => {
  const db = new DatabaseSync(":memory:");
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v1", contentHash: "h1" });
  let exists = true;
  const read = async () =>
    exists ? { versionId: "v1", contentHash: "h1", body: "original" } : undefined;
  const ok = await generateRetrievalSummary(
    db,
    "d",
    new Set(["k"]),
    async (source) => {
      exists = false;
      return {
        schemaVersion: 1,
        state: "ready",
        documentType: "report",
        sourceVersionId: source.versionId,
        sourceContentHash: source.contentHash,
        templateVersion: "1",
        fields: { purpose: "result", keyPoints: [], coverage: [], entities: [], boundaries: [] },
      };
    },
    { readAuthorizedSource: read },
  );
  expect(ok).toBe(false);
  expect(readRetrievalSummary(db, "d", new Set(["k"]))?.state).toBe("failed");
  db.close();
});
it("budget deferral persists sections without consuming failure retries or regenerating paid sections", async () => {
  const { generateHierarchicalSummary } = await import("./retrieval-summary-hierarchy.js");
  const db = new DatabaseSync(":memory:");
  const body = "a".repeat(12000) + "TAIL_RULE";
  const allowed = new Set(["k"]);
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v1", contentHash: "h1" });
  let budget = 1;
  let calls = 0;
  const fields = {
    purpose: "summary",
    keyPoints: ["TAIL_RULE"],
    coverage: [],
    entities: [],
    boundaries: [],
  };
  const generate = async (source: { versionId: string; contentHash: string; body: string }) => ({
    schemaVersion: 1 as const,
    state: "ready" as const,
    documentType: "report" as const,
    sourceVersionId: source.versionId,
    sourceContentHash: source.contentHash,
    templateVersion: "1",
    fields: await generateHierarchicalSummary({
      db,
      docId: "d",
      ...source,
      documentType: "report",
      call: async () => {
        if (budget-- <= 0) {
          return undefined;
        }
        calls++;
        return JSON.stringify(fields);
      },
    }),
  });
  const controls = {
    readAuthorizedSource: async () => ({ versionId: "v1", contentHash: "h1", body }),
  };
  expect(await generateRetrievalSummary(db, "d", allowed, generate, controls)).toBe(false);
  expect(readRetrievalSummary(db, "d", allowed)?.state).toBe("pending");
  expect(db.prepare("SELECT attempts FROM retrieval_summaries").get()?.attempts).toBe(0);
  budget = 2;
  expect(await generateRetrievalSummary(db, "d", allowed, generate, controls)).toBe(true);
  expect(calls).toBe(3);
  db.close();
});
