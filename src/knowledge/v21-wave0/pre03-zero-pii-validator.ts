/**
 * PRE-03 zero-PII checker (W5B-1). Pure-function, read-only.
 *
 * Implements all 12 validation rules from official contract v1.0
 * PRE03_ANONYMIZATION_SPEC_FOR_GATE4.md
 * SHA-256 66294adfb60d54d42c4307d5b19c8fda298828d7bd9b0f520c0a2958f1fb845e.
 *
 * In-memory objects only. No database, network, or disk writes.
 * Do not hook this into production routes or default Gateway paths.
 * Team B must not feed this checker any real production payload.
 */
export const PRE03_ZERO_PII_VALIDATOR_IO = {
  database: false,
  network: false,
  diskWrites: false,
} as const;

/**
 * This sandbox checker does not authorize a production AUTH-V21-04 export.
 * Official contract v1.0 rule 12: a checker used today must accept only
 * SYNTHETIC_EXAMPLE mocks. Gate 4 is MET_FOR_CONTRACT_AND_SANDBOX only.
 */
export const PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED = false;

export const PRE03_PRODUCT_B_FORMAT = "candidate-pre03-v1";
export const PRE03_SYN_TOKEN_PATTERN = /^syn_[A-Za-z0-9_-]{1,64}$/;
export const PRE03_PRODUCT_B_MAX_ROWS = 10000;

export const PRE03_PRODUCT_A_ROOT_KEYS = [
  "generated_at",
  "scope_description",
  "tenant_count",
  "null_tenant_kb_count",
  "null_tenant_document_count",
  "null_tenant_version_count",
  "kb_count",
  "team_count",
  "collaboration_group_count",
  "favorites_estimate",
  "favorites_estimate_note",
  "legacy_alias_collision_count",
  "name_or_id_collision_count",
  "integrity",
] as const;

export const PRE03_PRODUCT_A_INTEGER_KEYS = [
  "tenant_count",
  "null_tenant_kb_count",
  "null_tenant_document_count",
  "null_tenant_version_count",
  "kb_count",
  "team_count",
  "collaboration_group_count",
  "favorites_estimate",
  "legacy_alias_collision_count",
  "name_or_id_collision_count",
] as const;

export const PRE03_PRODUCT_A_INTEGRITY_KEYS = [
  "scan_complete",
  "paginated",
  "unclassifiable_row_count",
] as const;

export const PRE03_PRODUCT_B_ROOT_KEYS = ["format", "sanitized", "provenance", "rows"] as const;

export const PRE03_PRODUCT_B_ROW_KEYS = [
  "legacy_kb_id",
  "tenant_id",
  "proposed_space_id",
  "proposed_kb_id",
  "alias_token",
  "name_token",
] as const;

export const PRE03_PRODUCT_B_IDENTIFIER_KEYS = PRE03_PRODUCT_B_ROW_KEYS;

const FORBIDDEN_CONTENT_KEYS = new Set([
  "content",
  "body",
  "html",
  "markdown",
  "md",
  "document_text",
  "document_body",
  "version_text",
  "attachment",
  "attachments",
  "attachment_bytes",
  "filename",
  "file_name",
  "filenames",
  "file_bytes",
]);

const FORBIDDEN_SECRET_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "secrets",
  "api_key",
  "apikey",
  "access_key",
  "private_key",
  "encryption_key",
  "salt",
  "salts",
  "credential",
  "credentials",
  "connection_string",
  "connectionstring",
  "conn_str",
  "mapping_table",
  "id_mapping",
  "id_mapping_table",
  "key_material",
]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const US_PHONE_PATTERN = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/;
const E164_PHONE_PATTERN = /\+[1-9]\d{7,14}\b/;
const CONNECTION_STRING_PATTERN =
  /(?:postgres(?:ql)?|mysql|mongodb|redis|amqp|kafka|https?):\/\/[^\s]+/i;
const USERINFO_HOST_PATTERN = /\b[A-Za-z0-9._-]+:[^@\s]{1,}@[A-Za-z0-9.-]+/;
const UUID_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_ID_KEY_PATTERN = /^(kb|tenant|user|space|org)[_-][A-Za-z0-9_-]+$/i;

export type Pre03RuleId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type Pre03ValidationIssue = {
  rule: Pre03RuleId;
  message: string;
  path?: string;
};

export type Pre03ValidationResult = {
  ok: boolean;
  product: "A" | "B" | "unknown";
  issues: Pre03ValidationIssue[];
};

export type Pre03ShardManifest = {
  shards?: unknown;
  cross_shard_collision_statement?: unknown;
};

