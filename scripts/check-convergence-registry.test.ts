import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkRegistrySource } from "./check-convergence-registry.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REGISTRY_REL = "docs/design/convergence-registry.yaml";

function readRegistry(): string {
  return fs.readFileSync(path.join(REPO_ROOT, REGISTRY_REL), "utf8");
}

/** A minimal valid row, so each test can vary exactly one thing. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    responsibility: "example",
    intent: "Example responsibility.",
    currentOwners: ["package.json"],
    canonicalOwner: "package.json",
    mode: "adapt",
    liveState: "live",
    gate: "Some existing gate.",
    parityEvidence: "Some parity evidence.",
    retirementTarget: "none",
    ...overrides,
  };
}

function sourceOf(rows: Array<Record<string, unknown>>, version: unknown = 1): string {
  return JSON.stringify({ version, responsibilities: rows });
}

/** Rows of the committed registry, parsed without going through the checker. */
function committedRows(): Array<Record<string, unknown>> {
  const doc = parse(readRegistry()) as { responsibilities: Array<Record<string, unknown>> };
  return doc.responsibilities;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

describe("the committed registry", () => {
  it("passes validation", () => {
    const result = checkRegistrySource(readRegistry());
    expect(result.violations).toEqual([]);
    expect(result.rowCount).toBeGreaterThan(0);
  });

  // The two assertions below restate the checker's central rules against the real
  // file, independently of the checker, so a bug that relaxed a rule would not also
  // silence the evidence that the rule holds.
  it("declares every current owner as a path that exists", () => {
    const claims = committedRows().flatMap((row) => stringList(row.currentOwners));
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(fs.existsSync(path.join(REPO_ROOT, claim)), `${claim} must exist`).toBe(true);
    }
  });

  it("declares every pending owner as a path that does not exist", () => {
    const claims = committedRows().flatMap((row) => stringList(row.pendingOwners));
    for (const claim of claims) {
      expect(
        fs.existsSync(path.join(REPO_ROOT, claim)),
        `${claim} has landed; promote it to currentOwners`,
      ).toBe(false);
    }
  });

  it("gives every pending row a ref to find the work by", () => {
    for (const row of committedRows()) {
      if (stringList(row.pendingOwners).length === 0) {
        continue;
      }
      expect(typeof row.pendingRef === "string" && row.pendingRef.trim().length > 0).toBe(true);
    }
  });
});

describe("fail-closed new-primitive rule", () => {
  it("rejects new-primitive when an owner already exists", () => {
    // The rule that would have prevented a duplicate capability mechanism.
    const result = checkRegistrySource(
      sourceOf([row({ mode: "new-primitive", currentOwners: ["package.json"] })]),
    );
    expect(result.violations.join("\n")).toMatch(/new-primitive.*requires.*currentOwners/s);
  });

  it("rejects new-primitive when the only owner is still in flight", () => {
    // "It hasn't merged yet" is exactly the reasoning that produces two parallel
    // implementations, so pending owners block the claim too.
    const result = checkRegistrySource(
      sourceOf([
        row({
          mode: "new-primitive",
          currentOwners: [],
          pendingOwners: ["src/not/here/yet.ts"],
          pendingRef: "branch some/branch",
          canonicalOwner: "unassigned",
        }),
      ]),
    );
    expect(result.violations.join("\n")).toMatch(/new-primitive.*pendingOwners.*to be empty/s);
  });

  it("allows new-primitive only with no owners", () => {
    const result = checkRegistrySource(
      sourceOf([row({ mode: "new-primitive", currentOwners: [], canonicalOwner: "unassigned" })]),
    );
    expect(result.violations).toEqual([]);
  });
});

