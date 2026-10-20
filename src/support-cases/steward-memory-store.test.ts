import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendStewardInteraction,
  loadStewardMemory,
  resolveStewardMemoryFileName,
} from "./steward-memory-store.js";

let stateDir: string;
let envSnapshot: string | undefined;

beforeEach(async () => {
  envSnapshot = process.env.OPENCLAW_STATE_DIR;
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-steward-mem-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(async () => {
  if (envSnapshot === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = envSnapshot;
  }
  await fs.rm(stateDir, { recursive: true, force: true });
});

describe("steward memory store", () => {
  const key = { userId: "user-1", tenantId: "tenant-1" };
  const key2 = { userId: "user-1", tenantId: "tenant-2" };

  it("returns empty memory when no file exists", async () => {
    const mem = await loadStewardMemory(key);
    expect(mem.userId).toBe("user-1");
    expect(mem.tenantId).toBe("tenant-1");
    expect(mem.lastIntents).toEqual([]);
    expect(mem.preferences).toEqual({});
  });

  it("isolates by tenantId + userId composite key", () => {
    const a = resolveStewardMemoryFileName({ userId: "u1", tenantId: "t1" });
    const b = resolveStewardMemoryFileName({ userId: "u1", tenantId: "t2" });
    expect(a).not.toBe(b);
  });

  it("appends intents with rolling window truncation", async () => {
    for (let i = 0; i < 35; i += 1) {
      await appendStewardInteraction({
        ...key,
        intent: { summary: `q${i}`, atMs: i },
      });
    }
    const mem = await loadStewardMemory(key);
    expect(mem.lastIntents.length).toBe(30); // MAX_RECENT_INTENTS = 30
    expect(mem.lastIntents[0].summary).toBe("q5"); // oldest should be truncated
    expect(mem.lastIntents[29].summary).toBe("q34");
  });

  it("deduplicates capability hints and resolved topics", async () => {
    await appendStewardInteraction({ ...key, capabilityHint: "billing" });
    await appendStewardInteraction({ ...key, capabilityHint: "knowledge" });
    await appendStewardInteraction({ ...key, capabilityHint: "billing" });
    const mem = await loadStewardMemory(key);
    // Deduplicated and "billing" moved to end.
    expect(mem.capabilityUsageHints).toEqual(["knowledge", "billing"]);
  });

  it("merges preferences additively", async () => {
    await appendStewardInteraction({ ...key, preferences: { lang: "zh" } });
    await appendStewardInteraction({ ...key, preferences: { brevity: "concise" } });
    const mem = await loadStewardMemory(key);
    expect(mem.preferences).toEqual({ lang: "zh", brevity: "concise" });
  });

  it("does not cross-contaminate between different keys", async () => {
    await appendStewardInteraction({ ...key, resolvedTopic: "topic-a" });
    await appendStewardInteraction({ ...key2, resolvedTopic: "topic-b" });
    const memA = await loadStewardMemory(key);
    const memB = await loadStewardMemory(key2);
    expect(memA.recentResolvedTopics).toEqual(["topic-a"]);
    expect(memB.recentResolvedTopics).toEqual(["topic-b"]);
  });

  it("gracefully degrades when file is corrupted (returns empty)", async () => {
    const dir = path.join(stateDir, "steward-memory");
    await fs.mkdir(dir, { recursive: true });
    const fileName = resolveStewardMemoryFileName(key);
    await fs.writeFile(path.join(dir, fileName), "not json!", "utf8");
    const mem = await loadStewardMemory(key);
    expect(mem.lastIntents).toEqual([]);
  });
});
