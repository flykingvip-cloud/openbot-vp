import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { queueRetrievalSummary, readRetrievalSummary } from "./retrieval-summary-store.js";
import { tickRetrievalSummaries } from "./retrieval-summary-worker.js";
it("keeps pending without configured generator and respects budget denial", async () => {
  const db = new DatabaseSync(":memory:");
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v", contentHash: "h" });
  const source = async () => ({ versionId: "v", contentHash: "h", body: "original" });
  expect(
    (
      await tickRetrievalSummaries({
        db,
        allowedKbIds: new Set(["k"]),
        readAuthorizedSource: source,
        acquireBudget: async () => true,
      })
    ).pendingConfiguration,
  ).toBe(true);
  const generate = vi.fn();
  expect(
    (
      await tickRetrievalSummaries({
        db,
        allowedKbIds: new Set(["k"]),
        readAuthorizedSource: source,
        acquireBudget: async () => false,
        generate,
      })
    ).processed,
  ).toBe(0);
  expect(generate).not.toHaveBeenCalled();
  expect(readRetrievalSummary(db, "d", new Set(["k"]))?.state).toBe("pending");
  db.close();
});
it("consumes an authorized queued source through injected budgeted generator", async () => {
  const db = new DatabaseSync(":memory:");
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v", contentHash: "h" });
  const result = await tickRetrievalSummaries({
    db,
    allowedKbIds: new Set(["k"]),
    readAuthorizedSource: async () => ({ versionId: "v", contentHash: "h", body: "source" }),
    acquireBudget: async () => true,
    generate: async (source) => ({
      schemaVersion: 1,
      state: "ready",
      documentType: "report",
      sourceVersionId: source.versionId,
      sourceContentHash: source.contentHash,
      templateVersion: "1",
      fields: { purpose: source.body, keyPoints: [], coverage: [], entities: [], boundaries: [] },
    }),
  });
  expect(result.generated).toBe(1);
  expect(readRetrievalSummary(db, "d", new Set(["k"]))?.fields?.purpose).toBe("source");
  db.close();
});
it("backs off failures and stops automatic retries after three attempts", async () => {
  const db = new DatabaseSync(":memory:");
  queueRetrievalSummary(db, { docId: "d", kbId: "k", versionId: "v", contentHash: "h" });
  const generate = vi.fn(async () => {
    throw Error("provider failure");
  });
  const input = {
    db,
    allowedKbIds: new Set(["k"]),
    readAuthorizedSource: async () => ({ versionId: "v", contentHash: "h", body: "original" }),
    acquireBudget: async () => true,
    generate,
  };
  await tickRetrievalSummaries(input);
  expect((await tickRetrievalSummaries(input)).processed).toBe(0);
  for (let i = 0; i < 3; i++) {
    db.prepare("UPDATE retrieval_summaries SET next_retry_at=0").run();
    await tickRetrievalSummaries(input);
  }
  expect(generate).toHaveBeenCalledTimes(3);
  expect(db.prepare("SELECT attempts FROM retrieval_summaries").get()?.attempts).toBe(3);
  db.close();
});