describe("pending ownership", () => {
  const pendingRow = (overrides: Record<string, unknown> = {}) =>
    row({
      currentOwners: [],
      pendingOwners: ["src/not/here/yet.ts"],
      pendingRef: "branch some/branch",
      canonicalOwner: "src/not/here/yet.ts",
      ...overrides,
    });

  it("accepts a pending owner that does not exist", () => {
    expect(checkRegistrySource(sourceOf([pendingRow()])).violations).toEqual([]);
  });

  it("rejects a pending owner that has landed, forcing promotion", () => {
    // The mirror rule. Without it, `pendingOwners` would be a permanent escape
    // hatch from the stale-claim check instead of a temporary one.
    const result = checkRegistrySource(sourceOf([pendingRow({ pendingOwners: ["package.json"] })]));
    expect(result.violations.join("\n")).toMatch(
      /pendingOwners path already exists.*promote it to `currentOwners`/s,
    );
  });

  it("requires a ref so a reader can go find the work", () => {
    const result = checkRegistrySource(sourceOf([pendingRow({ pendingRef: "  " })]));
    expect(result.violations.join("\n")).toMatch(/`pendingRef` is required/);
  });

  it("rejects a leftover ref once nothing is pending", () => {
    const result = checkRegistrySource(
      sourceOf([
        pendingRow({ pendingOwners: [], canonicalOwner: "package.json", pendingRef: "stale" }),
      ]),
    );
    expect(result.violations.join("\n")).toMatch(
      /`pendingRef` is set but `pendingOwners` is empty/,
    );
  });

  it("rejects a path claimed as both current and pending", () => {
    const result = checkRegistrySource(
      sourceOf([pendingRow({ currentOwners: ["package.json"], pendingOwners: ["package.json"] })]),
    );
    expect(result.violations.join("\n")).toMatch(
      /declared in both `currentOwners` and `pendingOwners`/,
    );
  });

  it("lets canonicalOwner name a pending path the row declares", () => {
    expect(
      checkRegistrySource(sourceOf([pendingRow({ canonicalOwner: "src/not/here/yet.ts" })]))
        .violations,
    ).toEqual([]);
  });

  it("still rejects a canonicalOwner the row never declared as pending", () => {
    const result = checkRegistrySource(
      sourceOf([pendingRow({ canonicalOwner: "src/some/other/typo.ts" })]),
    );
    expect(result.violations.join("\n")).toMatch(/canonicalOwner path does not exist/);
  });

  it("rejects pendingOwners that is not a list", () => {
    const result = checkRegistrySource(
      sourceOf([pendingRow({ pendingOwners: "src/not/here/yet.ts" })]),
    );
    expect(result.violations.join("\n")).toMatch(/`pendingOwners` must be a list/);
  });

  it("treats an absent pendingOwners as empty", () => {
    const bare = row();
    delete bare.pendingOwners;
    expect(checkRegistrySource(sourceOf([bare])).violations).toEqual([]);
  });

  it("counts the rows with pending owners", () => {
    const result = checkRegistrySource(sourceOf([pendingRow(), row({ responsibility: "other" })]));
    expect(result.violations).toEqual([]);
    expect(result.pendingRowCount).toBe(1);
  });
});

describe("stale ownership claims", () => {
  it("rejects a currentOwners path that does not exist", () => {
    const result = checkRegistrySource(
      sourceOf([row({ currentOwners: ["src/does/not/exist.ts"] })]),
    );
    expect(result.violations.join("\n")).toMatch(/currentOwners path does not exist/);
  });

  it("rejects a canonicalOwner path that does not exist", () => {
    const result = checkRegistrySource(sourceOf([row({ canonicalOwner: "src/nope.ts" })]));
    expect(result.violations.join("\n")).toMatch(/canonicalOwner path does not exist/);
  });

  it("accepts the unassigned sentinel for canonicalOwner", () => {
    expect(
      checkRegistrySource(sourceOf([row({ canonicalOwner: "unassigned" })])).violations,
    ).toEqual([]);
  });

  it("rejects a retirementTarget path that does not exist", () => {
    const result = checkRegistrySource(sourceOf([row({ retirementTarget: "src/gone.ts" })]));
    expect(result.violations.join("\n")).toMatch(/retirementTarget path does not exist/);
  });
});

describe("schema and enums", () => {
  it("rejects an unknown mode", () => {
    const result = checkRegistrySource(sourceOf([row({ mode: "refactor" })]));
    expect(result.violations.join("\n")).toMatch(/`mode` must be one of/);
  });

  it("rejects an unknown liveState", () => {
    const result = checkRegistrySource(sourceOf([row({ liveState: "partially" })]));
    expect(result.violations.join("\n")).toMatch(/`liveState` must be one of/);
  });

  it.each(["intent", "gate", "parityEvidence", "retirementTarget", "canonicalOwner"])(
    "rejects a blank %s so governance fields cannot be decoration",
    (field) => {
      const result = checkRegistrySource(sourceOf([row({ [field]: "  " })]));
      expect(result.violations.join("\n")).toMatch(new RegExp(`\`${field}\` must be a non-empty`));
    },
  );

  it("rejects a missing responsibility id", () => {
    const result = checkRegistrySource(sourceOf([row({ responsibility: "" })]));
    expect(result.violations.join("\n")).toMatch(/`responsibility` must be a non-empty string/);
  });

  it("rejects duplicate responsibility ids", () => {
    const result = checkRegistrySource(sourceOf([row(), row()]));
    expect(result.violations.join("\n")).toMatch(/duplicate responsibility id/);
  });

  it("rejects currentOwners that is not a list", () => {
    const result = checkRegistrySource(sourceOf([row({ currentOwners: "package.json" })]));
    expect(result.violations.join("\n")).toMatch(/`currentOwners` must be a list/);
  });

  it("requires a concrete target when retiring", () => {
    const result = checkRegistrySource(sourceOf([row({ mode: "retire" })]));
    expect(result.violations.join("\n")).toMatch(/`retire` requires a concrete `retirementTarget`/);
  });

  it("rejects an unsupported version", () => {
    const result = checkRegistrySource(sourceOf([row()], 2));
    expect(result.violations.join("\n")).toMatch(/unsupported `version`/);
  });

  it("reports invalid YAML instead of throwing", () => {
    expect(checkRegistrySource(":\n  - [").violations.join("\n")).toMatch(/not valid YAML/);
  });

  it("rejects a non-mapping top level", () => {
    expect(checkRegistrySource("- a\n- b").violations.join("\n")).toMatch(
      /top level must be a mapping/,
    );
  });
});
