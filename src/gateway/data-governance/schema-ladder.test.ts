import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as dataGovernanceBarrel from "./index.js";
import { lookupProducerClaimSupport, parseProducerModelMatrix } from "./producer-model-matrix.js";
import { PORTABLE_READER_ID, SCHEMA_TRANSFORM_MEDIA_TYPE } from "./schema-ladder-reader.js";
import {
  applySchemaLadderStep,
  defaultPortableReaderManifest,
  denyMergedLadder,
  envelopeV1ToV2LadderEntry,
  envelopeV1ToV2TransformBytes,
  parseSchemaLadder,
  refuseMtimeAsTruth,
  refuseRedistillationAsLadder,
  resolveLadderPath,
} from "./schema-ladder.js";
import type { ProducerModelMatrixEntry, RedistillationReceipt } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readerFixture() {
  const readerBytes = fs.readFileSync(path.join(here, "schema-ladder-reader.ts"));
  return {
    readerBytes,
    reader: defaultPortableReaderManifest(sha256(readerBytes)),
  };
}

function flaggedProducerMatrix(): ProducerModelMatrixEntry[] {
  const parsed = parseProducerModelMatrix([
    {
      producerModelId: "producer-legacy",
      schemaVersion: "1",
      claimSupport: "flagged",
    },
    {
      producerModelId: "producer-legacy",
      schemaVersion: "2",
      claimSupport: "unsupported",
    },
  ]);
  if (!parsed) {
    throw new Error("expected producer matrix");
  }
  return parsed;
}

