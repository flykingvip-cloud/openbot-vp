import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-asset-incubation-${Date.now()}`);

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const {
  appendSessionEvent,
  listSessionEvents,
  recordEditPatternStability,
  recordExternalizationSignal,
  summarizeEvidence,
  clusterSessionEventsForReview,
} = await import("./asset-incubation-session-store.js");

function cleanStore(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("asset-incubation-session-store", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("appends session events and clusters by clusterId", () => {
    const now = Date.now();
    appendSessionEvent({
      id: "e1",
      ownerKey: "user-a",
      sessionKey: "agent:main:main",
      contextId: "ctx-1",
      clusterId: "cluster-weekly",
      intentKey: "weekly-report",
      label: "周报生成",
      suggestedAssetType: "template",
      occurredAt: now - 1_000,
    });
    appendSessionEvent({
      id: "e2",
      ownerKey: "user-a",
      sessionKey: "agent:main:main",
      contextId: "ctx-2",
      clusterId: "cluster-weekly",
      intentKey: "weekly-report",
      label: "周报生成",
      suggestedAssetType: "template",
      occurredAt: now - 2_000,
    });
    appendSessionEvent({
      id: "e3",
      ownerKey: "user-a",
      sessionKey: "agent:main:main",
      contextId: "ctx-3",
      clusterId: "cluster-other",
      intentKey: "competitive-analysis",
      label: "竞品分析",
      suggestedAssetType: "workflow",
      occurredAt: now - 3_000,
    });

    const events = listSessionEvents("user-a", now);
    expect(events).toHaveLength(3);

    const summary = summarizeEvidence({
      ownerKey: "user-a",
      clusterId: "cluster-weekly",
      now,
    });
    expect(summary.recurrenceCount).toBe(2);

    const clusters = clusterSessionEventsForReview(events);
    expect(clusters[0]?.fingerprint).toBe("cluster-weekly");
    expect(clusters[0]?.recurrenceCount).toBe(2);
  });

  it("tracks edit pattern stability and externalization signals", () => {
    const now = Date.now();
    recordEditPatternStability({
      ownerKey: "user-a",
      transformId: "a->b",
      occurredAt: now,
    });
    recordEditPatternStability({
      ownerKey: "user-a",
      transformId: "a->b",
      occurredAt: now + 1,
    });
    recordEditPatternStability({
      ownerKey: "user-a",
      transformId: "a->b",
      occurredAt: now + 2,
    });
    recordExternalizationSignal({
      ownerKey: "user-a",
      kind: "copy",
      contextId: "artifact-1",
      sessionKey: "agent:main:main",
      occurredAt: now,
    });
    recordExternalizationSignal({
      ownerKey: "user-a",
      kind: "download",
      contextId: "artifact-1",
      occurredAt: now + 1,
    });

    const summary = summarizeEvidence({
      ownerKey: "user-a",
      clusterId: "artifact-1",
      now: now + 5_000,
    });
    expect(summary.editPatternStabilityCount).toBe(3);
    expect(summary.externalizationCount).toBe(2);
  });
});
