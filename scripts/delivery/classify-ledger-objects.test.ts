import { describe, expect, it } from "vitest";
import {
  CLASS_ABSENT_REMOTE,
  CLASS_FETCHABLE_REMOTE,
  CLASS_MISSING_LOCAL,
  CLASS_PRESENT,
  CLASS_PROBE_INCONCLUSIVE,
  buildClassifyReport,
  classifyFetchProbe,
  collectLedgerShas,
  parseCliArgs,
} from "./classify-ledger-objects.ts";
import type { GitRunner } from "./forward-guard.ts";
import type { ReleaseRow } from "./ledger.ts";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SHA_C = "cccccccccccccccccccccccccccccccccccccccc";

function row(seq: number, sha: string, liveTo?: string): ReleaseRow {
  return {
    schemaVersion: 2,
    seq,
    gatewaySha: sha,
    uiSha: sha,
    buildMode: "full-dist",
    artifactKind: "image",
    artifactId: `rc-${sha.slice(0, 12)}`,
    artifactDigest: `sha256:${"a".repeat(64)}`,
    tag: `provenance/sha-${sha.slice(0, 12)}`,
    imageTag: `rc-amd64-provenance-${sha.slice(0, 12)}`,
    liveFrom: "2026-10-31T03:21:00.871Z",
    liveTo,
    evidence: "fixture",
    executor: "test",
    liveVerified: true,
  };
}

function gitStub(options: { shallow?: boolean; present?: string[] }): GitRunner {
  const present = new Set(options.present ?? []);
  return (args) => {
    if (args[0] === "cat-file" && args[1] === "-t") {
      const sha = args[2] ?? "";
      return present.has(sha)
        ? { code: 0, stdout: "commit\n" }
        : { code: 128, stdout: "", stderr: "fatal: Not a valid object name" };
    }
    if (args[0] === "rev-parse" && args[1] === "--is-shallow-repository") {
      return { code: 0, stdout: options.shallow ? "true\n" : "false\n" };
    }
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 0, stdout: "cccccccccccccccccccccccccccccccccccccccc\n" };
    }
    if (args[0] === "rev-list" && args[1] === "--count") {
      return { code: 0, stdout: args[2] === "HEAD" ? "10\n" : "20\n" };
    }
    return { code: 1, stdout: "" };
  };
}

describe("classifyFetchProbe", () => {
  it("maps a successful fetch as fetchable-by-sha, not as a local presence result", () => {
    expect(classifyFetchProbe(0, "")).toBe(CLASS_FETCHABLE_REMOTE);
  });

  it("maps GitHub 'not our ref' as absence from the probed remote", () => {
    expect(classifyFetchProbe(128, "fatal: remote error: upload-pack: not our ref aaaa")).toBe(
      CLASS_ABSENT_REMOTE,
    );
  });

  it("does not treat an unexpected fetch error as proven absence", () => {
    expect(classifyFetchProbe(128, "fatal: unable to access 'https://example.invalid/'")).toBe(
      CLASS_PROBE_INCONCLUSIVE,
    );
  });
});

describe("buildClassifyReport", () => {
  it("keeps missing local objects as missing-from-current-store without a probe", () => {
    const report = buildClassifyReport({
      rows: [row(1, SHA_A, "2026-11-01T00:00:00Z"), row(2, SHA_B)],
      git: gitStub({ present: [SHA_B] }),
      ledgerPath: "fixture.jsonl",
    });
    expect(report.facts.isShallow).toBe(false);
    expect(report.classificationCounts[CLASS_PRESENT]).toBe(1);
    expect(report.classificationCounts[CLASS_MISSING_LOCAL]).toBe(1);
    expect(report.records.find((r) => r.sha === SHA_A)?.classification).toBe(CLASS_MISSING_LOCAL);
    expect(report.records.find((r) => r.sha === SHA_B)?.classification).toBe(CLASS_PRESENT);
  });

  it("reports shallow=true so a truncated clone is not called proven remote absence", () => {
    const report = buildClassifyReport({
      rows: [row(1, SHA_A)],
      git: gitStub({ shallow: true, present: [] }),
      ledgerPath: "fixture.jsonl",
    });
    expect(report.facts.isShallow).toBe(true);
    expect(report.records[0]?.classification).toBe(CLASS_MISSING_LOCAL);
  });

  it("uses the probe result only for objects missing locally", () => {
    const report = buildClassifyReport({
      rows: [row(1, SHA_A, "2026-11-01T00:00:00Z"), row(2, SHA_B), row(3, SHA_C)],
      git: gitStub({ present: [SHA_C] }),
      ledgerPath: "fixture.jsonl",
      probe: (sha) =>
        sha === SHA_A
          ? { code: 128, message: "fatal: remote error: upload-pack: not our ref" }
          : { code: 0, message: "" },
    });
    expect(report.records.find((r) => r.sha === SHA_A)?.classification).toBe(CLASS_ABSENT_REMOTE);
    expect(report.records.find((r) => r.sha === SHA_B)?.classification).toBe(
      CLASS_FETCHABLE_REMOTE,
    );
    expect(report.records.find((r) => r.sha === SHA_C)?.classification).toBe(CLASS_PRESENT);
  });

  it("collects both gateway and UI SHAs for overlay rows", () => {
    const overlay: ReleaseRow = { ...row(4, SHA_A), uiSha: SHA_B };
    const collected = collectLedgerShas([overlay]);
    expect(collected.get(SHA_A)?.gatewaySeqs).toEqual([4]);
    expect(collected.get(SHA_B)?.uiSeqs).toEqual([4]);
  });
});

describe("parseCliArgs", () => {
  it("defaults to a local-only report and accepts an output path", () => {
    const opts = parseCliArgs(["--output", "out.jsonl", "--ledger", "x.jsonl"]);
    expect(opts.probeOrigin).toBe(false);
    expect(opts.outputPath).toBe("out.jsonl");
    expect(opts.ledgerPath).toBe("x.jsonl");
  });

  it("requires an explicit flag before probing a remote", () => {
    expect(parseCliArgs(["--probe-origin", "--remote", "origin"]).probeOrigin).toBe(true);
  });
});
