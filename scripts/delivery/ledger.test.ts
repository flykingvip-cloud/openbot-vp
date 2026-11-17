import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

type AncestryStubOptions = {
  /** SHAs that `cat-file -t` should treat as missing. */
  missing?: string[];
  /** When true, `rev-parse --is-shallow-repository` → true. */
  shallow?: boolean;
  /** tip → declared parents that are missing as objects (incomplete graph). */
  missingParents?: Record<string, string[]>;
  /** tip → declared parents that exist (defaults to root / no parents). */
  parents?: Record<string, string[]>;
};

/** Ancestry stub: `contains[child]` lists every commit reachable from `child`. */
function ancestryRunner(
  contains: Record<string, string[]>,
  options: AncestryStubOptions = {},
): GitRunner {
  const known = new Set<string>();
  for (const [child, ancestors] of Object.entries(contains)) {
    known.add(child);
    for (const a of ancestors) {
      known.add(a);
    }
  }
  for (const parents of Object.values(options.parents ?? {})) {
    for (const p of parents) {
      known.add(p);
    }
  }
  const missing = new Set(options.missing ?? []);

  return (args) => {
    if (args[0] === "cat-file" && args[1] === "-t") {
      const sha = args[2] ?? "";
      if (missing.has(sha)) {
        return { code: 128, stdout: "", stderr: "fatal: Not a valid object name" };
      }
      if (known.has(sha)) {
        return { code: 0, stdout: "commit\n" };
      }
      // Unknown short SHAs used only as "dropped" priors in regression fixtures still need
      // to exist so classification reaches the regression branch (complete graph).
      if (sha.length > 0 && !missing.has(sha)) {
        known.add(sha);
        return { code: 0, stdout: "commit\n" };
      }
      return { code: 128, stdout: "", stderr: "fatal: Not a valid object name" };
    }

    if (args[0] === "rev-parse" && args[1] === "--is-shallow-repository") {
      return { code: 0, stdout: options.shallow ? "true\n" : "false\n" };
    }

    if (args[0] === "rev-list" && args[1] === "--parents" && args[2] === "-n" && args[3] === "1") {
      const sha = args[4] ?? "";
      if (missing.has(sha) || !sha) {
        return { code: 128, stdout: "", stderr: "fatal" };
      }
      const declaredMissing = options.missingParents?.[sha] ?? [];
      const presentParents = options.parents?.[sha] ?? [];
      const line = [sha, ...presentParents, ...declaredMissing].join(" ");
      return { code: 0, stdout: `${line}\n` };
    }

    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      const [, , parent, child] = args;
      if (missing.has(parent ?? "") || missing.has(child ?? "")) {
        return { code: 128, stdout: "", stderr: "fatal: Not a valid object name" };
      }
      const reachable = contains[child ?? ""] ?? [];
      const ok = parent === child || reachable.includes(parent ?? "");
      return { code: ok ? 0 : 1, stdout: "" };
    }

    if (args[0] === "merge-base") {
      const a = args[1] ?? "";
      const b = args[2] ?? "";
      if (options.shallow) {
        return { code: 1, stdout: "" };
      }
      const reachableB = contains[b] ?? [];
      if (a === b || reachableB.includes(a) || (contains[a] ?? []).includes(b)) {
        return { code: 0, stdout: `${a}\n` };
      }
      return { code: 1, stdout: "" };
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

  it("flags missing tip objects as missing-object, not regression", () => {
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
    const audit = auditLedger(rows, ancestryRunner({ c2: ["c1"] }, { missing: ["c1"] }));
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "missing-object")).toBe(true);
    expect(audit.findings.some((f) => f.code === "regression")).toBe(false);
  });

  it("flags shallow graphs as incomplete-graph even when merge-base would succeed", () => {
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
    // ancestors empty → not forward; stub merge-base still returns a base when not shallow,
    // but shallow must stay incomplete regardless.
    const audit = auditLedger(
      rows,
      ancestryRunner({ c9: [] }, { shallow: true, parents: { c9: ["c0"], c1: ["c0"] } }),
    );
    expect(audit.ok).toBe(false);
    const finding = audit.findings.find((f) => f.code === "incomplete-graph");
    expect(finding).toBeDefined();
    expect(finding?.message).toMatch(/shallow|truncation|current object graph/i);
    expect(audit.findings.some((f) => f.code === "regression")).toBe(false);
  });

  it("flags missing immediate parents as incomplete-graph", () => {
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
    const audit = auditLedger(
      rows,
      ancestryRunner(
        { c9: [] },
        { missingParents: { c1: ["deadparent01"] }, missing: ["deadparent01"] },
      ),
    );
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "incomplete-graph")).toBe(true);
    expect(audit.findings.some((f) => f.code === "regression")).toBe(false);
  });

  it("aggregates gateway/UI candidates so missing-object outranks an earlier regression", () => {
    const rows = [
      row({
        seq: 1,
        gatewaySha: "prior1",
        uiSha: "prior1",
        imageTag: "rc-amd64-provenance-prior1",
        liveTo: "2026-07-27T01:00:00Z",
      }),
      row({
        seq: 2,
        gatewaySha: "gw",
        uiSha: "ui",
        imageTag: "rc-amd64-provenance-ui",
      }),
    ];
    // gw: complete non-ancestor → would be regression; ui: missing tip → missing-object.
    // First candidate is gw; aggregation must still surface the unknown.
    const audit = auditLedger(
      rows,
      ancestryRunner({ gw: [], ui: ["prior1"] }, { missing: ["ui"] }),
    );
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "missing-object")).toBe(true);
    expect(audit.findings.some((f) => f.code === "regression")).toBe(false);
  });

  it("aggregates incomplete-graph over regression across overlay candidates", () => {
    const rows = [
      row({
        seq: 1,
        gatewaySha: "prior1",
        uiSha: "prior1",
        imageTag: "rc-amd64-provenance-prior1",
        liveTo: "2026-07-27T01:00:00Z",
      }),
      row({
        seq: 2,
        gatewaySha: "gw",
        uiSha: "ui",
        imageTag: "rc-amd64-provenance-ui",
      }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ gw: [], ui: [] }, { shallow: true }));
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "incomplete-graph")).toBe(true);
    expect(audit.findings.some((f) => f.code === "regression")).toBe(false);
  });

  it("real git fixture keeps unknown as ERROR (exit-30 posture)", () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-ledger-classify-real-"));
    const run = (cwd: string, args: string[]) => {
      const result = spawnSync("git", args, { cwd, encoding: "utf8" });
      if ((result.status ?? 1) !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
      }
    };
    run(root, ["init", "-b", "main"]);
    run(root, ["config", "user.email", "test@example.com"]);
    run(root, ["config", "user.name", "test"]);
    writeFileSync(join(root, "a.txt"), "a\n");
    run(root, ["add", "a.txt"]);
    run(root, ["commit", "-m", "root"]);
    run(root, ["checkout", "-b", "side"]);
    writeFileSync(join(root, "b.txt"), "b\n");
    run(root, ["add", "b.txt"]);
    run(root, ["commit", "-m", "side"]);
    const side = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
    run(root, ["checkout", "main"]);
    writeFileSync(join(root, "c.txt"), "c\n");
    run(root, ["add", "c.txt"]);
    run(root, ["commit", "-m", "mainline"]);
    const main = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();

    const shallow = mkdtempSync(join(tmpdir(), "openbot-ledger-classify-shallow-"));
    const clone = spawnSync("git", ["clone", "--depth=1", root, shallow], { encoding: "utf8" });
    expect(clone.status).toBe(0);
    const fetch = spawnSync("git", ["fetch", "--depth=1", "origin", side], {
      cwd: shallow,
      encoding: "utf8",
    });
    expect(fetch.status).toBe(0);

    const git: GitRunner = (args) => {
      const result = spawnSync("git", args, { cwd: shallow, encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    };

    const rows = [
      row({
        seq: 1,
        gatewaySha: side,
        uiSha: side,
        imageTag: "rc-amd64-provenance-" + side.slice(0, 12),
        liveTo: "2026-07-27T01:00:00Z",
      }),
      row({
        seq: 2,
        gatewaySha: main,
        uiSha: main,
        imageTag: "rc-amd64-provenance-" + main.slice(0, 12),
      }),
    ];
    const audit = auditLedger(rows, git);
    expect(audit.ok).toBe(false);
    expect(
      audit.findings.some((f) => f.code === "incomplete-graph" && f.severity === "error"),
    ).toBe(true);
    expect(audit.findings.some((f) => f.code === "regression")).toBe(false);
    rmSync(root, { recursive: true, force: true });
    rmSync(shallow, { recursive: true, force: true });
  });

  it("does not let regressionAcknowledged clear missing-object or incomplete-graph", () => {
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
        gatewaySha: "c2",
        uiSha: "c2",
        imageTag: "rc-amd64-provenance-c2",
        regressionAcknowledged: "should not clear missing-object",
      }),
    ];
    const audit = auditLedger(rows, ancestryRunner({ c2: ["c1"] }, { missing: ["c1"] }));
    expect(audit.ok).toBe(false);
    const finding = audit.findings.find((f) => f.code === "missing-object");
    expect(finding?.severity).toBe("error");
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

  it("production releases.jsonl has a unique open tip with successor-closed predecessors", () => {
    const text = readFileSync("deploy/production/releases.jsonl", "utf8");
    const { rows, errors } = parseLedger(text);
    expect(errors).toEqual([]);
    const git: GitRunner = (args) => {
      const result = spawnSync("git", args, { encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout ?? "" };
    };
    const audit = auditLedger(rows, git);

    // Structural invariants. Do not pin Math.max(seq) to a frozen tip number.
    // The seq 151 equality was a snapshot of the then-current tip after #172 / #176,
    // not a permanent SoT ceiling. Later LIVE rows (seq 152 in #194 through seq 165
    // in #267) landed without updating that snapshot, which is why the old pin went stale.
    const seqs = rows.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(rows.length).toBeGreaterThanOrEqual(142);
    const maxSeq = Math.max(...seqs);
    const minSeq = Math.min(...seqs);
    const documentedGaps = new Set([110, 111]);
    const unexpectedGaps: number[] = [];
    for (let seq = minSeq; seq <= maxSeq; seq++) {
      if (!seqs.includes(seq) && !documentedGaps.has(seq)) {
        unexpectedGaps.push(seq);
      }
    }
    expect(unexpectedGaps).toEqual([]);

    const open = rows.filter((r) => r.liveTo === undefined);
    expect(open.map((r) => r.seq)).toEqual([maxSeq]);
    expect(audit.findings.some((f) => f.code === "open-interval")).toBe(false);

    // Successor-close: after the documented 2026-09-28 holes (seq 99-102) and the
    // allowed 110/111 gap, each predecessor liveTo equals the next row's liveFrom.
    // This is the interval invariant #172 restored for seq 127, not a tip-number pin.
    const bySeq = new Map(rows.map((r) => [r.seq, r]));
    const successorCloseFrom = 103;
    for (const seq of [...bySeq.keys()].toSorted((a, b) => a - b)) {
      if (seq < successorCloseFrom) {
        continue;
      }
      const next = bySeq.get(seq + 1);
      if (!next) {
        continue;
      }
      expect(bySeq.get(seq)?.liveTo).toBe(next.liveFrom);
    }

    expect(audit.findings.some((f) => f.seq === 1 && f.code === "missing-tag")).toBe(true);
    expect(audit.findings.some((f) => f.code === "overlay-debt")).toBe(true);
    expect(audit.findings.some((f) => f.code === "unverified-live")).toBe(false);
    // Historical missing objects remain delivery-guard errors. This test must not
    // require audit.ok, and must not weaken pnpm delivery:ledger:audit.
  });

  it("production releases.jsonl preserves documented historical intervals through seq 151", () => {
    const text = readFileSync("deploy/production/releases.jsonl", "utf8");
    const { rows, errors } = parseLedger(text);
    expect(errors).toEqual([]);
    const git: GitRunner = (args) => {
      const result = spawnSync("git", args, { encoding: "utf8" });
      return { code: result.status ?? 1, stdout: result.stdout ?? "" };
    };
    const audit = auditLedger(rows, git);
    // Historical fixtures for the #172 / #176 era. Seq 151 is no longer the open tip
    // (closed by seq 152 in #194) but its identity and the seq 127 successor-StartedAt
    // close must remain intact. Path B SoT structure still carries missing-object
    // delivery debt for rewritten history; that is asserted by delivery:ledger:audit,
    // not by freezing the tip seq.
    expect(rows.length).toBeGreaterThanOrEqual(142);
    // #172 closed seq 127 liveTo with successor-StartedAt attestation
    // (host FinishedAt unrecoverable). liveTo equals seq 128 liveFrom.
    expect(rows.find((r) => r.seq === 127)?.liveTo).toBe("2026-10-14T16:31:38Z");
    expect(rows.find((r) => r.seq === 128)?.liveFrom).toBe("2026-10-14T16:31:38Z");
    expect(rows.find((r) => r.seq === 127)?.liveVerified).toBe(true);
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
    // seq 144 closed at seq 145 liveFrom (HK Path B tip 065840dfba12 #79).
    expect(rows.find((r) => r.seq === 143)?.liveTo).toBe("2026-10-20T09:21:32Z");
    expect(rows.find((r) => r.seq === 144)?.liveFrom).toBe("2026-10-20T09:21:32Z");
    expect(rows.find((r) => r.seq === 144)?.liveTo).toBe("2026-10-25T10:45:47.391Z");
    expect(rows.find((r) => r.seq === 144)?.gatewaySha).toBe(
      "9a8e91d19e893fc5d963103538cdbd35f315ac30",
    );
    expect(rows.find((r) => r.seq === 144)?.artifactDigest).toBe(
      "sha256:8fd6d63213f53ce22d59f4ce6c9c7d11a52c4db708c74eb3aa7348f4a2dfd193",
    );
    expect(rows.find((r) => r.seq === 145)?.liveFrom).toBe("2026-10-25T10:45:47.391Z");
    expect(rows.find((r) => r.seq === 145)?.liveTo).toBe("2026-10-29T14:14:38.692Z");
    expect(rows.find((r) => r.seq === 145)?.gatewaySha).toBe(
      "065840dfba129475c9c9030c80af07970dcdd084",
    );
    expect(rows.find((r) => r.seq === 145)?.artifactDigest).toBe(
      "sha256:ef333624c09bb2e5e43158871e768f74a046a472fcda63bdf68eb79a1a637918",
    );
    expect(rows.find((r) => r.seq === 146)?.liveFrom).toBe("2026-10-29T14:14:38.692Z");
    expect(rows.find((r) => r.seq === 146)?.liveTo).toBe("2026-10-30T03:41:25.843Z");
    expect(rows.find((r) => r.seq === 146)?.gatewaySha).toBe(
      "0a6daead74ab08f85edfe5e61b18eb49289c43cc",
    );
    expect(rows.find((r) => r.seq === 146)?.artifactDigest).toBe(
      "sha256:5a5f92aab93a7b61118f53667b9b9c3f0bd442786fa674fd64807f6fc7002869",
    );
    expect(rows.find((r) => r.seq === 147)?.liveFrom).toBe("2026-10-30T03:41:25.843Z");
    expect(rows.find((r) => r.seq === 147)?.liveTo).toBe("2026-10-30T06:59:55.083Z");
    expect(rows.find((r) => r.seq === 147)?.gatewaySha).toBe(
      "d632f4627a158e079dc21810fdb15e17ac440119",
    );
    expect(rows.find((r) => r.seq === 147)?.artifactDigest).toBe(
      "sha256:951a99b1209c22cf30598e3f0ed9b34b698d1b969157110c717beaf09c9cc981",
    );
    expect(rows.find((r) => r.seq === 148)?.liveFrom).toBe("2026-10-30T06:59:55.083Z");
    expect(rows.find((r) => r.seq === 148)?.liveTo).toBe("2026-10-30T13:57:38.488Z");
    expect(rows.find((r) => r.seq === 148)?.gatewaySha).toBe(
      "3a391742f2603bc80d42ad3d4258e047224da352",
    );
    expect(rows.find((r) => r.seq === 148)?.artifactDigest).toBe(
      "sha256:63028750c24890e6393b3a2f1a2fad02ea2c71236742b2ac6210ae084104bde8",
    );
    expect(rows.find((r) => r.seq === 149)?.liveFrom).toBe("2026-10-30T13:57:38.488Z");
    expect(rows.find((r) => r.seq === 149)?.liveTo).toBe("2026-10-30T22:56:48.458Z");
    expect(rows.find((r) => r.seq === 149)?.gatewaySha).toBe(
      "b31c1e12ea341d4d42211ec072f8b24b29b6727a",
    );
    expect(rows.find((r) => r.seq === 149)?.artifactDigest).toBe(
      "sha256:12cf98adb47379477a8f2edff65962975a087f5d47fd4a38a41ace9da1365c91",
    );
    expect(rows.find((r) => r.seq === 150)?.liveFrom).toBe("2026-10-30T22:56:48.458Z");
    expect(rows.find((r) => r.seq === 150)?.liveTo).toBe("2026-10-31T03:21:00.871Z");
    expect(rows.find((r) => r.seq === 150)?.gatewaySha).toBe(
      "66bad421c9bb74ccfd6234fc3e003aaa67ce798a",
    );
    expect(rows.find((r) => r.seq === 150)?.artifactDigest).toBe(
      "sha256:baff3fa97596e284681a62f2d27523d0dded5b7ebcfba7ea8875bfec97ce684d",
    );
    expect(rows.find((r) => r.seq === 151)?.liveFrom).toBe("2026-10-31T03:21:00.871Z");
    // Seq 151 was the sole open tip at #172/#176; #194 closed it at seq 152 liveFrom.
    expect(rows.find((r) => r.seq === 151)?.liveTo).toBe("2026-11-01T23:04:06.294Z");
    expect(rows.find((r) => r.seq === 152)?.liveFrom).toBe("2026-11-01T23:04:06.294Z");
    expect(rows.find((r) => r.seq === 151)?.gatewaySha).toBe(
      "d37bed5117d6969e5ad0ee47b32e4efa8b6d715a",
    );
    expect(rows.find((r) => r.seq === 151)?.artifactDigest).toBe(
      "sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48",
    );
    // Dual-open (seq 127 + tip) was cleared by #172; later tips stay uniquely open.
    expect(audit.findings.some((f) => f.code === "open-interval")).toBe(false);
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
