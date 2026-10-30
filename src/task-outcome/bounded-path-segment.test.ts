import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boundedOutcomePathSegment, DurableTaskOutcomeStore } from "./store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("boundedOutcomePathSegment / ENAMETOOLONG-safe task-outcomes", () => {
  it("keeps short ids URL-encoded", () => {
    expect(boundedOutcomePathSegment("task:simple")).toBe(encodeURIComponent("task:simple"));
  });

  it("hashes long CJK / URL-encoded space ids used as tip and contribution segments", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "outcome-cjk-"));
    tempDirs.push(root);
    const store = new DurableTaskOutcomeStore(root);
    // Prod-shaped: space id with CJK expands far past NAME_MAX when encodeURIComponent'd.
    const spaceId = `space:grp-flykingvip-gmail-com-${"研发小组".repeat(40)}`;
    const encoded = encodeURIComponent(spaceId);
    expect(encoded.length).toBeGreaterThan(160);

    const tip = store.tipPath(spaceId);
    expect(path.basename(tip).startsWith("h-")).toBe(true);
    expect(path.basename(tip).length).toBeLessThan(80);

    const contrib = store.contributionPath(spaceId, "task:m1");
    expect(path.basename(contrib).includes("h-")).toBe(true);
    expect(path.basename(contrib).length).toBeLessThan(120);

    // Round-trip under hashed names.
    store.saveContribution(spaceId, "task:m1", {
      outcomeVersion: 1,
      judgement: "ok",
      eligibilityAttribution: "test",
    });
    expect(store.loadContribution(spaceId, "task:m1")).toEqual({
      outcomeVersion: 1,
      judgement: "ok",
      eligibilityAttribution: "test",
    });
  });
});
