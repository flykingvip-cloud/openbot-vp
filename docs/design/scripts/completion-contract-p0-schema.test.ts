import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureDir = path.join(repoRoot, "docs/design/fixtures");

const REASON_CODES = [
  "RC_OK",
  "RC_PENDING_EVIDENCE",
  "RC_PENDING_HUMAN",
  "RC_EVIDENCE_MISSING",
  "RC_EVIDENCE_NOT_FOUND",
  "RC_EVIDENCE_EXPIRED",
  "RC_EVIDENCE_TAMPERED",
  "RC_SOURCE_NOT_ALLOWED",
  "RC_SOURCE_CONFLICT",
  "RC_TENANT_MISMATCH",
  "RC_BINDING_STALE",
  "RC_RUN_STALE",
  "RC_CANCELLED",
  "RC_FORCE_OFF",
  "RC_RACE_LOST_TO_CANCEL",
  "RC_DUPLICATE_REPLAY",
  "RC_SUPERSEDED",
  "RC_ROLLBACK",
  "RC_CONTRACT_VERSION",
] as const;

function loadJson(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8")) as unknown;
}

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = [
    "completion-candidate.schema.json",
    "contract-verdict-record.schema.json",
    "background-completion-payload.schema.json",
    "bridge-event-envelope.schema.json",
    "binding-record.schema.json",
  ];
  for (const name of schemas) {
    ajv.addSchema(loadJson(path.join("docs/design/schemas", name)));
  }
  return ajv;
}

describe("completion contract P0 schema contract", () => {
  const ajv = createValidator();

  test("reason codes in verdict schema match completion-contract.md registry", () => {
    const verdictSchema = loadJson("docs/design/schemas/contract-verdict-record.schema.json") as {
      properties: { reasonCode: { enum: string[] } };
    };
    const schemaCodes = [...verdictSchema.properties.reasonCode.enum].toSorted();
    const docCodes = [...REASON_CODES].toSorted();
    expect(schemaCodes).toEqual(docCodes);
  });

  test("completion contract test vectors count is at least 20", () => {
    const manifest = loadJson("docs/design/fixtures/completion-contract/test-vectors.json") as {
      vectors: unknown[];
    };
    expect(manifest.vectors.length).toBeGreaterThanOrEqual(20);
  });

  test("sample CompletionCandidate validates against schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/completion-candidate.schema.json",
    );
    expect(validate).toBeTruthy();
    const sample = loadJson("docs/design/fixtures/completion-contract/sample-candidate-valid.json");
    expect(validate!(sample)).toBe(true);
  });

  test("valid bridge envelope validates (serverAttribution, tenant, binding pair)", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    );
    const sample = loadJson(
      "docs/design/fixtures/bridge-events/envelope-valid-background-completed.json",
    );
    expect(validate!(sample)).toBe(true);
  });

  test("group_tenant envelope without tenantId fails schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const sample = loadJson("docs/design/fixtures/bridge-events/envelope-invalid-no-tenant.json");
    expect(validate(sample)).toBe(false);
  });

  test("client-forged serverAttribution fails schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const sample = loadJson(
      "docs/design/fixtures/bridge-events/envelope-invalid-client-attribution.json",
    );
    expect(validate(sample)).toBe(false);
  });

  test("bindingVersion without bindingId fails schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const sample = loadJson(
      "docs/design/fixtures/bridge-events/envelope-invalid-binding-version-only.json",
    );
    expect(validate(sample)).toBe(false);
  });

  test("sample BindingRecord validates against schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/binding-record.schema.json",
    )!;
    const sample = loadJson("docs/design/fixtures/b2-binding/sample-binding-active.json");
    expect(validate(sample)).toBe(true);
  });

  test("all test vector expected reason codes are registered", () => {
    const manifest = loadJson("docs/design/fixtures/completion-contract/test-vectors.json") as {
      vectors: Array<{ expected: { reasonCode?: string } }>;
    };
    for (const vector of manifest.vectors) {
      const code = vector.expected.reasonCode;
      if (code) {
        expect(REASON_CODES).toContain(code);
      }
    }
  });

  test("unlisted events and freeform payload keys fail event-discriminated schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    expect(
      validate(loadJson("docs/design/fixtures/bridge-events/envelope-invalid-unlisted-event.json")),
    ).toBe(false);
    expect(
      validate(
        loadJson("docs/design/fixtures/bridge-events/envelope-invalid-freeform-payload.json"),
      ),
    ).toBe(false);
  });

  test("P0 payload schema does not scan string values for PII", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const sample = loadJson(
      "docs/design/fixtures/bridge-events/envelope-valid-background-completed.json",
    ) as Record<string, unknown>;
    const payload = { ...(sample.payload as Record<string, unknown>) };
    payload.errorSummary = "user@example.com";
    expect(validate({ ...sample, payload })).toBe(true);
  });

  test("nested array HMAC and camel/snake PII aliases fail schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const nestedArray = loadJson(
      "docs/design/fixtures/bridge-events/envelope-invalid-nested-array-pii.json",
    );
    const aliases = loadJson(
      "docs/design/fixtures/bridge-events/envelope-invalid-pii-aliases.json",
    );
    expect(validate(nestedArray)).toBe(false);
    expect(validate(aliases)).toBe(false);
  });

  test("nested payload PII and hmac keys fail schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const sample = loadJson("docs/design/fixtures/bridge-events/envelope-invalid-nested-pii.json");
    expect(validate(sample)).toBe(false);
  });

  test("payload PII keys fail schema", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const sample = loadJson("docs/design/fixtures/bridge-events/envelope-invalid-payload-pii.json");
    expect(validate(sample)).toBe(false);
  });

  test("requesterId cannot substitute for group tenantId", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const sample = loadJson(
      "docs/design/fixtures/bridge-events/envelope-invalid-requester-fallback.json",
    );
    expect(validate(sample)).toBe(false);
  });

  test("bridge envelope schemas reject additionalProperties on envelope root", () => {
    const validate = ajv.getSchema(
      "https://openbot.love/design/schemas/bridge-event-envelope.schema.json",
    )!;
    const sample = loadJson(
      "docs/design/fixtures/bridge-events/envelope-valid-background-completed.json",
    ) as Record<string, unknown>;
    expect(validate({ ...sample, forgedField: true })).toBe(false);
  });

  test("fixture directories exist for P0 evidence layout", () => {
    expect(fs.existsSync(path.join(fixtureDir, "completion-contract"))).toBe(true);
    expect(fs.existsSync(path.join(fixtureDir, "bridge-events"))).toBe(true);
    expect(fs.existsSync(path.join(fixtureDir, "b2-binding"))).toBe(true);
  });
});
