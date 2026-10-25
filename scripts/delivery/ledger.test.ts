import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseCutoverArgs,
  prepareCutoverRecord,
  serializeV2Row,
  writeCutoverRecord,
} from "./cutover-record.ts";
import type { GitRunner } from "./forward-guard.ts";
import {
  auditLedger,
  isOverlay,
  isV2Row,
  parseLedger,
  shaFromImageTag,
  shippedShas,
  type ReleaseRow,
} from "./ledger.ts";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

/** Ancestry stub: `contains[child]` lists every commit reachable from `child`. */
function ancestryRunner(contains: Record<string, string[]>): GitRunner {
  return (args) => {
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      const [, , parent, child] = args;
      const reachable = contains[child ?? ""] ?? [];
      const ok = parent === child || reachable.includes(parent ?? "");
      return { code: ok ? 0 : 1, stdout: "" };
    }
    return { code: 1, stdout: "" };
  };
}

function row(overrides: Partial<ReleaseRow> & Pick<ReleaseRow, "seq">): ReleaseRow {
  return {
    gatewaySha: "a".repeat(40),
    uiSha: "a".repeat(40),
    imageTag: `rc-amd64-provenance-${"a".repeat(12)}`,
    tag: "provenance/sha-" + "a".repeat(12),
    liveFrom: "2026-07-27T00:00:00Z",
    evidence: "container build-info",
    ...overrides,
  };
}

