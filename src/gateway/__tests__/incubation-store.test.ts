import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock CONFIG_DIR to use a temp directory for test isolation
const tmpDir = path.join(os.tmpdir(), `openbot-incubation-test-${Date.now()}-${process.pid}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const { listDecisions, saveDecision, getEffectTracking, saveEffectTracking } =
  await import("../incubation-store.js");

import type {
  PromotionDecisionRecord,
  EffectTrackingRecord,
  IncubationScoreSnapshot,
} from "../incubation-store.js";

// --- Test Helpers ---

function makeScoreSnapshot(overrides?: Partial<IncubationScoreSnapshot>): IncubationScoreSnapshot {
  return {
    reuseBreath: 75,
    effectStability: 80,
    businessCoverage: 60,
    employeeSatisfaction: null,
    compositeScore: 72,
    ...overrides,
  };
}

function makeDecision(id: string, capabilityId = "cap-1"): PromotionDecisionRecord {
  return {
    decisionId: `decision-${id}`,
    capabilityId,
    decidedAt: Date.now(),
    decidedBy: "admin-user",
    result: "recommend_upload",
    reason: "This capability has proven stable and widely adopted across departments.",
    scoreSnapshot: makeScoreSnapshot(),
  };
}

function makeEffectTracking(capabilityId = "cap-1"): EffectTrackingRecord {
  return {
    capabilityId,
    promotionTimestamp: Date.now() - 30 * 24 * 60 * 60 * 1000,
    dailyCallSnapshots: [
      { date: "2026-01-01", count: 100 },
      { date: "2026-01-02", count: 110 },
    ],
    dailyDepartmentSnapshots: [
      { date: "2026-01-01", count: 3 },
      { date: "2026-01-02", count: 4 },
    ],
    dailySuccessRateSnapshots: [
      { date: "2026-01-01", rate: 0.92 },
      { date: "2026-01-02", rate: 0.94 },
    ],
  };
}

// --- Tests ---

describe("incubation-store", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Clean incubation dir before each test
    const incubationDir = path.join(tmpDir, "incubation");
    if (fs.existsSync(incubationDir)) {
      fs.rmSync(incubationDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  // --- File not exist fallback ---

  describe("file-not-exist fallback", () => {
    it("listDecisions returns empty array when no file exists", () => {
      expect(listDecisions()).toEqual([]);
    });

    it("getEffectTracking returns null when no file exists", () => {
      expect(getEffectTracking("cap-1")).toBeNull();
    });
  });

  // --- Atomic write consistency (Property 5: Round-Trip Completeness) ---

  describe("atomic write consistency", () => {
    it("decision round-trip: write then read preserves all fields", () => {
      const decision = makeDecision("rt-1");
      saveDecision(decision);

      const result = listDecisions();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(decision);
    });

    it("effect tracking round-trip: write then read preserves all fields", () => {
      const record = makeEffectTracking("cap-rt-1");
      saveEffectTracking(record);

      const result = getEffectTracking("cap-rt-1");
      expect(result).toEqual(record);
    });
  });

  // --- Promotion Decision CRUD ---

  describe("listDecisions", () => {
    it("returns all decisions after saving multiple", () => {
      saveDecision(makeDecision("1", "cap-1"));
      saveDecision(makeDecision("2", "cap-2"));
      saveDecision(makeDecision("3", "cap-1"));

      const all = listDecisions();
      expect(all).toHaveLength(3);
    });

    it("filters by capabilityId", () => {
      saveDecision(makeDecision("1", "cap-1"));
      saveDecision(makeDecision("2", "cap-2"));
      saveDecision(makeDecision("3", "cap-1"));

      const filtered = listDecisions("cap-1");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((d) => d.capabilityId === "cap-1")).toBe(true);
    });

    it("returns empty array when filtering by non-existent capabilityId", () => {
      saveDecision(makeDecision("1", "cap-1"));
      expect(listDecisions("cap-nonexistent")).toEqual([]);
    });
  });

  describe("saveDecision", () => {
    it("persists a decision record", () => {
      const decision = makeDecision("save-1");
      saveDecision(decision);

      const found = listDecisions();
      expect(found).toHaveLength(1);
      expect(found[0].decisionId).toBe("decision-save-1");
    });

    it("appends to existing records", () => {
      saveDecision(makeDecision("1"));
      saveDecision(makeDecision("2"));

      const all = listDecisions();
      expect(all).toHaveLength(2);
      expect(all[0].decisionId).toBe("decision-1");
      expect(all[1].decisionId).toBe("decision-2");
    });

    it("preserves all decision result types", () => {
      const decisions: PromotionDecisionRecord[] = [
        { ...makeDecision("a"), result: "recommend_upload" },
        { ...makeDecision("b"), result: "continue_incubation" },
        { ...makeDecision("c"), result: "not_suitable" },
      ];
      for (const d of decisions) {
        saveDecision(d);
      }

      const all = listDecisions();
      expect(all.map((d) => d.result)).toEqual([
        "recommend_upload",
        "continue_incubation",
        "not_suitable",
      ]);
    });
  });

  // --- Effect Tracking CRUD ---

  describe("getEffectTracking", () => {
    it("returns null when not found", () => {
      expect(getEffectTracking("nonexistent")).toBeNull();
    });

    it("returns correct record by capabilityId", () => {
      saveEffectTracking(makeEffectTracking("cap-1"));
      saveEffectTracking(makeEffectTracking("cap-2"));

      const found = getEffectTracking("cap-1");
      expect(found).not.toBeNull();
      expect(found!.capabilityId).toBe("cap-1");
    });
  });

  describe("saveEffectTracking", () => {
    it("creates a new record", () => {
      const record = makeEffectTracking("cap-new");
      saveEffectTracking(record);

      const found = getEffectTracking("cap-new");
      expect(found).toEqual(record);
    });

    it("updates existing record by capabilityId (upsert)", () => {
      const original = makeEffectTracking("cap-1");
      saveEffectTracking(original);

      const updated: EffectTrackingRecord = {
        ...original,
        dailyCallSnapshots: [...original.dailyCallSnapshots, { date: "2026-01-03", count: 120 }],
      };
      saveEffectTracking(updated);

      const found = getEffectTracking("cap-1");
      expect(found).not.toBeNull();
      expect(found!.dailyCallSnapshots).toHaveLength(3);
      expect(found!.dailyCallSnapshots[2]).toEqual({ date: "2026-01-03", count: 120 });
    });
  });

  // --- Atomic Write Safety (Property 14) ---

  describe("atomic write safety", () => {
    it("original file remains intact if tmp write would fail", () => {
      // Save initial data
      const decision = makeDecision("safe-1");
      saveDecision(decision);

      // Verify initial state
      const before = listDecisions();
      expect(before).toHaveLength(1);

      // The atomic write pattern (write tmp then rename) ensures that
      // if writeFileSync throws, the original file is untouched.
      // We verify the file on disk is valid JSON after normal writes.
      const incubationDir = path.join(tmpDir, "incubation");
      const decisionsFile = path.join(incubationDir, "decisions.json");
      const content = fs.readFileSync(decisionsFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].decisionId).toBe("decision-safe-1");
    });

    it("no temporary files remain after successful write", () => {
      saveDecision(makeDecision("tmp-check"));

      const incubationDir = path.join(tmpDir, "incubation");
      const files = fs.readdirSync(incubationDir);
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });

    it("concurrent writes do not corrupt data", () => {
      // Simulate sequential writes (synchronous API means no true concurrency,
      // but verifies that multiple writes produce consistent state)
      for (let i = 0; i < 10; i++) {
        saveDecision(makeDecision(`concurrent-${i}`));
      }

      const all = listDecisions();
      expect(all).toHaveLength(10);
      for (let i = 0; i < 10; i++) {
        expect(all[i].decisionId).toBe(`decision-concurrent-${i}`);
      }
    });
  });
});
