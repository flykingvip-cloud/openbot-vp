import { describe, expect, it, vi } from "vitest";
import { sha256, signRequest, KnowledgeSdkClient } from "./client.js";
import { adapterConfigFromEnv } from "./config.js";
import hashes from "./fixtures/hash-vectors-utf8.json";
import signatures from "./fixtures/signed-request-canonicalization.json";
import { detachKnowledgeReference } from "./references.js";
import { normalizeTextPythonCompat } from "./uri-mapping.js";
describe("M1 frozen vectors", () => {
  it.each(hashes.cases)("hash $id", (row) => {
    expect(sha256(row.raw)).toBe(row.raw_hash);
    expect(normalizeTextPythonCompat(row.raw)).toBe(row.normalized);
    expect(sha256(normalizeTextPythonCompat(row.raw))).toBe(row.semantic_hash);
  });
  it.each(signatures.cases)("signature $id", (row) => {
    expect(
      signRequest(
        {
          method: row.method,
          target: row.signed_target,
          actorHeader: signatures.actor_header,
          timestamp: signatures.timestamp,
          nonce: row.nonce,
          body: row.body_utf8,
          agentHeader: row.agent_header_present ? signatures.agent_header : undefined,
          purpose: row.purpose_header_present ? row.purpose : undefined,
        },
        signatures.test_only_secret,
      ),
    ).toBe(row.signature);
  });
  it("defaults disabled", () => expect(adapterConfigFromEnv({}).enabled).toBe(false));
  it("rejects production even explicitly enabled", async () => {
    const transport = vi.fn<typeof fetch>();
    const client = new KnowledgeSdkClient(
      {
        ...adapterConfigFromEnv({
          NODE_ENV: "production",
          OPENBOT_KNOWLEDGE_SDK_V2_ENABLED: "true",
        }),
        allowedTenantIds: ["tenant"],
      },
      transport,
    );
    await expect(
      client.request(
        "/v2/search",
        "POST",
        {
          issuer: "idp",
          subjectId: "user",
          tenantId: "tenant",
          policyGeneration: 1,
          actorType: "human",
          agentId: "agent",
          requestId: "req",
        },
        {},
      ),
    ).rejects.toThrow("SDK_PATH_DISABLED");
    expect(transport).not.toHaveBeenCalled();
  });
});

it("detach removes one reference while retaining other spaces and source asset", () => {
  const asset = { id: "doc", archived: false };
  const references = [
    { spaceId: "one", assetId: asset.id },
    { spaceId: "two", assetId: asset.id },
  ];
  expect(detachKnowledgeReference(references, "one", asset.id)).toEqual([references[1]]);
  expect(asset.archived).toBe(false);
  expect(references).toHaveLength(2);
});
it("covers all Python whitespace and retains BOM", () => {
  const codes = [
    9,
    10,
    11,
    12,
    13,
    28,
    29,
    30,
    31,
    32,
    133,
    160,
    5760,
    ...Array.from({ length: 11 }, (_, i) => 8192 + i),
    8232,
    8233,
    8239,
    8287,
    12288,
  ];
  expect(codes).toHaveLength(29);
  for (const code of codes) {
    expect(normalizeTextPythonCompat("A" + String.fromCodePoint(code) + "B")).toBe("A B");
  }
  expect(normalizeTextPythonCompat("\ufeffA\ufeff")).toBe("\ufeffA\ufeff");
});