describe("P5-a schema ladder", () => {
  it("applies bundled v1→v2 transform bytes and emits a schema migration receipt", () => {
    const { reader, readerBytes } = readerFixture();
    const transformBytes = envelopeV1ToV2TransformBytes();
    const entry = envelopeV1ToV2LadderEntry(transformBytes);
    const result = applySchemaLadderStep({
      document: { schemaVersion: 1, title: "note" },
      entry,
      transformBytes,
      reader,
      readerBytes,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.document.schemaVersion).toBe(2);
    expect(result.value.document.title).toBe("note");
    expect(result.value.receipt).toMatchObject({
      kind: "p5_schema_migration_receipt",
      fromSchemaVersion: "1",
      toSchemaVersion: "2",
      transformId: "envelope-v1-to-v2",
      transformChecksum: sha256(transformBytes),
      state: "applied",
    });
    expect(result.value.receipt.kind).not.toBe("p5_redistillation_receipt");
  });

  it("refuses transformId-only execution", () => {
    const { reader, readerBytes } = readerFixture();
    const transformBytes = envelopeV1ToV2TransformBytes();
    expect(
      applySchemaLadderStep({
        document: { schemaVersion: 1 },
        entry: envelopeV1ToV2LadderEntry(transformBytes),
        transformBytes,
        reader,
        readerBytes,
        transformIdOnly: true,
      }),
    ).toEqual({ ok: false, error: "transform_id_not_executable" });
  });

  it("refuses empty transform bytes", () => {
    const { reader, readerBytes } = readerFixture();
    const transformBytes = envelopeV1ToV2TransformBytes();
    expect(
      applySchemaLadderStep({
        document: { schemaVersion: 1 },
        entry: envelopeV1ToV2LadderEntry(transformBytes),
        transformBytes: Buffer.alloc(0),
        reader,
        readerBytes,
      }),
    ).toEqual({ ok: false, error: "transform_bytes_missing" });
  });

  it("refuses a transform checksum mismatch", () => {
    const { reader, readerBytes } = readerFixture();
    const transformBytes = envelopeV1ToV2TransformBytes();
    const entry = envelopeV1ToV2LadderEntry(transformBytes);
    expect(
      applySchemaLadderStep({
        document: { schemaVersion: 1 },
        entry: { ...entry, transformChecksum: "0".repeat(64) },
        transformBytes,
        reader,
        readerBytes,
      }),
    ).toEqual({ ok: false, error: "transform_checksum_mismatch" });
  });

  it("refuses a missing portable reader artifact", () => {
    const { reader } = readerFixture();
    const transformBytes = envelopeV1ToV2TransformBytes();
    expect(
      applySchemaLadderStep({
        document: { schemaVersion: 1 },
        entry: envelopeV1ToV2LadderEntry(transformBytes),
        transformBytes,
        reader,
        readerBytes: Buffer.alloc(0),
      }),
    ).toEqual({ ok: false, error: "portable_reader_missing" });
  });

  it("refuses a portable reader checksum mismatch", () => {
    const { reader, readerBytes } = readerFixture();
    const transformBytes = envelopeV1ToV2TransformBytes();
    expect(
      applySchemaLadderStep({
        document: { schemaVersion: 1 },
        entry: envelopeV1ToV2LadderEntry(transformBytes),
        transformBytes,
        reader: { ...reader, readerChecksum: "1".repeat(64) },
        readerBytes,
      }),
    ).toEqual({ ok: false, error: "portable_reader_checksum_mismatch" });
  });

  it("blocks a downgrade that loses cognitive fields", () => {
    const ladder = parseSchemaLadder([
      {
        fromSchemaVersion: "2",
        toSchemaVersion: "1",
        transformId: "envelope-v2-to-v1",
        transformMediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
        transformMember: "transforms/envelope-v2-to-v1.json",
        transformChecksum: "a".repeat(64),
        losesCognitiveFields: true,
      },
    ]);
    expect(ladder).not.toBeNull();
    expect(
      resolveLadderPath({
        fromSchemaVersion: "2",
        toSchemaVersion: "1",
        ladder: ladder!,
      }),
    ).toEqual({ ok: false, error: "catalog_schema_downgrade_blocked" });

    const { reader, readerBytes } = readerFixture();
    const transformBytes = Buffer.from(
      `${JSON.stringify({
        mediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
        fromSchemaVersion: "2",
        toSchemaVersion: "1",
        ops: [{ op: "set", path: "/schemaVersion", value: 1 }],
      })}\n`,
      "utf8",
    );
    expect(
      applySchemaLadderStep({
        document: { schemaVersion: 2, cognitiveTier: "C2" },
        entry: {
          fromSchemaVersion: "2",
          toSchemaVersion: "1",
          transformId: "envelope-v2-to-v1",
          transformMediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
          transformMember: "transforms/envelope-v2-to-v1.json",
          transformChecksum: sha256(transformBytes),
          losesCognitiveFields: true,
        },
        transformBytes,
        reader,
        readerBytes,
      }),
    ).toEqual({ ok: false, error: "catalog_schema_downgrade_blocked" });
  });

  it("rejects a ladder row merged with the producer-model matrix", () => {
    expect(
      denyMergedLadder([
        {
          fromSchemaVersion: "1",
          toSchemaVersion: "2",
          transformId: "envelope-v1-to-v2",
          transformMediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
          transformMember: "transforms/envelope-v1-to-v2.json",
          transformChecksum: "b".repeat(64),
          losesCognitiveFields: false,
          producerModelId: "producer-legacy",
          claimSupport: "supported",
        },
      ]),
    ).toEqual({ ok: false, error: "ladder_merged_with_producer_matrix" });
    expect(
      parseSchemaLadder([
        {
          fromSchemaVersion: "1",
          toSchemaVersion: "2",
          transformId: "envelope-v1-to-v2",
          transformMediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
          transformMember: "transforms/envelope-v1-to-v2.json",
          transformChecksum: "b".repeat(64),
          losesCognitiveFields: false,
          producerModelId: "producer-legacy",
        },
      ]),
    ).toBeNull();
  });

  it("refuses a redistillation receipt as a ladder step", () => {
    const receipt: RedistillationReceipt = {
      kind: "p5_redistillation_receipt",
      receiptId: "rd_1",
      sourceSchemaVersion: "1",
      producerModelId: "producer-legacy",
      state: "applied",
    };
    expect(refuseRedistillationAsLadder(receipt)).toEqual({
      ok: false,
      error: "migration_kind_mismatch",
    });
  });

  it("does not let flagged or unsupported producer claims block representation migration", () => {
    const matrix = flaggedProducerMatrix();
    expect(
      lookupProducerClaimSupport({
        matrix,
        producerModelId: "producer-legacy",
        schemaVersion: "1",
      }),
    ).toEqual({ ok: true, claimSupport: "flagged" });
    expect(
      lookupProducerClaimSupport({
        matrix,
        producerModelId: "producer-legacy",
        schemaVersion: "2",
      }),
    ).toEqual({ ok: true, claimSupport: "unsupported" });

    const { reader, readerBytes } = readerFixture();
    const transformBytes = envelopeV1ToV2TransformBytes();
    const migrated = applySchemaLadderStep({
      document: { schemaVersion: 1, producerModelId: "producer-legacy" },
      entry: envelopeV1ToV2LadderEntry(transformBytes),
      transformBytes,
      reader,
      readerBytes,
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) {
      return;
    }
    expect(migrated.value.receipt.kind).toBe("p5_schema_migration_receipt");
    expect(migrated.value.document.schemaVersion).toBe(2);
  });

  it("rejects a producer matrix row that carries ladder fields", () => {
    expect(
      parseProducerModelMatrix([
        {
          producerModelId: "producer-legacy",
          schemaVersion: "1",
          claimSupport: "supported",
          fromSchemaVersion: "1",
          transformId: "envelope-v1-to-v2",
        },
      ]),
    ).toBeNull();
  });

  it("forbids mtime as migration truth", () => {
    expect(refuseMtimeAsTruth()).toEqual({ ok: false, error: "mtime_truth_forbidden" });
  });

  it("keeps ladder source free of producer-matrix, promotion, and mtime truth", () => {
    const source = fs.readFileSync(path.join(here, "schema-ladder.ts"), "utf8");
    for (const token of [
      "producer-model-matrix",
      "decideShadowPromotion",
      "fs.stat",
      "statSync",
      "mtimeMs",
      "mtime:",
      "child_process",
      "spawnSync",
    ]) {
      expect(source.includes(token), token).toBe(false);
    }
  });

  it("does not invoke the original application build from the portable reader", () => {
    const source = fs.readFileSync(path.join(here, "schema-ladder-reader.ts"), "utf8");
    for (const token of ["child_process", "spawn", "dist/", "apps/", "openbot-gateway"]) {
      expect(source.includes(token), token).toBe(false);
    }
    expect(PORTABLE_READER_ID).toBe("p5-portable-reference-importer");
  });

  it("does not export store internals from the barrel", () => {
    expect(dataGovernanceBarrel).not.toHaveProperty("getPlacementExportReceipt");
    expect(dataGovernanceBarrel).toHaveProperty("applySchemaLadderStep");
    expect(dataGovernanceBarrel).toHaveProperty("parseProducerModelMatrix");
    expect(dataGovernanceBarrel).toHaveProperty("PORTABLE_READER_ID");
  });
});
