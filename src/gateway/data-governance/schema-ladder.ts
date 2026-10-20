/**
 * P5-a schema migration ladder. Representation transforms only.
 * Not a producer-model matrix, not redistillation, not a P5 longevity bundle.
 * Does not use filesystem mtimes. Does not invoke the original app build.
 */
import { createHash } from "node:crypto";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import {
  applySchemaTransformOps,
  parseSchemaTransformDocument,
  PORTABLE_READER_ID,
  PORTABLE_READER_VERSION,
  SCHEMA_TRANSFORM_MEDIA_TYPE,
} from "./schema-ladder-reader.js";
import type {
  PortableReaderManifest,
  RedistillationReceipt,
  SchemaLadderEntry,
  SchemaMigrationReceipt,
} from "./types.js";

export type SchemaLadderDenyCode =
  | "transform_bytes_missing"
  | "transform_checksum_mismatch"
  | "transform_id_not_executable"
  | "portable_reader_missing"
  | "portable_reader_checksum_mismatch"
  | "catalog_schema_downgrade_blocked"
  | "ladder_path_missing"
  | "ladder_merged_with_producer_matrix"
  | "migration_kind_mismatch"
  | "mtime_truth_forbidden"
  | "invalid_transform";

export type SchemaLadderResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SchemaLadderDenyCode };

const LADDER_KEYS = new Set([
  "fromSchemaVersion",
  "toSchemaVersion",
  "transformId",
  "transformMediaType",
  "transformMember",
  "transformChecksum",
  "losesCognitiveFields",
]);

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseSchemaLadder(value: unknown): SchemaLadderEntry[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const entries: SchemaLadderEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return null;
    }
    const raw = row as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      if (!LADDER_KEYS.has(key)) {
        return null;
      }
    }
    if (
      "producerModelId" in raw ||
      "claimSupport" in raw ||
      typeof raw.fromSchemaVersion !== "string" ||
      raw.fromSchemaVersion.trim() === "" ||
      typeof raw.toSchemaVersion !== "string" ||
      raw.toSchemaVersion.trim() === "" ||
      typeof raw.transformId !== "string" ||
      raw.transformId.trim() === "" ||
      raw.transformMediaType !== SCHEMA_TRANSFORM_MEDIA_TYPE ||
      typeof raw.transformMember !== "string" ||
      raw.transformMember.trim() === "" ||
      typeof raw.transformChecksum !== "string" ||
      raw.transformChecksum.trim() === "" ||
      typeof raw.losesCognitiveFields !== "boolean"
    ) {
      return null;
    }
    entries.push({
      fromSchemaVersion: raw.fromSchemaVersion,
      toSchemaVersion: raw.toSchemaVersion,
      transformId: raw.transformId,
      transformMediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
      transformMember: raw.transformMember,
      transformChecksum: raw.transformChecksum,
      losesCognitiveFields: raw.losesCognitiveFields,
    });
  }
  return entries;
}

export function parsePortableReaderManifest(value: unknown): PortableReaderManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "p5_portable_reference_importer") {
    return null;
  }
  if (typeof raw.readerId !== "string" || raw.readerId.trim() === "") {
    return null;
  }
  if (typeof raw.version !== "string" || raw.version.trim() === "") {
    return null;
  }
  if (typeof raw.readerMember !== "string" || raw.readerMember.trim() === "") {
    return null;
  }
  if (typeof raw.readerChecksum !== "string" || raw.readerChecksum.trim() === "") {
    return null;
  }
  const types = raw.supportedTransformMediaTypes;
  if (!Array.isArray(types) || types.length !== 1 || types[0] !== SCHEMA_TRANSFORM_MEDIA_TYPE) {
    return null;
  }
  return {
    kind: "p5_portable_reference_importer",
    readerId: raw.readerId,
    version: raw.version,
    readerMember: raw.readerMember,
    readerChecksum: raw.readerChecksum,
    supportedTransformMediaTypes: [SCHEMA_TRANSFORM_MEDIA_TYPE],
  };
}

export function defaultPortableReaderManifest(readerChecksum: string): PortableReaderManifest {
  return {
    kind: "p5_portable_reference_importer",
    readerId: PORTABLE_READER_ID,
    version: PORTABLE_READER_VERSION,
    readerMember: "readers/p5_portable_reference_importer.js",
    readerChecksum,
    supportedTransformMediaTypes: [SCHEMA_TRANSFORM_MEDIA_TYPE],
  };
}

