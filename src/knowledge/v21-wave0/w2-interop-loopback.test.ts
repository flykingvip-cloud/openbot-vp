/**
 * Default-off X-V21-* request-header and canonical JSON loopback contracts.
 * Aligns with the official Wave-V21-2 conventions. Not registered on Gateway.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AI_EXECUTION_TRACE_HEADER_KEYS,
  AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT,
  createAiExecutionTraceHeaderPropagator,
  type AiExecutionTraceHeaders,
} from "./ai-execution-trace-header-propagator.js";
import { canonicalJsonText, canonicalSha256Hex } from "./canonical-json.js";
import { CONTROLLED_DATA_BRIDGE_UNLOCKED } from "./controlled-data-bridge-guard.js";
import { MODELS_EMBED_PROXY_ENABLED_DEFAULT } from "./models-embed-proxy.js";
import {
  computeRevocationPurgeReceiptHash,
  REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT,
} from "./revocation-purge-receipt.js";
import {
  X_V21_HEADER_NAMES,
  buildFourChannelReceipt,
  loopbackCanonicalJson,
  loopbackXv21RequestHeaders,
  parseXv21RequestHeaders,
  projectXv21Headers,
} from "./w2-interop-harness.js";

type FixtureCase = {
  id: string;
  expected: Record<string, unknown>;
  input: Record<string, unknown>;
};

type GoldenFixture = {
  canonicalization: {
    probes: Array<{ id: string; input: unknown; canonical_json: string; sha256: string }>;
  };
  groups: Array<{ id: string; cases: FixtureCase[] }>;
};

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "interop-fixtures", "w2_interop_golden.json"),
    "utf8",
  ),
) as GoldenFixture;

function flagUnset(name: string): boolean {
  const value = process.env[name];
  return value === undefined || value === "" || value === "0" || value === "false";
}

function fixtureCase(groupId: string, caseId: string): FixtureCase {
  const group = fixture.groups.find((item) => item.id === groupId);
  const found = group?.cases.find((item) => item.id === caseId);
  if (!found) {
    throw new Error(`missing ${caseId}`);
  }
  return found;
}

const SEVEN: AiExecutionTraceHeaders = {
  tenant_id: "syn_org",
  user_id: "syn_user",
  agent_id: "syn_agent",
  trace_id: "syn_trace",
  run_id: "syn_run",
  plan_id: "syn_plan",
  policy_generation: 7,
};

describe("default-off X-V21-* request-header and JSON loopback", () => {
  it("stays default-off when flags are unset and is not a Gateway route", () => {
    expect(flagUnset("OPENBOT_KNOWLEDGE_SDK_V2_ENABLED")).toBe(true);
    expect(flagUnset("EXPERIMENTAL_V3_ENABLED")).toBe(true);
    expect(AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT).toBe(false);
    expect(MODELS_EMBED_PROXY_ENABLED_DEFAULT).toBe(false);
    expect(REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT).toBe(false);
    expect(CONTROLLED_DATA_BRIDGE_UNLOCKED).toBe(false);
    expect(createAiExecutionTraceHeaderPropagator().propagate(SEVEN)).toEqual({
      ok: false,
      reason: "PROPAGATOR_DISABLED",
      missing: [],
    });
  });

  it("projects official X-V21-* names in TRACE_KEYS order and loops them back", () => {
    const { outgoing, parsed } = loopbackXv21RequestHeaders(SEVEN);
    expect([...AI_EXECUTION_TRACE_HEADER_KEYS]).toEqual([
      "tenant_id",
      "user_id",
      "agent_id",
      "trace_id",
      "run_id",
      "plan_id",
      "policy_generation",
    ]);
    expect(outgoing).toEqual({
      "X-V21-Tenant-Id": "syn_org",
      "X-V21-User-Id": "syn_user",
      "X-V21-Agent-Id": "syn_agent",
      "X-V21-Trace-Id": "syn_trace",
      "X-V21-Run-Id": "syn_run",
      "X-V21-Plan-Id": "syn_plan",
      "X-V21-Policy-Generation": "7",
    });
    expect(parsed).toEqual(SEVEN);
    const lower = Object.fromEntries(
      Object.entries(outgoing).map(([key, value]) => [key.toLowerCase(), value]),
    );
    expect(parseXv21RequestHeaders(lower)).toEqual(SEVEN);
    const g2 = fixtureCase("G2_AI_EXECUTION_TRACE", "G2-POS-SEVEN-KEY-HOP");
    expect(projectXv21Headers(SEVEN)).toEqual(g2.expected.headers);
  });

  it("canonical JSON loopback is byte-identical for probes P1–P4", () => {
    for (const probe of fixture.canonicalization.probes) {
      const loop = loopbackCanonicalJson(probe.input);
      expect(loop.text).toBe(probe.canonical_json);
      expect(loop.sha256).toBe(probe.sha256);
      expect(loop.textAfterParse).toBe(probe.canonical_json);
      expect(canonicalJsonText(loop.parsed)).toBe(probe.canonical_json);
      expect(canonicalSha256Hex(loop.parsed)).toBe(probe.sha256);
    }
  });

  it("receipt_hash loopback keeps the two hard expected digests", () => {
    const success = fixtureCase("G4_COGNIWEAVE_REVOCATION", "G4-POS-FOUR-CHANNEL-SUCCESS");
    const timeout = fixtureCase("G4_COGNIWEAVE_REVOCATION", "G4-POS-CHANNEL-TIMEOUT-NOT-PURGED");
    const successReceipt = buildFourChannelReceipt(
      success.input as {
        task_id: string;
        tenant_id: string;
        subject_id: string;
        policy_generation: number;
      },
    );
    const timeoutReceipt = buildFourChannelReceipt(
      timeout.input as {
        task_id: string;
        tenant_id: string;
        subject_id: string;
        policy_generation: number;
        failures?: Record<string, string>;
      },
    );
    expect(successReceipt.receipt_hash).toBe(
      "f4055894fdebb0fc55ae563aaed03ab6f4162b53c4eeab31ad479f6c6707b476",
    );
    expect(timeoutReceipt.receipt_hash).toBe(
      "6e8c7f178ec452b590e0d0f06defa0a2c21c0fac5c6a672a356a02b31470f0d0",
    );
    const successLoop = loopbackCanonicalJson({ ...successReceipt, receipt_hash: undefined });
    expect(successLoop.text).toBe(success.expected.parent_canonical_json);
    expect(successLoop.textAfterParse).toBe(success.expected.parent_canonical_json);
    expect(canonicalSha256Hex(successLoop.parsed)).toBe(successReceipt.receipt_hash);
    expect(computeRevocationPurgeReceiptHash(successLoop.parsed as never)).toBe(
      successReceipt.receipt_hash,
    );
    const timeoutLoop = loopbackCanonicalJson({ ...timeoutReceipt, receipt_hash: undefined });
    expect(timeoutLoop.text).toBe(timeout.expected.parent_canonical_json);
    expect(timeoutLoop.textAfterParse).toBe(timeout.expected.parent_canonical_json);
    expect(computeRevocationPurgeReceiptHash(timeoutLoop.parsed as never)).toBe(
      timeoutReceipt.receipt_hash,
    );
  });

  it("lists the official X-V21 header map without inventing Gateway routes", () => {
    expect(X_V21_HEADER_NAMES).toEqual({
      tenant_id: "X-V21-Tenant-Id",
      user_id: "X-V21-User-Id",
      agent_id: "X-V21-Agent-Id",
      trace_id: "X-V21-Trace-Id",
      run_id: "X-V21-Run-Id",
      plan_id: "X-V21-Plan-Id",
      policy_generation: "X-V21-Policy-Generation",
    });
  });
});
