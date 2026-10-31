import { describe, expect, it } from "vitest";
import {
  BEGIN_MARKER,
  END_MARKER,
  checkReleaseRecordConsistency,
  extractGeneratedBlock,
  parseCliArgs,
  parseGeneratedIdentity,
  resolveOpenTip,
  upsertGeneratedBlock,
  type OpenTip,
} from "./release-record.ts";

const TIP_A: OpenTip = {
  seq: 151,
  gatewaySha: "d37bed5117d6969e5ad0ee47b32e4efa8b6d715a",
  uiSha: "d37bed5117d6969e5ad0ee47b32e4efa8b6d715a",
  artifactDigest: "sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48",
  imageTag: "rc-amd64-provenance-d37bed5117d6",
  artifactId: "rc-amd64-provenance-d37bed5117d6",
  tag: "provenance/sha-d37bed5117d6",
  liveFrom: "2026-10-31T03:21:00.871Z",
  liveVerified: true,
};

const TIP_B: OpenTip = {
  ...TIP_A,
  seq: 150,
  gatewaySha: "66bad421c9bb74ccfd6234fc3e003aaa67ce798a",
  uiSha: "66bad421c9bb74ccfd6234fc3e003aaa67ce798a",
  artifactDigest: "sha256:baff3fa97596e284681a62f2d27523d0dded5b7ebcfba7ea8875bfec97ce684d",
  imageTag: "rc-amd64-provenance-66bad421c9bb",
  artifactId: "rc-amd64-provenance-66bad421c9bb",
  tag: "provenance/sha-66bad421c9bb",
  liveFrom: "2026-10-30T22:56:48.458Z",
};

function row(tip: OpenTip, liveTo?: string): string {
  const base: Record<string, unknown> = {
    schemaVersion: 2,
    seq: tip.seq,
    gatewaySha: tip.gatewaySha,
    uiSha: tip.uiSha,
    buildMode: "full-dist",
    artifactKind: "image",
    artifactId: tip.artifactId,
    artifactDigest: tip.artifactDigest,
    tag: tip.tag,
    imageTag: tip.imageTag,
    liveFrom: tip.liveFrom,
    evidence: "test-fixture",
    executor: "test",
    liveVerified: tip.liveVerified,
  };
  if (liveTo !== undefined) {
    base.liveTo = liveTo;
  }
  return JSON.stringify(base);
}

describe("resolveOpenTip", () => {
  it("returns the unique open tip (normal consistent ledger)", () => {
    const text = [row(TIP_B, TIP_A.liveFrom), row(TIP_A)].join("\n");
    const resolved = resolveOpenTip(text);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.tip.seq).toBe(151);
      expect(resolved.tip.gatewaySha).toBe(TIP_A.gatewaySha);
    }
  });

  it("fails closed on zero open intervals", () => {
    const text = row(TIP_A, "2026-10-31T04:00:00.000Z");
    const resolved = resolveOpenTip(text);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.code).toBe("zero-open");
    }
  });

  it("fails closed on multi-open intervals", () => {
    const text = [row(TIP_B), row(TIP_A)].join("\n");
    const resolved = resolveOpenTip(text);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.code).toBe("multi-open");
      expect(resolved.openSeqs).toEqual([150, 151]);
    }
  });

  it("fails on parse errors", () => {
    const resolved = resolveOpenTip("{not-json\n");
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.code).toBe("parse-error");
    }
  });

  it("fails closed when required identity fields are absent (parse or tip validation)", () => {
    const bad = JSON.stringify({
      schemaVersion: 2,
      seq: 9,
      gatewaySha: "d37bed5117d6969e5ad0ee47b32e4efa8b6d715a",
      // uiSha intentionally omitted
      artifactKind: "image",
      artifactId: "x",
      artifactDigest: "sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48",
      tag: "provenance/sha-d37bed5117d6",
      liveFrom: "2026-10-31T03:21:00.871Z",
    });
    const resolved = resolveOpenTip(bad);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(["parse-error", "missing-fields", "zero-open"]).toContain(resolved.code);
    }
  });
});