describe("parseLedger", () => {
  it("skips blank lines and comments", () => {
    const text = ["// header", "", JSON.stringify(row({ seq: 1 })), ""].join("\n");
    const result = parseLedger(text);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("reports a bad line without discarding the good ones", () => {
    const text = [
      JSON.stringify(row({ seq: 1 })),
      "{not json",
      JSON.stringify(row({ seq: 2 })),
    ].join("\n");
    const result = parseLedger(text);
    expect(result.rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(2);
  });

  it("rejects rows missing required fields", () => {
    const result = parseLedger(JSON.stringify({ seq: 1, gatewaySha: "abc" }));
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain("missing required fields");
  });
});

function v2Row(overrides: Partial<ReleaseRow> & Pick<ReleaseRow, "seq">): ReleaseRow {
  return {
    schemaVersion: 2,
    gatewaySha: "a".repeat(40),
    uiSha: "a".repeat(40),
    buildMode: "full-dist",
    artifactKind: "image",
    artifactId: `rc-amd64-provenance-${"a".repeat(12)}`,
    artifactDigest: DIGEST_A,
    tag: "provenance/sha-" + "a".repeat(12),
    liveFrom: "2026-08-27T04:11:44Z",
    evidence: "container build-info",
    executor: "operator",
    imageTag: `rc-amd64-provenance-${"a".repeat(12)}`,
    ...overrides,
  };
}

describe("shaFromImageTag", () => {
  it("extracts the provenance sha, suffix or not", () => {
    expect(shaFromImageTag("rc-amd64-provenance-87d46f34ac")).toBe("87d46f34ac");
    expect(shaFromImageTag("rc-amd64-provenance-9a84706d4a-im-on-recovery")).toBe("9a84706d4a");
  });

  it("returns null for pre-provenance tags", () => {
    expect(shaFromImageTag("rc-amd64-v119-asset-suggestion-dismiss")).toBeNull();
  });
});

describe("overlay detection", () => {
  it("treats differing gateway and UI shas as an overlay shipping two commits", () => {
    const overlay = row({ seq: 1, gatewaySha: "g".repeat(40), uiSha: "u".repeat(40) });
    expect(isOverlay(overlay)).toBe(true);
    expect(shippedShas(overlay)).toEqual(["g".repeat(40), "u".repeat(40)]);
  });

  it("treats a matching pair as full-dist shipping one commit", () => {
    const full = row({ seq: 1 });
    expect(isOverlay(full)).toBe(false);
    expect(shippedShas(full)).toHaveLength(1);
  });
});

describe("auditLedger", () => {
  it("passes a forward-only full-dist chain", () => {
    const rows = [
      row({
        seq: 1,
        gatewaySha: "c1",
        uiSha: "c1",
        imageTag: "rc-amd64-provenance-c1",
        liveTo: "2026-07-27T01:00:00Z",
      }),
      row({ seq: 2, gatewaySha: "c2", uiSha: "c2", imageTag: "rc-amd64-provenance-c2" }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ c2: ["c1"] }));
    expect(audit.ok).toBe(true);
    expect(audit.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("flags a release that drops a commit the previous one had live", () => {
    const rows = [
      row({
        seq: 1,
        gatewaySha: "c1",
        uiSha: "c1",
        imageTag: "rc-amd64-provenance-c1",
        liveTo: "2026-07-27T01:00:00Z",
      }),
      row({ seq: 2, gatewaySha: "c9", uiSha: "c9", imageTag: "rc-amd64-provenance-c9" }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ c9: [] }));
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "regression")).toBe(true);
  });

  // The 2026-07-27 incident: an overlay shipped UI 9a84706d4a on gateway 1e1143012db2,
  // dropping 83a1487579 which had been live 30 minutes earlier. Checking only the gateway
  // half would have called this forward-only, because 1e1143012db2 is an ancestor of both.
  it("catches the overlay that dropped a previously live commit", () => {
    const rows = [
      row({
        seq: 1,
        gatewaySha: "83a1487579",
        uiSha: "83a1487579",
        imageTag: "rc-amd64-provenance-83a148757972",
        liveTo: "2026-07-27T04:23:13Z",
      }),
      row({
        seq: 2,
        gatewaySha: "1e1143012db2",
        uiSha: "9a84706d4a",
        imageTag: "rc-amd64-provenance-9a84706d4a-im-on-recovery",
      }),
    ];
    const audit = auditLedger(
      rows,
      ancestryRunner({ "9a84706d4a": ["1e1143012db2"], "1e1143012db2": [] }),
    );
    expect(audit.ok).toBe(false);
    const regression = audit.findings.find((f) => f.code === "regression");
    expect(regression?.message).toContain("83a1487579");
    expect(audit.findings.some((f) => f.code === "overlay-debt")).toBe(true);
  });

  it("downgrades an acknowledged regression to a warning so history does not pin CI red", () => {
    const rows = [
      row({
        seq: 1,
        gatewaySha: "c1",
        uiSha: "c1",
        imageTag: "rc-amd64-provenance-c1",
        liveTo: "2026-07-27T01:00:00Z",
      }),
      row({
        seq: 2,
        gatewaySha: "c9",
        uiSha: "c9",
        imageTag: "rc-amd64-provenance-c9",
        regressionAcknowledged: "historical incident, recorded on purpose",
      }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ c9: [] }));
    expect(audit.ok).toBe(true);
    const regression = audit.findings.find((f) => f.code === "regression");
    expect(regression?.severity).toBe("warning");
    expect(regression?.message).toContain("acknowledged");
  });

  it("flags an image tag that does not name either shipped commit", () => {
    const rows = [
      row({
        seq: 1,
        gatewaySha: "abc123abc123",
        uiSha: "abc123abc123",
        imageTag: "rc-amd64-provenance-deadbeefdead",
      }),
    ];
    const audit = auditLedger(rows, ancestryRunner({}));
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "identity-mismatch")).toBe(true);
  });

  it("rejects duplicate sequence numbers", () => {
    const rows = [row({ seq: 5 }), row({ seq: 5 })];
    const audit = auditLedger(rows, ancestryRunner({}));
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "duplicate-seq")).toBe(true);
  });

  it("warns when a release has no provenance tag or no observation evidence", () => {
    const rows = [row({ seq: 1, tag: undefined, evidence: undefined })];
    const audit = auditLedger(rows, ancestryRunner({}));
    expect(audit.findings.some((f) => f.code === "missing-tag")).toBe(true);
    expect(audit.findings.some((f) => f.code === "unobserved")).toBe(true);
    expect(audit.ok).toBe(true);
  });

  // The 2026-08-23 incident class: overlay 47d6934c34 ran ~8.7h without a ledger row.
  // With honest timestamps that shows up as a hole between liveTo and the next liveFrom.
  it("warns on a LIVE timeline hole between consecutive releases", () => {
    const rows = [
      row({ seq: 1, liveFrom: "2026-08-23T09:00:00Z", liveTo: "2026-08-23T13:55:05Z" }),
      row({ seq: 2, liveFrom: "2026-08-23T22:37:47Z" }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ ["a".repeat(40)]: [] }));
    const gap = audit.findings.find((f) => f.code === "timeline-gap");
    expect(gap?.severity).toBe("warning");
    expect(gap?.seq).toBe(2);
    expect(gap?.message).toContain("hole");
    expect(audit.ok).toBe(true);
  });

  it("warns when a superseded release never closed its liveTo", () => {
    const rows = [
      row({ seq: 1, liveFrom: "2026-08-23T09:00:00Z" }),
      row({ seq: 2, liveFrom: "2026-08-23T10:00:00Z", liveTo: "2026-08-23T11:00:00Z" }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ ["a".repeat(40)]: [] }));
    const gap = audit.findings.find((f) => f.code === "timeline-gap");
    expect(gap?.seq).toBe(1);
    expect(gap?.message).toContain("no liveTo");
    expect(audit.findings.some((f) => f.code === "open-interval")).toBe(false);
  });

  it("errors when more than one row omits liveTo", () => {
    const rows = [
      row({ seq: 1, liveFrom: "2026-08-23T09:00:00Z" }),
      row({ seq: 2, liveFrom: "2026-08-23T10:00:00Z" }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ ["a".repeat(40)]: [] }));
    expect(audit.ok).toBe(false);
    const open = audit.findings.find((f) => f.code === "open-interval");
    expect(open?.severity).toBe("error");
    expect(open?.message).toContain("seq 1, 2");
  });

  it("warns when two releases claim overlapping LIVE windows", () => {
    const rows = [
      row({ seq: 1, liveFrom: "2026-08-23T09:00:00Z", liveTo: "2026-08-23T12:00:00Z" }),
      row({ seq: 2, liveFrom: "2026-08-23T11:00:00Z" }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ ["a".repeat(40)]: [] }));
    const gap = audit.findings.find((f) => f.code === "timeline-gap");
    expect(gap?.message).toContain("overlap");
  });

  it("stays quiet when consecutive spans touch exactly", () => {
    const rows = [
      row({ seq: 1, liveFrom: "2026-08-23T09:00:00Z", liveTo: "2026-08-23T12:00:00Z" }),
      row({ seq: 2, liveFrom: "2026-08-23T12:00:00Z" }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ ["a".repeat(40)]: [] }));
    expect(audit.findings.some((f) => f.code === "timeline-gap")).toBe(false);
  });
});

