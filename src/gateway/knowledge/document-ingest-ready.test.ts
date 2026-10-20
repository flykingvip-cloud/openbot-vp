import { describe, expect, it } from "vitest";
import {
  isKnowledgeDocumentIngestReady,
  isKnowledgeDocumentStored,
  isSqliteVecUnavailableError,
} from "./document-ingest-ready.js";

describe("isSqliteVecUnavailableError", () => {
  it("recognizes a missing vec0 module without treating other SQL errors as fatal", () => {
    expect(isSqliteVecUnavailableError(new Error("no such module: vec0"))).toBe(true);
    expect(isSqliteVecUnavailableError("SqliteError: no such module: vec0")).toBe(true);
    expect(isSqliteVecUnavailableError(new Error("no such table: chunks_vec"))).toBe(false);
  });
});

describe("isKnowledgeDocumentStored", () => {
  it("treats original bytes plus searchable chunks as saved even without vectors", () => {
    expect(
      isKnowledgeDocumentStored({
        docId: "doc-1",
        originalStored: true,
        chunkCount: 2,
        vectorCount: 0,
      }),
    ).toBe(true);
    expect(
      isKnowledgeDocumentStored({
        docId: "doc-1",
        originalStored: true,
        chunkCount: 0,
        vectorCount: 0,
      }),
    ).toBe(false);
  });
});

describe("isKnowledgeDocumentIngestReady", () => {
  it("requires original bytes, searchable chunks, and vectors together", () => {
    expect(
      isKnowledgeDocumentIngestReady({
        docId: "doc-1",
        originalStored: true,
        chunkCount: 2,
        vectorCount: 2,
      }),
    ).toBe(true);
    expect(
      isKnowledgeDocumentIngestReady({
        docId: "doc-1",
        originalStored: true,
        chunkCount: 2,
        vectorCount: 0,
      }),
    ).toBe(false);
    expect(
      isKnowledgeDocumentIngestReady({
        docId: "doc-1",
        originalStored: false,
        chunkCount: 2,
        vectorCount: 2,
      }),
    ).toBe(false);
  });
});
