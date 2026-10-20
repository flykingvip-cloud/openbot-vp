/**
 * P5-a portable reference importer (L15). The only executor of schema transforms.
 * The original OpenBot application build is never invoked.
 */
export const SCHEMA_TRANSFORM_MEDIA_TYPE = "application/vnd.openbot.schema-transform+json" as const;

export const PORTABLE_READER_ID = "p5-portable-reference-importer";
export const PORTABLE_READER_VERSION = "1";

export type SchemaTransformOp = {
  op: "set";
  path: string;
  value: unknown;
};

export type SchemaTransformDocument = {
  mediaType: typeof SCHEMA_TRANSFORM_MEDIA_TYPE;
  fromSchemaVersion: string;
  toSchemaVersion: string;
  ops: readonly SchemaTransformOp[];
};

export function parseSchemaTransformDocument(bytes: Buffer): SchemaTransformDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.mediaType !== SCHEMA_TRANSFORM_MEDIA_TYPE) {
    return null;
  }
  if (typeof raw.fromSchemaVersion !== "string" || raw.fromSchemaVersion.trim() === "") {
    return null;
  }
  if (typeof raw.toSchemaVersion !== "string" || raw.toSchemaVersion.trim() === "") {
    return null;
  }
  if (!Array.isArray(raw.ops) || raw.ops.length === 0) {
    return null;
  }
  const ops: SchemaTransformOp[] = [];
  for (const entry of raw.ops) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const op = entry as Record<string, unknown>;
    if (op.op !== "set" || typeof op.path !== "string" || !op.path.startsWith("/")) {
      return null;
    }
    ops.push({ op: "set", path: op.path, value: op.value });
  }
  return {
    mediaType: SCHEMA_TRANSFORM_MEDIA_TYPE,
    fromSchemaVersion: raw.fromSchemaVersion,
    toSchemaVersion: raw.toSchemaVersion,
    ops,
  };
}

export function applySchemaTransformOps(
  document: Record<string, unknown>,
  transform: SchemaTransformDocument,
): Record<string, unknown> | null {
  const next = { ...document };
  for (const op of transform.ops) {
    const key = op.path.slice(1);
    if (key.includes("/") || key === "") {
      return null;
    }
    next[key] = op.value;
  }
  return next;
}