describe("parseLedger v2", () => {
  it("still parses historical v1 rows without schemaVersion", () => {
    const text = JSON.stringify(row({ seq: 1 }));
    const result = parseLedger(text);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(isV2Row(result.rows[0])).toBe(false);
    expect(result.rows[0]?.imageTag).toContain("provenance");
  });

  it("rejects v2 rows missing required fields", () => {
    const result = parseLedger(JSON.stringify({ schemaVersion: 2, seq: 1, gatewaySha: "abc" }));
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain("missing required v2 fields");
    expect(result.errors[0]?.message).toContain("artifactDigest");
    expect(result.errors[0]?.message).toContain("buildMode");
  });

  it("requires baseImageTag and baseImageDigest for dist-overlay", () => {
    const result = parseLedger(
      JSON.stringify(
        v2Row({
          seq: 1,
          artifactKind: "dist-overlay",
          baseImageTag: undefined,
          baseImageDigest: undefined,
        }),
      ),
    );
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain("dist-overlay missing");
  });

  it("accepts a complete v2 image row", () => {
    const result = parseLedger(JSON.stringify(v2Row({ seq: 1 })));
    expect(result.errors).toEqual([]);
    expect(isV2Row(result.rows[0])).toBe(true);
    expect(result.rows[0]?.artifactDigest).toBe(DIGEST_A);
  });
});

describe("auditLedger v2 identity", () => {
  it("does not identity-mismatch a v2 overlay whose base image tag names a different sha", () => {
    const overlay = v2Row({
      seq: 1,
      artifactKind: "dist-overlay",
      artifactId: "overlay-item7-s18",
      artifactDigest: DIGEST_B,
      baseImageTag: "rc-amd64-provenance-5c221b9ec3",
      baseImageDigest: DIGEST_A,
      gatewaySha: "7cd74d4c5c69e7492eb6d624531f27592d6c809a",
      uiSha: "7cd74d4c5c69e7492eb6d624531f27592d6c809a",
      imageTag: "rc-amd64-provenance-5c221b9ec3",
    });
    const v1WouldClaim = shaFromImageTag(overlay.imageTag ?? "");
    expect(v1WouldClaim).toBe("5c221b9ec3");
    expect(overlay.gatewaySha.startsWith(v1WouldClaim!)).toBe(false);
    const audit = auditLedger([overlay], ancestryRunner({}));
    expect(audit.findings.some((f) => f.code === "identity-mismatch")).toBe(false);
    expect(audit.ok).toBe(true);
  });

  it("does not error when a historical v2 row omits liveVerified", () => {
    const rows = [
      v2Row({ seq: 1, liveTo: "2026-08-28T00:00:00Z" }),
      v2Row({
        seq: 2,
        gatewaySha: "b".repeat(40),
        uiSha: "b".repeat(40),
        artifactDigest: DIGEST_B,
      }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ ["b".repeat(40)]: ["a".repeat(40)] }));
    expect(audit.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(audit.ok).toBe(true);
  });
});

