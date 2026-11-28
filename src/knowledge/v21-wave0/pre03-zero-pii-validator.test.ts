import { describe, expect, it } from "vitest";
import {
  OFFICIAL_PRE03_PRODUCT_A_MOCK,
  OFFICIAL_PRE03_PRODUCT_B_MOCK,
  PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED,
  PRE03_PRODUCT_B_MAX_ROWS,
  PRE03_ZERO_PII_VALIDATOR_IO,
  validatePre03Candidate,
} from "./pre03-zero-pii-validator.js";

function cloneA(): Record<string, unknown> {
  return structuredClone(OFFICIAL_PRE03_PRODUCT_A_MOCK) as Record<string, unknown>;
}

function cloneB(): Record<string, unknown> {
  return structuredClone(OFFICIAL_PRE03_PRODUCT_B_MOCK) as Record<string, unknown>;
}

function rulesOf(input: unknown, options?: Parameters<typeof validatePre03Candidate>[1]): number[] {
  return [
    ...new Set(validatePre03Candidate(input, options).issues.map((issue) => issue.rule)),
  ].toSorted((a, b) => a - b);
}

describe("PRE-03 zero-PII validator (official contract v1.0)", () => {
  it("is a pure in-memory checker with no I/O and no production-export authorization", () => {
    expect(PRE03_ZERO_PII_VALIDATOR_IO).toEqual({
      database: false,
      network: false,
      diskWrites: false,
    });
    expect(PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED).toBe(false);
  });

  it("accepts the official Product A synthetic mock (all 12 rules)", () => {
    const result = validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_A_MOCK);
    expect(result.product).toBe("A");
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts the official Product B synthetic mock (all 12 rules)", () => {
    const result = validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_B_MOCK);
    expect(result.product).toBe("B");
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rule 1: rejects document body / HTML / attachment fields", () => {
    const withBody = cloneA();
    withBody.body = "# markdown document body";
    expect(rulesOf(withBody)).toContain(1);
    const withAttachment = cloneB();
    (withAttachment.rows as Record<string, unknown>[])[0].filename = "syn_not_enough.doc";
    expect(rulesOf(withAttachment)).toContain(1);
    expect(validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_A_MOCK).ok).toBe(true);
  });

  it("rule 2: rejects email or telephone patterns in any string value", () => {
    const withEmail = cloneA();
    withEmail.scope_description = "contact user@example.com in this label";
    expect(rulesOf(withEmail)).toContain(2);
    const withPhone = cloneA();
    withPhone.scope_description = "call +14155552671 for this fictional label";
    expect(rulesOf(withPhone)).toContain(2);
  });

  it("rule 3: rejects Product A keys outside the permitted aggregate fields or raw ID row keys", () => {
    const extra = cloneA();
    extra.unexpected_column = 1;
    expect(rulesOf(extra)).toContain(3);
    const rawKey: Record<string, unknown> = { ...cloneA(), tenant_abc123: 1 };
    expect(rulesOf(rawKey)).toContain(3);
  });

  it("rule 4: rejects Product B format / sanitized / provenance mismatches", () => {
    const badFormat = cloneB();
    badFormat.format = "not-the-official-format";
    expect(rulesOf(badFormat)).toContain(4);
    const unsanitized = cloneB();
    unsanitized.sanitized = false;
    expect(rulesOf(unsanitized)).toContain(4);
    const badProvenance = cloneB();
    badProvenance.provenance = "PRODUCTION";
    expect(rulesOf(badProvenance)).toContain(4);
  });

  it("rule 5: rejects Product B identifier fields that are not syn_ tokens", () => {
    const raw = cloneB();
    (raw.rows as Record<string, unknown>[])[0].legacy_kb_id = "kb_production_raw";
    expect(rulesOf(raw)).toContain(5);
    const empty = cloneB();
    (empty.rows as Record<string, unknown>[])[0].name_token = "";
    expect(rulesOf(empty)).toContain(5);
  });

  it("rule 6: rejects Product B additional properties at the root or row level", () => {
    const root = cloneB();
    root.extra_root = "syn_nope";
    expect(rulesOf(root)).toContain(6);
    const row = cloneB();
    (row.rows as Record<string, unknown>[])[0].extra_row = "syn_nope";
    expect(rulesOf(row)).toContain(6);
  });

  it("rule 7: rejects more than 10000 Product B rows without a shard manifest and collision statement", () => {
    const oversize = cloneB();
    const template = (OFFICIAL_PRE03_PRODUCT_B_MOCK.rows[0] ?? {}) as Record<string, unknown>;
    oversize.rows = Array.from({ length: PRE03_PRODUCT_B_MAX_ROWS + 1 }, (_, index) => ({
      ...template,
      legacy_kb_id: `syn_kb_pad_${index}`,
      name_token: `syn_name_pad_${index}`,
    }));
    expect(rulesOf(oversize)).toContain(7);
    const withManifest = validatePre03Candidate(oversize, {
      shardManifest: {
        shards: [
          { id: "syn_shard_1", rows: 5001 },
          { id: "syn_shard_2", rows: 5000 },
        ],
        cross_shard_collision_statement:
          "SYNTHETIC_EXAMPLE: cross-shard alias collisions were compared; none silently truncated.",
      },
    });
    expect(withManifest.issues.some((issue) => issue.rule === 7)).toBe(false);
  });

  it("rule 8: rejects non-null proposed_space_id / proposed_kb_id without an official allocation ruling", () => {
    const assigned = cloneB();
    (assigned.rows as Record<string, unknown>[])[0].proposed_space_id = "syn_space_too_early";
    expect(rulesOf(assigned)).toContain(8);
    const stillAssigned = validatePre03Candidate(assigned, {
      officialAllocationRulingOnFile: true,
    });
    expect(stillAssigned.issues.some((issue) => issue.rule === 8)).toBe(false);
  });

  it("rule 9: rejects keys, salts, mapping tables, connection strings, or credentials", () => {
    const salt = cloneA();
    salt.salt = "syn_should_not_be_exported";
    expect(rulesOf(salt)).toContain(9);
    const conn = cloneA();
    conn.scope_description = "postgres://syn_user:syn_pass@lab-host/db";
    expect(rulesOf(conn)).toContain(9);
  });

  it("rule 10: flags missing Product A integers when README claims a complete scan, and unexplained non-zero unclassifiable rows", () => {
    const missing = cloneA();
    delete missing.team_count;
    expect(rulesOf(missing, { readmeClaimsCompleteScan: true })).toContain(10);
    expect(rulesOf(missing).includes(10)).toBe(false);
    const unexplained = cloneA();
    (unexplained.integrity as Record<string, unknown>).unclassifiable_row_count = 4;
    expect(rulesOf(unexplained)).toContain(10);
  });

  it("rule 11: rejects mock-labeled identifier samples that are not syn_ or obviously fictitious", () => {
    const labeled = cloneA();
    labeled.scope_description = "mock tenant_prod_9876 in this label";
    expect(rulesOf(labeled)).toContain(11);
    expect(validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_A_MOCK).ok).toBe(true);
    expect(validatePre03Candidate(OFFICIAL_PRE03_PRODUCT_B_MOCK).ok).toBe(true);
  });

  it("rule 12: rejects SANITIZED_CANDIDATE provenance on this sandbox checker", () => {
    const sanitized = cloneB();
    sanitized.provenance = "SANITIZED_CANDIDATE";
    const result = validatePre03Candidate(sanitized, { acceptSanitizedCandidate: true });
    expect(result.issues.some((issue) => issue.rule === 12)).toBe(true);
    expect(result.ok).toBe(false);
    expect(PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED).toBe(false);
  });
});