export function resolveLadderPath(params: {
  fromSchemaVersion: string;
  toSchemaVersion: string;
  ladder: readonly SchemaLadderEntry[];
}): SchemaLadderResult<SchemaLadderEntry[]> {
  if (params.fromSchemaVersion === params.toSchemaVersion) {
    return { ok: true, value: [] };
  }
  const byFrom = new Map<string, SchemaLadderEntry[]>();
  for (const step of params.ladder) {
    const list = byFrom.get(step.fromSchemaVersion) ?? [];
    list.push(step);
    byFrom.set(step.fromSchemaVersion, list);
  }
  const queue: { version: string; path: SchemaLadderEntry[] }[] = [
    { version: params.fromSchemaVersion, path: [] },
  ];
  const seen = new Set<string>([params.fromSchemaVersion]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const step of byFrom.get(current.version) ?? []) {
      if (seen.has(step.toSchemaVersion)) {
        continue;
      }
      if (step.losesCognitiveFields && step.toSchemaVersion < step.fromSchemaVersion) {
        return { ok: false, error: "catalog_schema_downgrade_blocked" };
      }
      const nextPath = [...current.path, step];
      if (step.toSchemaVersion === params.toSchemaVersion) {
        return { ok: true, value: nextPath };
      }
      seen.add(step.toSchemaVersion);
      queue.push({ version: step.toSchemaVersion, path: nextPath });
    }
  }
  const destructive = params.ladder.find(
    (step) =>
      step.fromSchemaVersion === params.fromSchemaVersion &&
      step.toSchemaVersion === params.toSchemaVersion &&
      step.losesCognitiveFields,
  );
  if (destructive) {
    return { ok: false, error: "catalog_schema_downgrade_blocked" };
  }
  return { ok: false, error: "ladder_path_missing" };
}

export function denyMergedLadder(value: unknown): SchemaLadderResult<SchemaLadderEntry[]> {
  if (
    Array.isArray(value) &&
    value.some(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        ("claimSupport" in row || "producerModelId" in row),
    )
  ) {
    return { ok: false, error: "ladder_merged_with_producer_matrix" };
  }
  const parsed = parseSchemaLadder(value);
  if (!parsed) {
    return { ok: false, error: "invalid_transform" };
  }
  return { ok: true, value: parsed };
}

export function applySchemaLadderStep(params: {
  document: Record<string, unknown>;
  entry: SchemaLadderEntry;
  transformBytes: Buffer;
  reader: PortableReaderManifest;
  readerBytes: Buffer;
  transformIdOnly?: boolean;
}): SchemaLadderResult<{ document: Record<string, unknown>; receipt: SchemaMigrationReceipt }> {
  if (params.transformIdOnly) {
    return { ok: false, error: "transform_id_not_executable" };
  }
  if (params.transformBytes.length === 0) {
    return { ok: false, error: "transform_bytes_missing" };
  }
  if (sha256(params.transformBytes) !== params.entry.transformChecksum) {
    return { ok: false, error: "transform_checksum_mismatch" };
  }
  if (params.reader.kind !== "p5_portable_reference_importer") {
    return { ok: false, error: "portable_reader_missing" };
  }
  if (params.readerBytes.length === 0) {
    return { ok: false, error: "portable_reader_missing" };
  }
  if (sha256(params.readerBytes) !== params.reader.readerChecksum) {
    return { ok: false, error: "portable_reader_checksum_mismatch" };
  }
  if (!params.reader.supportedTransformMediaTypes.includes(params.entry.transformMediaType)) {
    return { ok: false, error: "invalid_transform" };
  }
  if (
    params.entry.losesCognitiveFields &&
    params.entry.toSchemaVersion < params.entry.fromSchemaVersion
  ) {
    return { ok: false, error: "catalog_schema_downgrade_blocked" };
  }
  const transform = parseSchemaTransformDocument(params.transformBytes);
  if (
    !transform ||
    transform.fromSchemaVersion !== params.entry.fromSchemaVersion ||
    transform.toSchemaVersion !== params.entry.toSchemaVersion
  ) {
    return { ok: false, error: "invalid_transform" };
  }
  const next = applySchemaTransformOps(params.document, transform);
  if (!next) {
    return { ok: false, error: "invalid_transform" };
  }
  const contentChecksum = sha256(Buffer.from(canonicalizeCognitiveJson(next), "utf8"));
  const receipt: SchemaMigrationReceipt = {
    kind: "p5_schema_migration_receipt",
    receiptId: `smr_${sha256(
      Buffer.from(
        `${params.entry.transformId}\0${params.entry.transformChecksum}\0${contentChecksum}`,
        "utf8",
      ),
    )}`,
    fromSchemaVersion: params.entry.fromSchemaVersion,
    toSchemaVersion: params.entry.toSchemaVersion,
    transformId: params.entry.transformId,
    transformChecksum: params.entry.transformChecksum,
    contentChecksum,
    state: "applied",
  };
  return { ok: true, value: { document: next, receipt } };
}

export function refuseRedistillationAsLadder(
  receipt: RedistillationReceipt,
): SchemaLadderResult<never> {
  if (receipt.kind !== "p5_redistillation_receipt") {
    return { ok: false, error: "invalid_transform" };
  }
  return { ok: false, error: "migration_kind_mismatch" };
}

export function refuseMtimeAsTruth(): SchemaLadderResult<never> {
  return { ok: false, error: "mtime_truth_forbidden" };
}

export function envelopeV1ToV2TransformBytes(): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      {
        mediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
        fromSchemaVersion: "1",
        toSchemaVersion: "2",
        ops: [{ op: "set", path: "/schemaVersion", value: 2 }],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function envelopeV1ToV2LadderEntry(transformBytes: Buffer): SchemaLadderEntry {
  return {
    fromSchemaVersion: "1",
    toSchemaVersion: "2",
    transformId: "envelope-v1-to-v2",
    transformMediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
    transformMember: "transforms/envelope-v1-to-v2.json",
    transformChecksum: sha256(transformBytes),
    losesCognitiveFields: false,
  };
}