describe("cutover:record", () => {
  const live = row({ seq: 1, liveFrom: "2026-08-27T04:11:44Z", liveTo: undefined });
  const header = "// Production release ledger.\n";

  function ledgerText(rows: ReleaseRow[]): string {
    return `${header}${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
  }

  it("closes the previous open row and appends a v2 row atomically", () => {
    const input = {
      gatewaySha: "b".repeat(40),
      uiSha: "b".repeat(40),
      buildMode: "full-dist" as const,
      artifactKind: "image" as const,
      artifactId: `rc-amd64-provenance-${"b".repeat(12)}`,
      artifactDigest: DIGEST_B,
      tag: "provenance/sha-" + "b".repeat(12),
      liveFrom: "2026-08-28T00:00:00Z",
      evidence: "container build-info",
      executor: "operator",
      liveVerified: true,
    };
    const prepared = prepareCutoverRecord(
      ledgerText([live]),
      input,
      ancestryRunner({ ["b".repeat(40)]: ["a".repeat(40)] }),
    );
    expect(prepared.ok).toBe(true);
    expect(prepared.seq).toBe(2);
    expect(prepared.closedSeq).toBe(1);
    const parsed = parseLedger(prepared.text ?? "");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]?.liveTo).toBe("2026-08-28T00:00:00Z");
    expect(isV2Row(parsed.rows[0])).toBe(false);
    expect(isV2Row(parsed.rows[1])).toBe(true);
    expect(parsed.rows[1]?.liveTo).toBeUndefined();
    expect(parsed.rows[1]?.artifactDigest).toBe(DIGEST_B);
    expect(prepared.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("refuses the write when two intervals are already open", () => {
    const dual = ledgerText([
      row({ seq: 1, liveFrom: "2026-08-27T00:00:00Z" }),
      row({ seq: 2, liveFrom: "2026-08-27T04:11:44Z" }),
    ]);
    const prepared = prepareCutoverRecord(
      dual,
      {
        gatewaySha: "b".repeat(40),
        uiSha: "b".repeat(40),
        buildMode: "full-dist",
        artifactKind: "image",
        artifactId: "rc-amd64-provenance-bbbb",
        artifactDigest: DIGEST_B,
        tag: "provenance/sha-bbbb",
        liveFrom: "2026-08-28T00:00:00Z",
        evidence: "container build-info",
        executor: "operator",
        liveVerified: true,
      },
      ancestryRunner({}),
    );
    expect(prepared.ok).toBe(false);
    expect(prepared.errors[0]).toContain("omit liveTo");
    expect(prepared.text).toBeUndefined();
  });

  it("writes to disk only after audit would pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-m0a-"));
    const path = join(dir, "releases.jsonl");
    writeFileSync(path, ledgerText([live]), "utf8");
    const result = writeCutoverRecord(
      path,
      {
        gatewaySha: "b".repeat(40),
        uiSha: "b".repeat(40),
        buildMode: "full-dist",
        artifactKind: "image",
        artifactId: `rc-amd64-provenance-${"b".repeat(12)}`,
        artifactDigest: DIGEST_B,
        tag: "provenance/sha-" + "b".repeat(12),
        liveFrom: "2026-08-28T00:00:00Z",
        evidence: "container build-info",
        executor: "operator",
        liveVerified: true,
      },
      ancestryRunner({ ["b".repeat(40)]: ["a".repeat(40)] }),
    );
    expect(result.ok).toBe(true);
    const onDisk = parseLedger(readFileSync(path, "utf8"));
    expect(onDisk.rows).toHaveLength(2);
    expect(onDisk.rows[0]?.liveTo).toBe("2026-08-28T00:00:00Z");
    expect(onDisk.rows[1]?.schemaVersion).toBe(2);
  });

  it("refuses a regression cutover without regressionAcknowledged", () => {
    const input = {
      gatewaySha: "c".repeat(40),
      uiSha: "c".repeat(40),
      buildMode: "full-dist" as const,
      artifactKind: "image" as const,
      artifactId: `rc-amd64-provenance-${"c".repeat(12)}`,
      artifactDigest: DIGEST_B,
      tag: "provenance/sha-" + "c".repeat(12),
      liveFrom: "2026-08-28T00:00:00Z",
      evidence: "container build-info",
      executor: "operator",
      liveVerified: true,
    };
    const refused = prepareCutoverRecord(
      ledgerText([live]),
      input,
      ancestryRunner({ ["c".repeat(40)]: [] }),
    );
    expect(refused.ok).toBe(false);
    expect(refused.errors.some((error) => error.includes("regression"))).toBe(true);
    expect(refused.text).toBeUndefined();
  });

  it("records an acknowledged regression cutover and closes the previous LIVE interval", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledger-m0a-revert-"));
    const path = join(dir, "releases.jsonl");
    writeFileSync(path, ledgerText([live]), "utf8");
    const reason = "approved rollback to last known-good";
    const result = writeCutoverRecord(
      path,
      {
        gatewaySha: "c".repeat(40),
        uiSha: "c".repeat(40),
        buildMode: "full-dist",
        artifactKind: "image",
        artifactId: `rc-amd64-provenance-${"c".repeat(12)}`,
        artifactDigest: DIGEST_B,
        tag: "provenance/sha-" + "c".repeat(12),
        liveFrom: "2026-08-28T00:00:00Z",
        evidence: "container build-info",
        executor: "operator",
        liveVerified: true,
        regressionAcknowledged: reason,
      },
      ancestryRunner({ ["c".repeat(40)]: [] }),
    );
    expect(result.ok).toBe(true);
    const onDisk = parseLedger(readFileSync(path, "utf8"));
    expect(onDisk.rows).toHaveLength(2);
    expect(onDisk.rows[0]?.liveTo).toBe("2026-08-28T00:00:00Z");
    expect(onDisk.rows[1]?.regressionAcknowledged).toBe(reason);
    expect(onDisk.rows[1]?.gatewaySha).toBe("c".repeat(40));
    expect(result.findings.some((f) => f.code === "regression" && f.severity === "warning")).toBe(
      true,
    );
  });

  it("maps --intentional-revert onto regressionAcknowledged", () => {
    const parsed = parseCutoverArgs([
      "--gateway-sha",
      "c".repeat(40),
      "--intentional-revert",
      "approved rollback",
    ]);
    expect(parsed.regressionAcknowledged).toBe("approved rollback");
    expect(parsed.gatewaySha).toBe("c".repeat(40));
  });

  it("serializes v2 overlay fields including base image identity", () => {
    const serialized = serializeV2Row(
      v2Row({
        seq: 45,
        artifactKind: "dist-overlay",
        baseImageTag: "rc-amd64-provenance-5c221b9ec3",
        baseImageDigest: DIGEST_A,
        artifactDigest: DIGEST_B,
      }),
    );
    const parsed = JSON.parse(serialized) as ReleaseRow;
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.baseImageTag).toBe("rc-amd64-provenance-5c221b9ec3");
    expect(parsed.imageTag).toBeDefined();
  });

  it("refuses a write without liveVerified or unverifiedBackfill", () => {
    const input = {
      gatewaySha: "b".repeat(40),
      uiSha: "b".repeat(40),
      buildMode: "full-dist" as const,
      artifactKind: "image" as const,
      artifactId: `rc-amd64-provenance-${"b".repeat(12)}`,
      artifactDigest: DIGEST_B,
      tag: "provenance/sha-" + "b".repeat(12),
      liveFrom: "2026-08-28T00:00:00Z",
      evidence: "container build-info",
      executor: "operator",
    };
    const prepared = prepareCutoverRecord(
      ledgerText([live]),
      input,
      ancestryRunner({ ["b".repeat(40)]: ["a".repeat(40)] }),
    );
    expect(prepared.ok).toBe(false);
    expect(prepared.errors.some((error) => error.includes("--live-verified"))).toBe(true);
    expect(prepared.text).toBeUndefined();
  });

  it("accepts liveVerified true and writes liveVerified true on the new row", () => {
    const prepared = prepareCutoverRecord(
      ledgerText([live]),
      {
        gatewaySha: "b".repeat(40),
        uiSha: "b".repeat(40),
        buildMode: "full-dist",
        artifactKind: "image",
        artifactId: `rc-amd64-provenance-${"b".repeat(12)}`,
        artifactDigest: DIGEST_B,
        tag: "provenance/sha-" + "b".repeat(12),
        liveFrom: "2026-08-28T00:00:00Z",
        evidence: "container build-info",
        executor: "operator",
        liveVerified: true,
      },
      ancestryRunner({ ["b".repeat(40)]: ["a".repeat(40)] }),
    );
    expect(prepared.ok).toBe(true);
    const parsed = parseLedger(prepared.text ?? "");
    expect(parsed.rows[1]?.liveVerified).toBe(true);
    expect(serializeV2Row(parsed.rows[1])).toContain('"liveVerified":true');
  });

  it("accepts unverifiedBackfill reason and records liveVerified false with the reason in notes", () => {
    const reason = "seq 45 container NOT independently verified";
    const prepared = prepareCutoverRecord(
      ledgerText([live]),
      {
        gatewaySha: "b".repeat(40),
        uiSha: "b".repeat(40),
        buildMode: "full-dist",
        artifactKind: "image",
        artifactId: `rc-amd64-provenance-${"b".repeat(12)}`,
        artifactDigest: DIGEST_B,
        tag: "provenance/sha-" + "b".repeat(12),
        liveFrom: "2026-08-28T00:00:00Z",
        evidence: "container build-info",
        executor: "operator",
        notes: "existing note",
        unverifiedBackfill: reason,
      },
      ancestryRunner({ ["b".repeat(40)]: ["a".repeat(40)] }),
    );
    expect(prepared.ok).toBe(true);
    const parsed = parseLedger(prepared.text ?? "");
    expect(parsed.rows[1]?.liveVerified).toBe(false);
    expect(parsed.rows[1]?.notes).toContain("existing note");
    expect(parsed.rows[1]?.notes).toContain(reason);
    expect(serializeV2Row(parsed.rows[1])).toContain('"liveVerified":false');
  });

  it("maps --live-verified and --unverified-backfill", () => {
    const verified = parseCutoverArgs(["--live-verified"]);
    expect(verified.liveVerified).toBe(true);
    const escaped = parseCutoverArgs(["--unverified-backfill", "seq 45 operator note"]);
    expect(escaped.unverifiedBackfill).toBe("seq 45 operator note");
    expect(escaped.liveVerified).toBeUndefined();
  });

  it("refuses --live-verified and --unverified-backfill together", () => {
    expect(() => parseCutoverArgs(["--live-verified", "--unverified-backfill", "reason"])).toThrow(
      /mutually exclusive/,
    );
  });
});

describe("repaired ledger warning profile", () => {
  it("audits 0 errors while keeping overlay-debt, acknowledged regression, and seq1 missing-tag", () => {
    const sha1 = "1".repeat(40);
    const sha2 = "2".repeat(40);
    const sha3 = "3".repeat(40);
    const fixture = [
      row({
        seq: 1,
        gatewaySha: sha1,
        uiSha: sha1,
        imageTag: "rc-amd64-provenance-" + sha1.slice(0, 12),
        tag: undefined,
        liveFrom: "2026-07-27T02:24:50Z",
        liveTo: "2026-07-27T03:58:19Z",
      }),
      row({
        seq: 2,
        gatewaySha: sha2,
        uiSha: sha2,
        imageTag: "rc-amd64-provenance-" + sha2.slice(0, 12),
        liveFrom: "2026-07-27T03:58:19Z",
        liveTo: "2026-07-27T04:23:13Z",
      }),
      row({
        seq: 3,
        gatewaySha: sha1,
        uiSha: sha3,
        imageTag: "rc-amd64-provenance-" + sha3.slice(0, 12),
        liveFrom: "2026-07-27T04:23:13Z",
        regressionAcknowledged: "historical incident recorded on purpose",
      }),
    ];
    const audit = auditLedger(
      fixture,
      ancestryRunner({
        [sha2]: [sha1],
        [sha3]: [],
        [sha1]: [],
      }),
    );
    expect(audit.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(audit.ok).toBe(true);
    expect(audit.findings.some((f) => f.seq === 1 && f.code === "missing-tag")).toBe(true);
    expect(audit.findings.some((f) => f.code === "overlay-debt")).toBe(true);
    expect(audit.findings.some((f) => f.code === "regression" && f.severity === "warning")).toBe(
      true,
    );
    expect(audit.findings.some((f) => f.code === "open-interval")).toBe(false);
  });

  it("production releases.jsonl Path B SoT reaches seq144 tip 9a8e91d19e89", () => {
    const text = readFileSync("deploy/production/releases.jsonl", "utf8");
    const { rows, errors } = parseLedger(text);
    expect(errors).toEqual([]);
    const git: GitRunner = (args) => {
      const result = spawnSync("git", args, { encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout ?? "" };
    };
    const audit = auditLedger(rows, git);
    // Path B SoT structure (history rewrite means many gatewaySha values are no longer
    // in this GitHub repo, so ancestry regression ERRORs are expected delivery debt).
    expect(rows.length).toBeGreaterThanOrEqual(142);
    expect(Math.max(...rows.map((r) => r.seq))).toBe(144);
    // Historical debt: seq 127 never received liveTo. Tip seq 144 is the Path B LIVE open row.
    // Dual-open remains an audit error until seq 127 is closed with an authentic stop time.
    expect(rows.filter((r) => r.liveTo === undefined).map((r) => r.seq)).toEqual([127, 144]);
    expect(audit.findings.some((f) => f.code === "open-interval")).toBe(true);
    expect(audit.findings.some((f) => f.seq === 1 && f.code === "missing-tag")).toBe(true);
    expect(audit.findings.some((f) => f.code === "overlay-debt")).toBe(true);
    // seq 99-102 were backfilled from host metadata; their real stop times keep the
    // 2026-09-28 holes visible instead of being papered over.
    expect(rows.find((r) => r.seq === 98)?.liveTo).toBe("2026-09-26T15:39:59.221Z");
    expect(rows.find((r) => r.seq === 99)?.liveTo).toBe("2026-09-28T04:15:35.109Z");
    expect(rows.find((r) => r.seq === 99)?.liveVerified).toBe(false);
    expect(rows.find((r) => r.seq === 103)?.liveTo).toBe("2026-09-29T14:21:24.723Z");
    expect(rows.find((r) => r.seq === 103)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 104)?.liveTo).toBe("2026-09-29T14:25:30.609Z");
    expect(rows.find((r) => r.seq === 105)?.liveTo).toBe("2026-09-30T02:34:08.329Z");
    expect(rows.find((r) => r.seq === 105)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 106)?.liveTo).toBe("2026-09-30T07:30:37.254Z");
    expect(rows.find((r) => r.seq === 106)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 107)?.liveTo).toBe("2026-10-01T06:37:00.000Z");
    expect(rows.find((r) => r.seq === 107)?.liveVerified).toBe(true);
    // seq 108-109 closed when the next recorded LIVE started. seq 110/111 are an
    // allowed sequence gap. seq 109 liveTo is seq 112 liveFrom (no stronger stop time).
    // seq 112 closed at seq 113 liveFrom. The cutover writer stores that instant
    // without a millisecond suffix (same instant as 2026-10-10T10:30:46.000Z).
    // seq 113 closed at seq 114 liveFrom, also without a millisecond suffix.
    // seq 114 closed at seq 115 liveFrom (HK HOME=/root + --user 0 recreate).
    // seq 115 closed at seq 116 liveFrom (HK Path B tip 3a001aac).
    // seq 116 closed at seq 117 liveFrom (HK Path B tip eff6f8f0).
    // seq 117 closed at seq 118 liveFrom (HK Path B tip 0b9c480f ≥7d594803).
    // seq 118 closed at seq 119 liveFrom (HK Path B tip a958c7ee #608).
    // seq 119 closed at seq 120 liveFrom (HK Path B tip 0411972c #612+#613).
    // seq 120 closed at seq 121 liveFrom (HK Path B tip 13ff093d #618+#619).
    // seq 121 closed at seq 122 liveFrom (HK Path B tip 8680c6b45).
    // seq 122 closed at seq 123 liveFrom (HK Path B tip 872bea69 #632).
    // seq 123 closed at seq 124 liveFrom (HK Path B tip 961afe6f #642+#644).
    // seq 124 closed at seq 125 liveFrom (HK Path B tip da30646b #649+#650+#651).
    expect(rows.find((r) => r.seq === 108)?.liveTo).toBe("2026-10-01T15:20:34.024Z");
    expect(rows.find((r) => r.seq === 108)?.liveVerified).toBe(false);
    expect(rows.find((r) => r.seq === 109)?.liveTo).toBe("2026-10-03T15:45:00.000Z");
    expect(rows.find((r) => r.seq === 109)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 112)?.liveFrom).toBe("2026-10-03T15:45:00.000Z");
    expect(rows.find((r) => r.seq === 112)?.liveTo).toBe("2026-10-10T10:30:46Z");
    expect(rows.find((r) => r.seq === 112)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 113)?.liveFrom).toBe("2026-10-10T10:30:46Z");
    expect(rows.find((r) => r.seq === 113)?.liveTo).toBe("2026-10-10T12:50:10Z");
    expect(rows.find((r) => r.seq === 113)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 114)?.liveFrom).toBe("2026-10-10T12:50:10Z");
    expect(rows.find((r) => r.seq === 114)?.liveTo).toBe("2026-10-10T22:36:52Z");
    expect(rows.find((r) => r.seq === 114)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 115)?.liveFrom).toBe("2026-10-10T22:36:52Z");
    expect(rows.find((r) => r.seq === 115)?.liveTo).toBe("2026-10-11T01:12:20Z");
    expect(rows.find((r) => r.seq === 115)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 116)?.liveFrom).toBe("2026-10-11T01:12:20Z");
    expect(rows.find((r) => r.seq === 116)?.liveTo).toBe("2026-10-11T06:04:08Z");
    expect(rows.find((r) => r.seq === 116)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 117)?.liveFrom).toBe("2026-10-11T06:04:08Z");
    expect(rows.find((r) => r.seq === 117)?.liveTo).toBe("2026-10-11T06:27:52Z");
    expect(rows.find((r) => r.seq === 117)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 118)?.liveFrom).toBe("2026-10-11T06:27:52Z");
    expect(rows.find((r) => r.seq === 118)?.liveTo).toBe("2026-10-11T07:39:46Z");
    expect(rows.find((r) => r.seq === 118)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 119)?.liveFrom).toBe("2026-10-11T07:39:46Z");
    expect(rows.find((r) => r.seq === 119)?.liveTo).toBe("2026-10-11T10:34:20Z");
    expect(rows.find((r) => r.seq === 119)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 120)?.liveFrom).toBe("2026-10-11T10:34:20Z");
    expect(rows.find((r) => r.seq === 120)?.liveTo).toBe("2026-10-11T12:39:48Z");
    expect(rows.find((r) => r.seq === 120)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 121)?.liveFrom).toBe("2026-10-11T12:39:48Z");
    expect(rows.find((r) => r.seq === 121)?.liveTo).toBe("2026-10-11T14:21:17Z");
    expect(rows.find((r) => r.seq === 121)?.liveVerified).toBe(true);
    // seq 122 closed at seq 123 liveFrom (HK Path B tip 872bea69 #632).
    expect(rows.find((r) => r.seq === 122)?.liveFrom).toBe("2026-10-11T14:21:17Z");
    expect(rows.find((r) => r.seq === 122)?.liveTo).toBe("2026-10-12T00:53:24Z");
    expect(rows.find((r) => r.seq === 122)?.liveVerified).toBe(true);
    // seq 123 closed at seq 124 liveFrom (HK Path B tip 961afe6f #642+#644).
    expect(rows.find((r) => r.seq === 123)?.liveFrom).toBe("2026-10-12T00:53:24Z");
    expect(rows.find((r) => r.seq === 123)?.liveTo).toBe("2026-10-12T03:40:00Z");
    expect(rows.find((r) => r.seq === 123)?.liveVerified).toBe(true);
    // seq 124 closed at seq 125 liveFrom (HK Path B tip da30646b #649+#650+#651).
    expect(rows.find((r) => r.seq === 124)?.liveFrom).toBe("2026-10-12T03:40:00Z");
    expect(rows.find((r) => r.seq === 124)?.liveTo).toBe("2026-10-12T06:57:30Z");
    expect(rows.find((r) => r.seq === 124)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 124)?.gatewaySha).toBe(
      "961afe6fbe9611b81ac02d597a291096f08f2234",
    );
    expect(rows.find((r) => r.seq === 124)?.artifactDigest).toBe(
      "sha256:bb4aeec3aa4d646a54be75437021ee6c89295596bb30df354561c73a0720d58a",
    );
    expect(rows.find((r) => r.seq === 125)?.liveFrom).toBe("2026-10-12T06:57:30Z");
    expect(rows.find((r) => r.seq === 125)?.liveTo).toBeDefined();
    expect(rows.find((r) => r.seq === 125)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 125)?.gatewaySha).toBe(
      "da30646bff58d2faee008b5e06907762b2a16fe0",
    );
    expect(rows.find((r) => r.seq === 125)?.artifactDigest).toBe(
      "sha256:9125dc6bae39836c4e591e3d024fb71b48cb09269d907bfd1650eb5cd7b30ac3",
    );
    // seq 143 closed at seq 144 liveFrom when Path B SoT was restored with the OHBE/PR19 seed.
    expect(rows.find((r) => r.seq === 143)?.liveTo).toBe("2026-10-20T09:21:32Z");
    expect(rows.find((r) => r.seq === 144)?.liveFrom).toBe("2026-10-20T09:21:32Z");
    expect(rows.find((r) => r.seq === 144)?.liveTo).toBeUndefined();
    expect(rows.find((r) => r.seq === 144)?.gatewaySha).toBe(
      "9a8e91d19e893fc5d963103538cdbd35f315ac30",
    );
    expect(rows.find((r) => r.seq === 144)?.artifactDigest).toBe(
      "sha256:8fd6d63213f53ce22d59f4ce6c9c7d11a52c4db708c74eb3aa7348f4a2dfd193",
    );
    expect(audit.findings.some((f) => f.code === "open-interval")).toBe(true);
    expect(rows.filter((r) => r.seq >= 99 && r.seq <= 103).map((r) => r.executor)).toEqual(
      Array(5).fill("cursor"),
    );
    expect(audit.findings.some((f) => f.seq === 100 && f.code === "timeline-gap")).toBe(true);
    expect(rows.find((r) => r.seq === 95)?.liveTo).toBe("2026-09-22T07:12:37.955Z");
    expect(rows.find((r) => r.seq === 96)?.liveTo).toBe("2026-09-22T23:37:05.235Z");
    expect(rows.find((r) => r.seq === 97)?.liveTo).toBe("2026-09-24T02:49:48.208Z");
    expect(rows.find((r) => r.seq === 98)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 97)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 96)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 94)?.liveTo).toBe("2026-09-19T12:41:27Z");
    expect(rows.find((r) => r.seq === 95)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 93)?.liveTo).toBe("2026-09-18T15:49:14Z");
    expect(rows.find((r) => r.seq === 94)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 92)?.liveTo).toBe("2026-09-18T13:53:32Z");
    expect(rows.find((r) => r.seq === 93)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 91)?.liveTo).toBe("2026-09-18T11:07:28Z");
    expect(rows.find((r) => r.seq === 92)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 90)?.liveTo).toBe("2026-09-18T10:20:02Z");
    expect(rows.find((r) => r.seq === 89)?.liveTo).toBe("2026-09-17T14:01:31Z");
    expect(rows.find((r) => r.seq === 88)?.liveTo).toBe("2026-09-16T07:33:48Z");
    expect(rows.find((r) => r.seq === 87)?.liveTo).toBe("2026-09-15T12:51:27Z");
    expect(rows.find((r) => r.seq === 86)?.liveTo).toBe("2026-09-14T14:14:20Z");
    expect(rows.find((r) => r.seq === 85)?.liveTo).toBe("2026-09-13T14:19:40Z");
    expect(rows.find((r) => r.seq === 84)?.liveTo).toBe("2026-09-13T02:03:42Z");
    expect(rows.find((r) => r.seq === 64)?.liveTo).toBe("2026-09-07T13:55:51Z");
    expect(rows.find((r) => r.seq === 65)?.liveTo).toBe("2026-09-07T14:29:34Z");
    expect(rows.find((r) => r.seq === 66)?.liveTo).toBe("2026-09-07T16:04:59Z");
    expect(rows.find((r) => r.seq === 67)?.liveTo).toBe("2026-09-07T23:12:12Z");
    expect(rows.find((r) => r.seq === 68)?.liveTo).toBe("2026-09-08T03:29:15Z");
    expect(rows.find((r) => r.seq === 69)?.liveTo).toBe("2026-09-08T15:24:22Z");
    expect(rows.find((r) => r.seq === 70)?.liveTo).toBe("2026-09-09T03:34:54Z");
    expect(rows.find((r) => r.seq === 71)?.liveTo).toBe("2026-09-09T13:05:01Z");
    expect(rows.find((r) => r.seq === 72)?.liveTo).toBe("2026-09-10T03:10:13Z");
    expect(rows.find((r) => r.seq === 73)?.liveTo).toBe("2026-09-10T05:42:25Z");
    expect(rows.find((r) => r.seq === 74)?.liveTo).toBe("2026-09-10T22:43:40Z");
    expect(rows.find((r) => r.seq === 75)?.liveTo).toBe("2026-09-11T03:22:25Z");
    expect(rows.find((r) => r.seq === 76)?.liveTo).toBe("2026-09-11T05:40:39Z");
    expect(rows.find((r) => r.seq === 77)?.liveTo).toBe("2026-09-11T10:24:34Z");
    expect(rows.find((r) => r.seq === 78)?.liveTo).toBe("2026-09-11T12:32:07Z");
    expect(rows.find((r) => r.seq === 79)?.liveTo).toBe("2026-09-11T14:11:51Z");
    expect(rows.find((r) => r.seq === 80)?.liveTo).toBe("2026-09-11T17:29:04Z");
    expect(rows.find((r) => r.seq === 81)?.liveTo).toBe("2026-09-11T22:12:23Z");
    expect(rows.find((r) => r.seq === 65)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 66)?.liveVerified).toBe(false);
    expect(rows.find((r) => r.seq === 67)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 68)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 69)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 70)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 71)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 72)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 73)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 74)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 75)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 76)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 77)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 78)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 79)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 80)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 81)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 82)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 47)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 48)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 49)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 50)?.liveVerified).toBe(true);
    expect(rows.find((r) => r.seq === 51)?.liveVerified).toBe(true);
    expect(audit.findings.some((f) => f.code === "unverified-live")).toBe(false);
  });
});

describe("alignment gate fail-closed", () => {
  it("verify-delivery-alignment.sh exits 2 when PROD_SHA/CANDIDATE_SHA are missing", () => {
    const result = spawnSync("bash", ["deploy/production/scripts/verify-delivery-alignment.sh"], {
      encoding: "utf8",
      env: { ...process.env, PROD_SHA: "", CANDIDATE_SHA: "", CANDIDATE_TAG: "" },
    });
    expect(result.status).toBe(2);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "PROD_SHA and CANDIDATE_SHA are required",
    );
  });

  it("cutover-from-ghcr.sh records via delivery:cutover:record instead of appending v1 JSONL", () => {
    const src = readFileSync("deploy/production/scripts/cutover-from-ghcr.sh", "utf8");
    expect(src).toContain("pnpm delivery:cutover:record");
    expect(src).not.toMatch(/printf '%s\\n' "\$row" >>/);
    expect(src).not.toContain('"schemaVersion":1');
    expect(src).toContain("${revert_args[@]}");
    expect(src).toContain("--intentional-revert");
    expect(src).toContain("--live-verified");
  });

  it("verify-delivery-alignment.sh normalizes CANDIDATE_SHA before comparisons", () => {
    const src = readFileSync("deploy/production/scripts/verify-delivery-alignment.sh", "utf8");
    expect(src).toContain("git rev-parse --verify");
    expect(src).toContain("$CANDIDATE_SHA^{commit}");
  });
});