export type Pre03ValidateOptions = {
  /**
   * When true, Product B provenance SANITIZED_CANDIDATE is accepted (rule 12).
   * Defaults to false: official contract v1.0 requires SYNTHETIC_EXAMPLE only
   * for a checker used today. Do not flip this for a Team B production export.
   */
  acceptSanitizedCandidate?: boolean;
  /** Rule 8: official allocation ruling on file. Defaults to false. */
  officialAllocationRulingOnFile?: boolean;
  /** Rule 10: companion README claims a complete scan. */
  readmeClaimsCompleteScan?: boolean;
  /** Rule 7: accompanying shard manifest + cross-shard collision statement. */
  shardManifest?: Pre03ShardManifest;
};

export const OFFICIAL_PRE03_PRODUCT_A_MOCK = {
  generated_at: "2026-11-28T16:00:00+08:00",
  scope_description:
    "SYNTHETIC_EXAMPLE: fictional non-production cluster name lab-mock-cluster (no connection string)",
  tenant_count: 3,
  null_tenant_kb_count: 1,
  null_tenant_document_count: 2,
  null_tenant_version_count: 2,
  kb_count: 5,
  team_count: 2,
  collaboration_group_count: 1,
  favorites_estimate: 0,
  favorites_estimate_note:
    "SYNTHETIC_EXAMPLE: favorites not counted from any server table; placeholder zero with explicit note",
  legacy_alias_collision_count: 1,
  name_or_id_collision_count: 0,
  integrity: {
    scan_complete: true,
    paginated: false,
    unclassifiable_row_count: 0,
  },
} as const;

export const OFFICIAL_PRE03_PRODUCT_B_MOCK = {
  format: "candidate-pre03-v1",
  sanitized: true,
  provenance: "SYNTHETIC_EXAMPLE",
  rows: [
    {
      legacy_kb_id: "syn_kb_example_001",
      tenant_id: "syn_tenant_example_aaa",
      proposed_space_id: null,
      proposed_kb_id: null,
      alias_token: "syn_alias_example_alpha",
      name_token: "syn_name_example_alpha",
    },
    {
      legacy_kb_id: "syn_kb_example_002",
      tenant_id: null,
      proposed_space_id: null,
      proposed_kb_id: null,
      alias_token: "syn_alias_example_alpha",
      name_token: "syn_name_example_beta",
    },
  ],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectProduct(value: unknown): "A" | "B" | "unknown" {
  if (!isRecord(value)) {
    return "unknown";
  }
  if ("format" in value || "sanitized" in value || "provenance" in value || "rows" in value) {
    return "B";
  }
  if (
    "tenant_count" in value ||
    "kb_count" in value ||
    "scope_description" in value ||
    "integrity" in value
  ) {
    return "A";
  }
  return "unknown";
}

function walkStrings(value: unknown, path: string, visit: (s: string, path: string) => void): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      walkStrings(child, path ? `${path}.${key}` : key, visit);
    }
  }
}

function walkKeys(
  value: unknown,
  path: string,
  visit: (key: string, path: string, child: unknown) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, `${path}[${index}]`, visit));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      visit(key, childPath, child);
      walkKeys(child, childPath, visit);
    }
  }
}

function looksLikePhone(value: string): boolean {
  if (ISO_DATE_HINT.test(value) || PRE03_SYN_TOKEN_PATTERN.test(value)) {
    return false;
  }
  return US_PHONE_PATTERN.test(value) || E164_PHONE_PATTERN.test(value);
}

const ISO_DATE_HINT = /^\d{4}-\d{2}-\d{2}T/;

function looksLikeRawBusinessIdKey(key: string): boolean {
  return UUID_KEY_PATTERN.test(key) || (RAW_ID_KEY_PATTERN.test(key) && !key.startsWith("syn_"));
}

function isObviouslyFictitious(value: string): boolean {
  if (PRE03_SYN_TOKEN_PATTERN.test(value)) {
    return true;
  }
  return (
    value.includes("SYNTHETIC_EXAMPLE") ||
    value.includes("fictional") ||
    value.includes("lab-mock-") ||
    value.startsWith("syn_")
  );
}

function labeledAsMock(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.mock === true || value.example === true) {
    return true;
  }
  const provenance = value.provenance;
  if (provenance === "SYNTHETIC_EXAMPLE" || provenance === "SANITIZED_CANDIDATE") {
    return true;
  }
  let labeled = false;
  walkStrings(value, "", (s) => {
    if (s.includes("SYNTHETIC_EXAMPLE") || /\bmock\b/i.test(s) || /\bexample\b/i.test(s)) {
      labeled = true;
    }
  });
  return labeled;
}

