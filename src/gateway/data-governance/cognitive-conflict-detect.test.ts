import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyCognitiveClaimPair,
  detectAndRecordCognitiveConflict,
  type CognitiveComparableClaim,
} from "./cognitive-conflict-detect.js";

function loadFixture(name: string): Array<{
  id: string;
  left: CognitiveComparableClaim;
  right: CognitiveComparableClaim;
}> {
  return fs
    .readFileSync(path.join(import.meta.dirname, "fixtures/p3e", name), "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          id: string;
          left: CognitiveComparableClaim;
          right: CognitiveComparableClaim;
        },
    );
}
import { listConflictEdges } from "./cognitive-conflict-graph.js";
import { unlockCognitiveWritesForTests } from "./cognitive-write-unlock.test-harness.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function claim(patch: Partial<CognitiveComparableClaim> = {}): CognitiveComparableClaim {
  return {
    claimKind: "fact",
    subject: "pref.theme",
    polarity: "assert",
    value: "dark",
    scope: "user:u1",
    ...patch,
  };
}

describe("classifyCognitiveClaimPair", () => {
  it("detects same-subject incompatible values and ignores labels", () => {
    expect(classifyCognitiveClaimPair(claim({ value: "dark" }), claim({ value: "light" }))).toEqual(
      { conflict: true, conflictKind: "fact" },
    );
    expect(
      classifyCognitiveClaimPair(
        claim({ claimKind: "policy", subject: "retention.days", value: "30" }),
        claim({ claimKind: "policy", subject: "retention.days", value: "90" }),
      ),
    ).toEqual({ conflict: true, conflictKind: "policy" });
  });

  it("treats restated equivalents and disjoint windows as non-conflicts", () => {
    expect(classifyCognitiveClaimPair(claim({ value: "DARK" }), claim({ value: "dark" }))).toEqual({
      conflict: false,
    });
    expect(
      classifyCognitiveClaimPair(
        claim({
          claimKind: "temporal",
          subject: "oncall.owner",
          value: "ada",
          validFrom: "2026-01-01T00:00:00Z",
          validTo: "2026-01-31T00:00:00Z",
        }),
        claim({
          claimKind: "temporal",
          subject: "oncall.owner",
          value: "bev",
          validFrom: "2026-02-01T00:00:00Z",
          validTo: "2026-02-28T00:00:00Z",
        }),
      ),
    ).toEqual({ conflict: false });
    expect(
      classifyCognitiveClaimPair(claim({ subject: "pref.theme" }), claim({ subject: "pref.font" })),
    ).toEqual({ conflict: false });
  });

  it("classifies every pinned semantic fixture without reading labels", () => {
    for (const row of loadFixture("merge-conflict-negative.jsonl")) {
      expect(classifyCognitiveClaimPair(row.left, row.right), row.id).toMatchObject({
        conflict: true,
      });
    }
    for (const row of loadFixture("conflict-must-detect.jsonl")) {
      expect(classifyCognitiveClaimPair(row.left, row.right), row.id).toMatchObject({
        conflict: true,
      });
    }
    for (const row of loadFixture("merge-equiv-positive.jsonl")) {
      expect(classifyCognitiveClaimPair(row.left, row.right), row.id).toEqual({ conflict: false });
    }
  });
});

describe("detectAndRecordCognitiveConflict", () => {
  it("writes an open edge only when the pair classifies as a conflict", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-detect-"));
    tempDirs.push(stateDir);
    unlockCognitiveWritesForTests(stateDir);
    const hit = await detectAndRecordCognitiveConflict({
      tenantId: "t1",
      stateDir,
      leftResourceId: "mem-target",
      rightResourceId: "mem-src",
      leftClaim: claim({ value: "dark" }),
      rightClaim: claim({ value: "light" }),
      evaluatorId: "eval-detect",
    });
    expect(hit).toMatchObject({ ok: true, detected: true, conflictKind: "fact" });
    expect(
      listConflictEdges({ tenantId: "t1", stateDir }).filter((e) => e.status === "open"),
    ).toHaveLength(1);

    const miss = await detectAndRecordCognitiveConflict({
      tenantId: "t1",
      stateDir,
      leftResourceId: "mem-a",
      rightResourceId: "mem-b",
      leftClaim: claim({ value: "dark" }),
      rightClaim: claim({ value: "DARK" }),
      evaluatorId: "eval-equiv",
    });
    expect(miss).toEqual({ ok: true, detected: false });
    expect(
      listConflictEdges({ tenantId: "t1", stateDir }).filter((e) => e.status === "open"),
    ).toHaveLength(1);
  });

  it("fail-closes on invalid claims instead of recording a negative", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-detect-bad-"));
    tempDirs.push(stateDir);
    unlockCognitiveWritesForTests(stateDir);
    const result = await detectAndRecordCognitiveConflict({
      tenantId: "t1",
      stateDir,
      leftResourceId: "mem-target",
      rightResourceId: "mem-src",
      leftClaim: { claimKind: "fact", subject: "", polarity: "assert", value: "x", scope: "s" },
      rightClaim: claim(),
      evaluatorId: "eval-bad",
    });
    expect(result).toEqual({ ok: false, error: "invalid_claim" });
    expect(listConflictEdges({ tenantId: "t1", stateDir })).toEqual([]);
  });
});
