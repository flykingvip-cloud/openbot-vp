import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const evidencePath =
  "docs/design/evidence/conversation-identity-new-repo-commit-map-2026-09-24.json";
const sha = /^[0-9a-f]{40}$/;
const forbidden = /cookie|token|secret|credential|https?:\/\//i;

type Mapping = {
  oldCommit: string;
  canonicalNewRepoCommit: string;
  affectedFiles: string[];
  oldBlob: string;
  canonicalBlob: string;
  currentMainBlob: string;
  blobEquivalent: boolean;
  symbolEvidence: string;
  tests: string[];
  observedAt: string;
  originMainSha: string;
};

type MapFile = {
  originMainSha: string;
  observedAt: string;
  oldCommitsAreAncestors: boolean;
  ancestryGateUsesNewRepoCommits: boolean;
  productionProof: boolean;
  historyKind: string;
  mappings: Mapping[];
};

function load(): MapFile {
  return JSON.parse(readFileSync(evidencePath, "utf8")) as MapFile;
}

describe("conversation identity new-repo commit map", () => {
  const evidence = load();

  it("records a migration map, not a production proof", () => {
    expect(evidence.originMainSha).toMatch(sha);
    expect(evidence.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(evidence.oldCommitsAreAncestors).toBe(false);
    expect(evidence.ancestryGateUsesNewRepoCommits).toBe(true);
    expect(evidence.productionProof).toBe(false);
    expect(evidence.historyKind).toBe("squash-replay");
    expect(evidence.mappings).toHaveLength(4);
  });

  it("requires blob fields on every mapping", () => {
    for (const mapping of evidence.mappings) {
      expect(mapping.oldCommit).toMatch(sha);
      expect(mapping.canonicalNewRepoCommit).toBe("f1c7efece96d68375bf4b7fb57e77908fedfdd6c");
      expect(mapping.affectedFiles.length).toBeGreaterThan(0);
      expect(mapping.oldBlob).toMatch(sha);
      expect(mapping.canonicalBlob).toMatch(sha);
      expect(mapping.currentMainBlob).toMatch(sha);
      expect(typeof mapping.blobEquivalent).toBe("boolean");
      expect(mapping.symbolEvidence.length).toBeGreaterThan(10);
      expect(mapping.tests.length).toBeGreaterThan(0);
      expect(mapping.observedAt).toBe(evidence.observedAt);
      expect(mapping.originMainSha).toBe(evidence.originMainSha);
      if (mapping.blobEquivalent) {
        expect(mapping.oldBlob).toBe(mapping.canonicalBlob);
      }
    }
  });

  it("does not contain urls or credential field names", () => {
    const hits: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (!value || typeof value !== "object") {
        if (typeof value === "string" && forbidden.test(value)) {
          hits.push(path);
        }
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.test(key)) {
          hits.push(`${path}.${key}`);
        }
        walk(child, `${path}.${key}`);
      }
    };
    walk(evidence, "$");
    expect(hits).toEqual([]);
  });
});