function shardManifestComplete(manifest: Pre03ShardManifest | undefined): boolean {
  if (!manifest) {
    return false;
  }
  const statement = manifest.cross_shard_collision_statement;
  const shards = manifest.shards;
  return (
    typeof statement === "string" &&
    statement.trim().length > 0 &&
    Array.isArray(shards) &&
    shards.length > 0
  );
}

export function validatePre03Candidate(
  input: unknown,
  options: Pre03ValidateOptions = {},
): Pre03ValidationResult {
  const issues: Pre03ValidationIssue[] = [];
  const product = detectProduct(input);
  const acceptSanitized =
    options.acceptSanitizedCandidate === true && PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED;
  // Even if a caller passes acceptSanitizedCandidate, this Team B sandbox
  // checker keeps rule 12 closed unless a future authorized build flips the
  // production-export constant (default false). options flag is recorded but
  // cannot silently authorize SANITIZED_CANDIDATE today.
  const officialAllocation = options.officialAllocationRulingOnFile === true;
  const readmeComplete = options.readmeClaimsCompleteScan === true;

  if (!isRecord(input)) {
    issues.push({
      rule: 3,
      message: "Candidate must be a JSON object, not a raw-ID table or primitive.",
    });
    return { ok: false, product, issues };
  }

  walkKeys(input, "", (key, path) => {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_CONTENT_KEYS.has(normalized)) {
      issues.push({
        rule: 1,
        path,
        message: `Forbidden document-body / attachment field ${key}`,
      });
    }
    if (FORBIDDEN_SECRET_KEYS.has(normalized)) {
      issues.push({
        rule: 9,
        path,
        message: `Forbidden secret / key / mapping / credential field ${key}`,
      });
    }
  });

  walkStrings(input, "", (s, path) => {
    if (EMAIL_PATTERN.test(s)) {
      issues.push({ rule: 2, path, message: "Email address pattern in a string value" });
    }
    if (looksLikePhone(s)) {
      issues.push({ rule: 2, path, message: "Telephone-number pattern in a string value" });
    }
    if (CONNECTION_STRING_PATTERN.test(s) || USERINFO_HOST_PATTERN.test(s)) {
      issues.push({
        rule: 9,
        path,
        message: "Connection string or credential userinfo in a string value",
      });
    }
  });

  if (product === "A") {
    const permitted = new Set<string>(PRE03_PRODUCT_A_ROOT_KEYS);
    for (const key of Object.keys(input)) {
      if (!permitted.has(key)) {
        issues.push({
          rule: 3,
          path: key,
          message: `Product A contains object key other than the permitted aggregate fields: ${key}`,
        });
        if (looksLikeRawBusinessIdKey(key)) {
          issues.push({
            rule: 3,
            path: key,
            message: `Product A uses a raw business identifier as a row key: ${key}`,
          });
        }
      }
    }
    if (isRecord(input.integrity)) {
      const integrityPermitted = new Set<string>(PRE03_PRODUCT_A_INTEGRITY_KEYS);
      for (const key of Object.keys(input.integrity)) {
        if (!integrityPermitted.has(key)) {
          issues.push({
            rule: 3,
            path: `integrity.${key}`,
            message: `Product A integrity contains a non-permitted key: ${key}`,
          });
        }
      }
    }

    const missingIntegers = PRE03_PRODUCT_A_INTEGER_KEYS.filter((key) => {
      const value = input[key];
      return typeof value !== "number" || !Number.isInteger(value);
    });
    if (readmeComplete && missingIntegers.length > 0) {
      issues.push({
        rule: 10,
        message: `Product A integer fields missing while README claims a complete scan: ${missingIntegers.join(", ")}`,
      });
    }
    const integrity = isRecord(input.integrity) ? input.integrity : undefined;
    const scanComplete = integrity?.scan_complete === true;
    const unclassifiable = integrity?.unclassifiable_row_count;
    const unexplainedNonZero =
      typeof unclassifiable === "number" &&
      unclassifiable > 0 &&
      typeof input.unclassifiable_row_explanation !== "string";
    // The official Product A schema has no explanation field; a non-zero
    // remainder with scan_complete=true is unexplained and must be flagged.
    if (scanComplete && unexplainedNonZero) {
      issues.push({
        rule: 10,
        path: "integrity.unclassifiable_row_count",
        message:
          "integrity.scan_complete is true while unclassifiable_row_count is unexplained and non-zero (human review required)",
      });
    }
  }

  if (product === "B") {
    if (input.format !== PRE03_PRODUCT_B_FORMAT) {
      issues.push({
        rule: 4,
        path: "format",
        message: `Product B format must be ${PRE03_PRODUCT_B_FORMAT}`,
      });
    }
    if (input.sanitized !== true) {
      issues.push({
        rule: 4,
        path: "sanitized",
        message: "Product B sanitized must be true",
      });
    }
    const provenance = input.provenance;
    if (provenance !== "SYNTHETIC_EXAMPLE" && provenance !== "SANITIZED_CANDIDATE") {
      issues.push({
        rule: 4,
        path: "provenance",
        message: "Product B provenance must be SYNTHETIC_EXAMPLE or SANITIZED_CANDIDATE",
      });
    }
    if (provenance === "SANITIZED_CANDIDATE" && !acceptSanitized) {
      issues.push({
        rule: 12,
        path: "provenance",
        message:
          "Provenance SANITIZED_CANDIDATE is rejected: this checker accepts only SYNTHETIC_EXAMPLE mocks (AUTH-V21-04 production export is not authorized for Team B)",
      });
    }

    const permittedRoot = new Set<string>(PRE03_PRODUCT_B_ROOT_KEYS);
    for (const key of Object.keys(input)) {
      if (!permittedRoot.has(key)) {
        issues.push({
          rule: 6,
          path: key,
          message: `Product B additional property at the root: ${key}`,
        });
      }
    }

    const rows = input.rows;
    if (!Array.isArray(rows)) {
      issues.push({ rule: 4, path: "rows", message: "Product B rows must be an array" });
    } else {
      if (rows.length > PRE03_PRODUCT_B_MAX_ROWS && !shardManifestComplete(options.shardManifest)) {
        issues.push({
          rule: 7,
          path: "rows",
          message:
            "Product B rows.length > 10000 without an accompanying shard manifest and cross-shard collision statement",
        });
      }
      const permittedRow = new Set<string>(PRE03_PRODUCT_B_ROW_KEYS);
      rows.forEach((row, index) => {
        const rowPath = `rows[${index}]`;
        if (!isRecord(row)) {
          issues.push({ rule: 6, path: rowPath, message: "Product B row must be an object" });
          return;
        }
        for (const key of Object.keys(row)) {
          if (!permittedRow.has(key)) {
            issues.push({
              rule: 6,
              path: `${rowPath}.${key}`,
              message: `Product B additional property at the row level: ${key}`,
            });
          }
        }
        for (const key of PRE03_PRODUCT_B_IDENTIFIER_KEYS) {
          const value = row[key];
          if (value === null) {
            if (key === "legacy_kb_id" || key === "name_token") {
              issues.push({
                rule: 5,
                path: `${rowPath}.${key}`,
                message: `${key} is required and must be a syn_ token`,
              });
            }
            continue;
          }
          if (typeof value !== "string" || !PRE03_SYN_TOKEN_PATTERN.test(value)) {
            issues.push({
              rule: 5,
              path: `${rowPath}.${key}`,
              message: `Product B identifier ${key} is a non-null string that does not match ^syn_[A-Za-z0-9_-]{1,64}$`,
            });
          }
        }
        if (!officialAllocation) {
          if (row.proposed_space_id !== null && row.proposed_space_id !== undefined) {
            issues.push({
              rule: 8,
              path: `${rowPath}.proposed_space_id`,
              message:
                "proposed_space_id is non-null without a later official allocation ruling on file",
            });
          }
          if (row.proposed_kb_id !== null && row.proposed_kb_id !== undefined) {
            issues.push({
              rule: 8,
              path: `${rowPath}.proposed_kb_id`,
              message:
                "proposed_kb_id is non-null without a later official allocation ruling on file",
            });
          }
        }
      });
    }
  }

  if (labeledAsMock(input)) {
    walkStrings(input, "", (s, path) => {
      // Aggregate notes and scope labels may be fictitious prose; scan tokens
      // so a raw id embedded in a "mock" sentence is still rejected.
      if (
        EMAIL_PATTERN.test(s) &&
        !s.includes("syn_") &&
        !s.endsWith(".example") &&
        !isObviouslyFictitious(s)
      ) {
        issues.push({
          rule: 11,
          path,
          message:
            "Sample is labeled as a mock but contains an email that is not prefixed syn_ and is not obviously fictitious",
        });
      }
      const tokens = s.split(/[^A-Za-z0-9_-]+/).filter((token) => token.length > 0);
      for (const token of tokens) {
        const identifierLike =
          /^(tenant|user|kb|space|org|alias|name)[-_:]/i.test(token) ||
          RAW_ID_KEY_PATTERN.test(token) ||
          UUID_KEY_PATTERN.test(token);
        if (identifierLike && !isObviouslyFictitious(token)) {
          issues.push({
            rule: 11,
            path,
            message:
              "Sample is labeled as a mock but is not prefixed syn_ and is not obviously fictitious",
          });
          break;
        }
      }
    });
  }

  return { ok: issues.length === 0, product, issues };
}
