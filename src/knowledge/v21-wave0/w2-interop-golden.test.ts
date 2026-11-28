/**
 * Wave-V21-2 W2B-2 default-off end-to-end interop tests against the pinned
 * Team A golden fixture. Flags stay unset. Formal T-01–T-27 is not claimed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AI_EXECUTION_TRACE_HEADER_KEYS,
  AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT,
  createAiExecutionTraceHeaderPropagator,
} from "./ai-execution-trace-header-propagator.js";
import { canonicalJsonText, canonicalSha256Hex } from "./canonical-json.js";
import {
  CONTROLLED_DATA_BRIDGE_UNLOCKED,
  evaluateControlledDataBridge,
  type ControlledDataBridgeDeclaration,
} from "./controlled-data-bridge-guard.js";
import {
  MODELS_EMBED_PROVIDER_TRACK,
  MODELS_EMBED_PROXY_ENABLED_DEFAULT,
  createControlledModelsEmbedProxy,
} from "./models-embed-proxy.js";
import {
  REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT,
  computeRevocationPurgeReceiptHash,
  createRevocationPurgeReceiptValidator,
} from "./revocation-purge-receipt.js";
import {
  SEMANTIC_OBJECT_CATALOG_READ_ADAPTER_ENABLED_DEFAULT,
  createSemanticObjectCatalogReadAdapter,
} from "./semantic-object-catalog-read-adapter.js";
import {
  W2_INTEROP_FIXTURE_SHA256,
  buildFourChannelReceipt,
  createInteropSemanticCatalog,
  createLoopbackEmbedProvider,
  runSevenKeyHops,
} from "./w2-interop-harness.js";

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "interop-fixtures",
  "w2_interop_golden.json",
);

type FixtureCase = {
  id: string;
  expect: string;
  expected: Record<string, unknown>;
  input: Record<string, unknown>;
  notes?: string;
};

type FixtureGroup = {
  id: string;
  title: string;
  cases: FixtureCase[];
};

type GoldenFixture = {
  fixture_id: string;
  formal_acceptance: boolean;
  formal_t01_t27: string;
  experimental_v3_enabled_default: boolean;
  mount_production_http: string;
  catalog_seed: Record<string, unknown>[];
  groups: FixtureGroup[];
  canonicalization: {
    probes: Array<{ id: string; input: unknown; canonical_json: string; sha256: string }>;
  };
};

const fixtureBytes = readFileSync(FIXTURE_PATH);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as GoldenFixture;

function group(id: string): FixtureGroup {
  const found = fixture.groups.find((item) => item.id === id);
  if (!found) {
    throw new Error(`missing fixture group ${id}`);
  }
  return found;
}

function fixtureCase(groupId: string, caseId: string): FixtureCase {
  const found = group(groupId).cases.find((item) => item.id === caseId);
  if (!found) {
    throw new Error(`missing fixture case ${caseId}`);
  }
  return found;
}

function flagUnset(name: string): boolean {
  const value = process.env[name];
  return value === undefined || value === "" || value === "0" || value === "false";
}

describe("W2 interop golden fixture pin", () => {
  it("pins the independently verified raw bytes and records formal_acceptance=false", () => {
    const digest = createHash("sha256").update(fixtureBytes).digest("hex");
    expect(fixtureBytes.byteLength).toBe(33863);
    expect(digest).toBe(W2_INTEROP_FIXTURE_SHA256);
    expect(digest).toBe("f8033a902af06b005fa591ab872a74f9569a3783fd3e7cef90c6dc94cf9d0fef");
    expect(fixture.fixture_id).toBe("W2_INTEROP_GOLDEN_V1");
    expect(fixture.formal_acceptance).toBe(false);
    expect(fixture.formal_t01_t27).toBe("NOT_RUN_NOT_ACCEPTED");
    expect(fixture.experimental_v3_enabled_default).toBe(false);
    expect(fixture.mount_production_http).toBe("forbidden");
  });
});

describe("W2 interop adapters stay default-off when flags are unset", () => {
  it("does not enable v2/v3 flags or any of the five adapter groups", async () => {
    expect(flagUnset("OPENBOT_KNOWLEDGE_SDK_V2_ENABLED")).toBe(true);
    expect(flagUnset("EXPERIMENTAL_V3_ENABLED")).toBe(true);
    expect(MODELS_EMBED_PROXY_ENABLED_DEFAULT).toBe(false);
    expect(AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT).toBe(false);
    expect(SEMANTIC_OBJECT_CATALOG_READ_ADAPTER_ENABLED_DEFAULT).toBe(false);
    expect(REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT).toBe(false);
    expect(CONTROLLED_DATA_BRIDGE_UNLOCKED).toBe(false);

    const embed = await createControlledModelsEmbedProxy().embed({
      tenant_id: "syn_org",
      policy_generation: 7,
      provider: { track: MODELS_EMBED_PROVIDER_TRACK, id: "slot:embed" },
      inputs: ["syn alpha"],
    });
    expect(embed).toEqual({ ok: false, reason: "PROXY_DISABLED" });

    const trace = createAiExecutionTraceHeaderPropagator().propagate({
      tenant_id: "syn_org",
      user_id: "syn_user",
      agent_id: "syn_agent",
      trace_id: "syn_trace",
      run_id: "syn_run",
      plan_id: "syn_plan",
      policy_generation: 7,
    });
    expect(trace).toEqual({ ok: false, reason: "PROPAGATOR_DISABLED", missing: [] });

    const catalog = await createSemanticObjectCatalogReadAdapter({
      reader: { listByTenant: async () => [] },
    }).read({ tenant_id: "syn_org", policy_generation: 7 });
    expect(catalog).toEqual({ ok: false, reason: "ADAPTER_DISABLED" });

    const interopCatalog = createInteropSemanticCatalog({ seed: fixture.catalog_seed });
    expect(interopCatalog.enabled).toBe(false);
    expect(await interopCatalog.read({ tenant_id: "syn_org" })).toMatchObject({
      ok: false,
      error: "ADAPTER_DISABLED",
      disk_writes: 0,
    });

    expect(createRevocationPurgeReceiptValidator().check({} as never)).toEqual({
      ok: false,
      reason: "VALIDATOR_DISABLED",
    });

    expect(
      evaluateControlledDataBridge({
        mode: "A",
        tenant_id: "syn_org",
        policy_generation: 3,
        freshness_ts: "2026-11-27T00:00:00Z",
        masking_receipt: { receipt_id: "syn_mask_1" },
        tombstone: { active: false },
        user_delegation_handle: "deleg:user_token_slot",
        query_kind: "object_get",
      }),
    ).toEqual({ allowed: false, code: "BRIDGE_LOCKED", mode: "A" });
  });
});

describe("G1 models.embed interop (default-off, injected loopback)", () => {
  const proxy = createControlledModelsEmbedProxy({
    enabled: true,
    provider: createLoopbackEmbedProvider(),
    auth: { authorize: () => ({ ok: true, authorizationDecisionId: "syn_auth" }) },
  });

  it("G1-POS-EMBED-LOOPBACK matches fixture vectors via vectors_canonical_json", async () => {
    const c = fixtureCase("G1_MODELS_EMBED", "G1-POS-EMBED-LOOPBACK");
    const input = c.input as {
      tenant_id: string;
      policy_generation: number;
      provider: { handle: string; track: string };
      inputs: string[];
    };
    const result = await proxy.embed({
      tenant_id: input.tenant_id,
      policy_generation: input.policy_generation,
      provider: {
        track: MODELS_EMBED_PROVIDER_TRACK,
        id: input.provider.handle,
      },
      inputs: input.inputs,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const expectedVectors = JSON.parse(String(c.expected.vectors_canonical_json)) as number[][];
    expect(result.tenant_id).toBe(c.expected.tenant_id);
    expect(result.dim).toBe(c.expected.dim);
    expect(result.provider).toEqual({
      track: MODELS_EMBED_PROVIDER_TRACK,
      id: "slot:embed",
      model: "loopback-sha256-8",
    });
    expect(result.vectors).toHaveLength(expectedVectors.length);
    for (let i = 0; i < expectedVectors.length; i += 1) {
      expect(result.vectors[i]).toHaveLength(expectedVectors[i].length);
      for (let j = 0; j < expectedVectors[i].length; j += 1) {
        expect(Math.abs(result.vectors[i][j] - expectedVectors[i][j])).toBeLessThan(1e-12);
      }
    }
  });

  it("G1-NEG-EMBED-IMPLICIT-NETWORK rejects URL tokens as CREDENTIAL_FORBIDDEN", async () => {
    const c = fixtureCase("G1_MODELS_EMBED", "G1-NEG-EMBED-IMPLICIT-NETWORK");
    const input = c.input as {
      tenant_id: string;
      policy_generation: number;
      provider: { handle: string; track: string };
      inputs: string[];
    };
    const result = await proxy.embed({
      tenant_id: input.tenant_id,
      policy_generation: input.policy_generation,
      provider: {
        track: MODELS_EMBED_PROVIDER_TRACK,
        id: input.provider.handle,
      },
      inputs: input.inputs,
    });
    expect(result).toEqual({ ok: false, reason: "CREDENTIAL_FORBIDDEN" });
    expect((c.expected as { error: string }).error).toBe("CREDENTIAL_FORBIDDEN");
  });
});

describe("G2 AIExecutionTrace seven-key hop interop", () => {
  it("G2-POS-SEVEN-KEY-HOP preserves official keys, X-V21 headers, hop_count 3, and binds extra", () => {
    const c = fixtureCase("G2_AI_EXECUTION_TRACE", "G2-POS-SEVEN-KEY-HOP");
    const result = runSevenKeyHops({
      trace: c.input.trace as Record<string, unknown>,
      hop_payloads: (c.input.hop_payloads as Record<string, unknown>[]) ?? [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.hop_count).toBe(c.expected.hop_count);
    expect(result.key_order).toEqual(c.expected.key_order);
    expect([...AI_EXECUTION_TRACE_HEADER_KEYS]).toEqual(c.expected.key_order);
    expect(result.headers).toEqual(c.expected.headers);
    expect(result.seven_keys).toEqual(c.expected.seven_keys);
    expect(result.final_bound).toEqual(c.expected.final_bound);
  });

  it("G2-NEG-MISSING-RUN-ID returns VALIDATION_ERROR", () => {
    const c = fixtureCase("G2_AI_EXECUTION_TRACE", "G2-NEG-MISSING-RUN-ID");
    const result = runSevenKeyHops({
      trace: c.input.trace as Record<string, unknown>,
    });
    expect(result).toEqual({ ok: false, error: "VALIDATION_ERROR" });
    expect((c.expected as { error: string }).error).toBe("VALIDATION_ERROR");
  });
});

describe("G3 SemanticObjectCatalog read-only interop (memory seed, no disk write)", () => {
  const catalog = createInteropSemanticCatalog({
    enabled: true,
    seed: fixture.catalog_seed,
  });

  it("G3-POS-READONLY-REDACTED redacts dsn/password and does not open a filesystem path", async () => {
    const c = fixtureCase("G3_SEMANTIC_OBJECT_CATALOG", "G3-POS-READONLY-REDACTED");
    const result = await catalog.read({
      tenant_id: String(c.input.tenant_id),
      semantic_object_key: String(c.input.semantic_object_key),
    });
    expect(result).toMatchObject({
      ok: true,
      classification: "internal",
      concept_ids: ["concept.invoice"],
      policy_clause_ids: ["policy.retention"],
      semantic_object_key: "semobj:openbot:finance.invoice",
      tenant_id: "syn_org",
      writable: false,
      disk_writes: 0,
    });
    expect((result as { redacted_fields: string[] }).redacted_fields.toSorted()).toEqual(
      (c.expected.redacted_fields as string[]).slice().toSorted(),
    );
    expect(JSON.stringify(result)).not.toContain("postgresql://");
    expect(JSON.stringify(result)).not.toContain("REDACTED-NOT-A-REAL-SECRET");
    expect(catalog.diskWrites()).toBe(0);
  });

  it("G3-NEG-WRITE-FORBIDDEN returns SEMANTIC_WRITE_FORBIDDEN with disk_writes=0", async () => {
    const c = fixtureCase("G3_SEMANTIC_OBJECT_CATALOG", "G3-NEG-WRITE-FORBIDDEN");
    const result = await catalog.write(c.input.payload);
    expect(result).toEqual({
      ok: false,
      error: "SEMANTIC_WRITE_FORBIDDEN",
      disk_writes: 0,
    });
    expect(catalog.diskWrites()).toBe(0);
    expect((c.expected as { error: string }).error).toBe("SEMANTIC_WRITE_FORBIDDEN");
  });
});

describe("G4 CogniWeave revocation receipt interop (canonical JSON SHA-256)", () => {
  it("matches Team A canonicalization probes P1–P4 byte-for-byte", () => {
    for (const probe of fixture.canonicalization.probes) {
      expect(canonicalJsonText(probe.input)).toBe(probe.canonical_json);
      expect(canonicalSha256Hex(probe.input)).toBe(probe.sha256);
    }
  });

  it("G4-POS-FOUR-CHANNEL-SUCCESS receipt_hash is the hard expected digest", () => {
    const c = fixtureCase("G4_COGNIWEAVE_REVOCATION", "G4-POS-FOUR-CHANNEL-SUCCESS");
    const receipt = buildFourChannelReceipt(
      c.input as {
        task_id: string;
        tenant_id: string;
        subject_id: string;
        policy_generation: number;
        failures?: Record<string, string>;
      },
    );
    expect(receipt.receipt_hash).toBe(
      "f4055894fdebb0fc55ae563aaed03ab6f4162b53c4eeab31ad479f6c6707b476",
    );
    expect(receipt.receipt_hash).toBe(c.expected.receipt_hash);
    expect(receipt.purged).toBe(true);
    expect(canonicalJsonText({ ...receipt, receipt_hash: undefined })).toBe(
      c.expected.parent_canonical_json,
    );
    // Dropping only the top-level receipt_hash must not drop in-channel hashes.
    expect(canonicalJsonText(receipt).includes('"receipt_hash":"f4055894')).toBe(true);
    expect(computeRevocationPurgeReceiptHash(receipt)).toBe(receipt.receipt_hash);
    const check = createRevocationPurgeReceiptValidator({ enabled: true }).check(receipt);
    expect(check).toEqual({ ok: true, receipt });
  });

  it("G4-POS-CHANNEL-TIMEOUT-NOT-PURGED receipt_hash is the hard expected digest", () => {
    const c = fixtureCase("G4_COGNIWEAVE_REVOCATION", "G4-POS-CHANNEL-TIMEOUT-NOT-PURGED");
    const receipt = buildFourChannelReceipt(
      c.input as {
        task_id: string;
        tenant_id: string;
        subject_id: string;
        policy_generation: number;
        failures?: Record<string, string>;
      },
    );
    expect(receipt.receipt_hash).toBe(
      "6e8c7f178ec452b590e0d0f06defa0a2c21c0fac5c6a672a356a02b31470f0d0",
    );
    expect(receipt.receipt_hash).toBe(c.expected.receipt_hash);
    expect(receipt.purged).toBe(false);
    expect(receipt.channels[3]?.status).toBe("timeout");
    expect(receipt.channels[3]?.receipt_hash).toBe(
      "dfc7a5ab9698ff82c2defd1ade99e19477a5f10206e001a7147337b0dfcadec2",
    );
    expect(canonicalJsonText({ ...receipt, receipt_hash: undefined })).toBe(
      c.expected.parent_canonical_json,
    );
    expect(computeRevocationPurgeReceiptHash(receipt)).toBe(receipt.receipt_hash);
    const check = createRevocationPurgeReceiptValidator({ enabled: true }).check(receipt);
    expect(check).toEqual({ ok: true, receipt });
  });
});

describe("G5 ControlledDataBridgeGuard Fail-Closed interop", () => {
  it("keeps CONTROLLED_DATA_BRIDGE_UNLOCKED=false for every case", () => {
    expect(CONTROLLED_DATA_BRIDGE_UNLOCKED).toBe(false);
  });

  for (const pos of ["G5-POS-MODE-A", "G5-POS-MODE-B", "G5-POS-MODE-C"] as const) {
    it(`${pos} is structurally valid and stays BRIDGE_LOCKED (not executed)`, () => {
      const c = fixtureCase("G5_CONTROLLED_DATA_BRIDGE", pos);
      const declaration = c.input.declaration as ControlledDataBridgeDeclaration;
      const decision = evaluateControlledDataBridge(declaration, c.input.query);
      expect(declaration.mode).toBe(c.expected.mode);
      expect(declaration.query_kind).toBe(c.expected.query_kind);
      expect(decision).toEqual({
        allowed: false,
        code: "BRIDGE_LOCKED",
        mode: c.expected.mode,
      });
    });
  }

  it("G5-NEG-TOMBSTONE returns UNAUTHORIZED", () => {
    const c = fixtureCase("G5_CONTROLLED_DATA_BRIDGE", "G5-NEG-TOMBSTONE");
    const decision = evaluateControlledDataBridge(
      c.input.declaration as ControlledDataBridgeDeclaration,
      c.input.query,
    );
    expect(decision).toEqual({ allowed: false, code: "UNAUTHORIZED", mode: "A" });
    expect((c.expected as { error: string }).error).toBe("UNAUTHORIZED");
  });

  for (const neg of [
    "G5-NEG-TEXT-TO-SQL-SQL",
    "G5-NEG-TEXT-TO-SQL-FLAG",
    "G5-NEG-TEXT-TO-SQL-KIND",
  ] as const) {
    it(`${neg} returns TEXT_TO_SQL_FORBIDDEN`, () => {
      const c = fixtureCase("G5_CONTROLLED_DATA_BRIDGE", neg);
      const decision = evaluateControlledDataBridge(
        c.input.declaration as ControlledDataBridgeDeclaration,
        c.input.query,
      );
      expect(decision).toEqual({ allowed: false, code: "TEXT_TO_SQL_FORBIDDEN" });
      expect((c.expected as { error: string }).error).toBe("TEXT_TO_SQL_FORBIDDEN");
    });
  }

  it("G5-NEG-MODE-UNMATCHED returns MODE_UNMATCHED", () => {
    const c = fixtureCase("G5_CONTROLLED_DATA_BRIDGE", "G5-NEG-MODE-UNMATCHED");
    const decision = evaluateControlledDataBridge(
      c.input.declaration as ControlledDataBridgeDeclaration,
      c.input.query,
    );
    expect(decision).toEqual({ allowed: false, code: "MODE_UNMATCHED" });
    expect((c.expected as { error: string }).error).toBe("MODE_UNMATCHED");
  });
});