describe("generate + check", () => {
  it("normal consistent: generate then check passes", () => {
    const ledger = [row(TIP_B, TIP_A.liveFrom), row(TIP_A)].join("\n");
    const md = upsertGeneratedBlock("# Release record\n\n## Latest cutover\n\nold\n", TIP_A);
    expect(md).toContain(BEGIN_MARKER);
    expect(md).toContain(END_MARKER);
    expect(md).toContain("ledger ↔ human-doc consistency");
    const check = checkReleaseRecordConsistency(ledger, md);
    expect(check.ok).toBe(true);
  });

  it("stale static record fails check", () => {
    const ledger = [row(TIP_B, TIP_A.liveFrom), row(TIP_A)].join("\n");
    const md = upsertGeneratedBlock("# Release record\n", TIP_B);
    const check = checkReleaseRecordConsistency(ledger, md);
    expect(check.ok).toBe(false);
    expect(check.reasons.join("\n")).toMatch(/seq drift|gatewaySha drift/);
  });

  it("multi-open ledger fails check with clear reason", () => {
    const ledger = [row(TIP_B), row(TIP_A)].join("\n");
    const md = upsertGeneratedBlock("# Release record\n", TIP_A);
    const check = checkReleaseRecordConsistency(ledger, md);
    expect(check.ok).toBe(false);
    expect(check.reasons.join("\n")).toMatch(/multi-open/);
  });

  it("zero-open ledger fails check", () => {
    const ledger = row(TIP_A, "2026-10-31T04:00:00.000Z");
    const md = upsertGeneratedBlock("# Release record\n", TIP_A);
    const check = checkReleaseRecordConsistency(ledger, md);
    expect(check.ok).toBe(false);
    expect(check.reasons.join("\n")).toMatch(/zero-open/);
  });

  it("gateway/UI from different sources are both required in the block", () => {
    const split: OpenTip = {
      ...TIP_A,
      uiSha: "66bad421c9bb74ccfd6234fc3e003aaa67ce798a",
    };
    const ledger = row(split);
    const md = upsertGeneratedBlock("# Release record\n", split);
    const parsed = parseGeneratedIdentity(extractGeneratedBlock(md)!);
    expect(parsed.gatewaySha).toBe(split.gatewaySha);
    expect(parsed.uiSha).toBe(split.uiSha);
    expect(parsed.gatewaySha).not.toBe(parsed.uiSha);
    expect(checkReleaseRecordConsistency(ledger, md).ok).toBe(true);

    const staleUi = md.replaceAll(split.uiSha, TIP_A.uiSha);
    const bad = checkReleaseRecordConsistency(ledger, staleUi);
    expect(bad.ok).toBe(false);
    expect(bad.reasons.join("\n")).toMatch(/uiSha drift/);
  });

  it("missing generated markers fails check", () => {
    const ledger = row(TIP_A);
    const check = checkReleaseRecordConsistency(ledger, "# Release record\n\nno markers\n");
    expect(check.ok).toBe(false);
    expect(check.reasons.join("\n")).toMatch(/missing GENERATED/);
  });

  it("repeated generate is idempotent", () => {
    const once = upsertGeneratedBlock("# Release record\n\nhistory\n", TIP_A);
    const twice = upsertGeneratedBlock(once, TIP_A);
    expect(twice).toBe(once);
    expect(once.split(BEGIN_MARKER).length - 1).toBe(1);
    expect(once.split(END_MARKER).length - 1).toBe(1);
  });

  it("upsert leaves surrounding historical narrative intact", () => {
    const original = [
      "# Release record",
      "",
      "## Delivery pipeline (SoT)",
      "",
      "- hand-written rule",
      "",
      "## Latest cutover (historical)",
      "",
      "do not rewrite me",
      "",
    ].join("\n");
    const next = upsertGeneratedBlock(original, TIP_A);
    expect(next).toContain("- hand-written rule");
    expect(next).toContain("## Latest cutover (historical)");
    expect(next).toContain("do not rewrite me");
    expect(next.indexOf(BEGIN_MARKER)).toBeLessThan(next.indexOf("## Latest cutover"));
  });

  it("PoC: human-visible table SHA corrupted while machine comment unchanged must fail", () => {
    const ledger = [row(TIP_B, TIP_A.liveFrom), row(TIP_A)].join("\n");
    const md = upsertGeneratedBlock("# Release record\n", TIP_A);
    expect(checkReleaseRecordConsistency(ledger, md).ok).toBe(true);

    const wrongSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const corrupted = md.replace(
      /\|\s*gatewaySha\s*\|\s*`[0-9a-f]{40}`\s*\|/i,
      `| gatewaySha | \`${wrongSha}\` |`,
    );
    expect(corrupted).not.toBe(md);
    // Hidden machine comment still has the tip SHA.
    expect(corrupted).toContain(`gatewaySha=${TIP_A.gatewaySha}`);
    expect(corrupted).toContain(wrongSha);
    const identityLine = corrupted.split("\n").find((l) => l.includes("<!-- identity:"));
    expect(identityLine).toBeTruthy();
    expect(identityLine!).toContain(TIP_A.gatewaySha);
    expect(identityLine!).not.toContain(wrongSha);

    const bad = checkReleaseRecordConsistency(ledger, corrupted);
    expect(bad.ok).toBe(false);
    expect(bad.reasons.join("\n")).toMatch(/table gatewaySha drift|surface mismatch gatewaySha/);
  });
});

describe("parseCliArgs", () => {
  it("defaults to check and rejects --write on check", () => {
    expect(parseCliArgs([]).mode).toBe("check");
    expect(() => parseCliArgs(["check", "--write"])).toThrow(/must not use --write/);
  });

  it("accepts generate --write", () => {
    const opts = parseCliArgs(["generate", "--write", "--ledger", "x.jsonl"]);
    expect(opts.mode).toBe("generate");
    expect(opts.write).toBe(true);
    expect(opts.ledgerPath).toBe("x.jsonl");
  });
});
