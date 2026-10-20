// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listKnowledgeRecentVisits,
  recordKnowledgeRecentVisit,
  resetKnowledgeRecentVisitsStore,
} from "./recent-visits.js";
import type { KnowledgeObject } from "./types.js";

const sampleObject: KnowledgeObject = {
  id: "obj:personal:demo",
  title: "Demo doc",
  source: "personal",
  kind: "document",
  summary: "demo",
  tags: ["demo"],
  updatedAt: Date.now(),
};

describe("knowledge recent visits", () => {
  let storePath = "";

  afterEach(() => {
    if (storePath) {
      resetKnowledgeRecentVisitsStore(storePath);
    }
  });

  it("records and lists visits per scope", () => {
    storePath = path.join(
      os.tmpdir(),
      `openbot-recent-visits-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const visits = recordKnowledgeRecentVisit({
      userId: "user-a",
      seatId: "seat-a",
      object: sampleObject,
      storePath,
    });
    expect(visits).toHaveLength(1);
    expect(visits[0]?.objectId).toBe(sampleObject.id);
    const listed = listKnowledgeRecentVisits({ userId: "user-a", seatId: "seat-a", storePath });
    expect(listed[0]?.title).toBe(sampleObject.title);
  });

  it("deduplicates and keeps newest first", () => {
    storePath = path.join(
      os.tmpdir(),
      `openbot-recent-visits-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    recordKnowledgeRecentVisit({
      userId: "user-b",
      seatId: "seat-b",
      object: sampleObject,
      storePath,
    });
    recordKnowledgeRecentVisit({
      userId: "user-b",
      seatId: "seat-b",
      object: {
        ...sampleObject,
        id: "obj:personal:other",
        title: "Other",
      },
      storePath,
    });
    const visits = recordKnowledgeRecentVisit({
      userId: "user-b",
      seatId: "seat-b",
      object: sampleObject,
      storePath,
    });
    expect(visits[0]?.objectId).toBe(sampleObject.id);
    expect(visits).toHaveLength(2);
  });

  it("persists visits across reloads", () => {
    storePath = path.join(
      os.tmpdir(),
      `openbot-recent-visits-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    recordKnowledgeRecentVisit({
      userId: "user-c",
      seatId: "seat-c",
      object: sampleObject,
      storePath,
    });
    expect(fs.existsSync(storePath)).toBe(true);
    const reloaded = listKnowledgeRecentVisits({
      userId: "user-c",
      seatId: "seat-c",
      storePath,
    });
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]?.objectId).toBe(sampleObject.id);
  });
});
