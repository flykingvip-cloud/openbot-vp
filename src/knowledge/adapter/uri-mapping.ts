/** DRAFT reference lookup only. Never grants tenant/content authority. No runtime dependencies. */
import type {
  DualUriMapping,
  VersionCoordinate,
  CanonicalKbUri,
  LegacyKuUri,
  WriteActivationResult,
  PolicyGeneration,
} from "./openbot-adapter-dto.js";
const SEG = "(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+";
const KB = new RegExp(
  "^kb://org/(" + SEG + ")/doc/(" + SEG + ")@([1-9][0-9]*)(?:#(anchor|chunk)=(" + SEG + "))?$",
);
const KU = new RegExp(
  "^ku://kb/(" + SEG + ")/doc/(" + SEG + ")@(" + SEG + ")(?:#(" + SEG + "(?:/" + SEG + ")*))?$",
);
function fail(): never {
  throw new Error("Invalid, missing, mismatched or ambiguous draft URI mapping");
}
export function encodeOpaque(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    hasControl(value) ||
    value.split(/[\\/]/).some((x) => x === "." || x === "..")
  ) {
    return fail();
  }
  try {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  } catch {
    return fail();
  }
}
function decodeOnce(segment: string): string {
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    return fail();
  }
  const norm = (s: string) => s.replace(/%[0-9a-f]{2}/gi, (x) => x.toUpperCase());
  if (norm(encodeOpaque(value)) !== norm(segment)) {
    return fail();
  }
  return value;
}
function kb(uri: string): { tenant: string; doc: string; version: number } {
  if (typeof uri !== "string") {
    return fail();
  }
  const m = KB.exec(uri);
  if (!m) {
    return fail();
  }
  const version = Number(m[3]);
  if (!Number.isSafeInteger(version) || version < 1) {
    return fail();
  }
  if (m[5]) {
    decodeOnce(m[5]);
  }
  return { tenant: decodeOnce(m[1]), doc: decodeOnce(m[2]), version };
}
function ku(uri: string): { space: string; doc: string; versionId: string; sections: string[] } {
  if (typeof uri !== "string") {
    return fail();
  }
  const m = KU.exec(uri);
  if (!m) {
    return fail();
  }
  const sections = m[4] ? m[4].split("/").map(decodeOnce) : [];
  return { space: decodeOnce(m[1]), doc: decodeOnce(m[2]), versionId: decodeOnce(m[3]), sections };
}
function checked(record: DualUriMapping): DualUriMapping {
  if (
    !record ||
    !record.coordinates ||
    !Array.isArray(record.section_path) ||
    Object.keys(record).toSorted().join(",") !==
      "canonical_uri,coordinates,legacy_ku_uri,section_path" ||
    Object.keys(record.coordinates).toSorted().join(",") !==
      "doc_id,kb_id,tenant_id,version,version_id"
  ) {
    return fail();
  }
  const c: VersionCoordinate = record.coordinates,
    a = kb(record.canonical_uri),
    b = ku(record.legacy_ku_uri);
  for (const v of [c.tenant_id, c.kb_id, c.doc_id, c.version_id]) {
    encodeOpaque(v);
  }
  if (
    !Number.isSafeInteger(c.version) ||
    c.version < 1 ||
    a.tenant !== c.tenant_id ||
    a.doc !== c.doc_id ||
    a.version !== c.version ||
    b.space !== c.kb_id ||
    b.doc !== c.doc_id ||
    b.versionId !== c.version_id
  ) {
    return fail();
  }
  // section_path is retained metadata, NOT an inferred anchor or authentication fact.
  const section = record.section_path.map((x) => {
    if (typeof x !== "string" || hasControl(x)) {
      return fail();
    }
    return x;
  });
  if (b.sections.length && JSON.stringify(b.sections) !== JSON.stringify(section)) {
    return fail();
  }
  return Object.freeze({
    coordinates: Object.freeze({ ...c }),
    canonical_uri: record.canonical_uri,
    legacy_ku_uri: record.legacy_ku_uri,
    section_path: Object.freeze(section),
  });
}
function select(
  uri: string,
  records: ReadonlyArray<DualUriMapping>,
  canonical: boolean,
): DualUriMapping {
  if (!Array.isArray(records) || records.length > 1000) {
    return fail();
  }
  if (canonical) {
    kb(uri);
  } else {
    ku(uri);
  }
  const all = records.map(checked);
  if (
    new Set(all.map((r) => r.canonical_uri)).size !== all.length ||
    new Set(all.map((r) => r.legacy_ku_uri)).size !== all.length
  ) {
    return fail();
  }
  const matches = all.filter((r) => (canonical ? r.canonical_uri : r.legacy_ku_uri) === uri);
  if (matches.length !== 1) {
    return fail();
  }
  return matches[0];
}
export function toKu(uri: CanonicalKbUri, records: ReadonlyArray<DualUriMapping>): DualUriMapping {
  return select(uri, records, true);
}
export function toKb(uri: LegacyKuUri, records: ReadonlyArray<DualUriMapping>): DualUriMapping {
  return select(uri, records, false);
}

/** Python-compatible NFC followed by the explicit29 str.isspace() codepoints.
 * Preserves FEFF; no ECMAScript whitespace regex. Source08/t61 resolves NFC.
 */
const PYTHON_SPACE = new Set<number>([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x001c, 0x001d, 0x001e, 0x001f, 0x0020, 0x0085, 0x00a0,
  0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
export function normalizeTextPythonCompat(input: string): string {
  if (typeof input !== "string") {
    throw new TypeError("Expected text");
  }
  let result = "",
    pending = false;
  for (const ch of input.normalize("NFC")) {
    if (PYTHON_SPACE.has(ch.codePointAt(0)!)) {
      pending = result.length > 0;
      continue;
    }
    if (pending) {
      result += " ";
    }
    result += ch;
    pending = false;
  }
  return result;
}
/** Draft v2 contract only. Existing SDK/v1 generation-zero rules are unchanged. */
export function isPolicyGeneration(value: unknown): value is PolicyGeneration {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
}
const LIFECYCLE = new Set([
  "published",
  "draft",
  "in_review",
  "approved",
  "rejected",
  "superseded",
  "revoked",
]);
/** Cross-field reference validator, NOT authority or a runtime v1 response parser. */
export function validateWriteActivationResult(value: unknown): WriteActivationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid draft activation result");
  }
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).toSorted().join(",") !==
      "activated,created_version,current_version,lifecycle_state,rollback_scope" ||
    !isPolicyGeneration(v.created_version) ||
    !isPolicyGeneration(v.current_version) ||
    typeof v.lifecycle_state !== "string" ||
    !LIFECYCLE.has(v.lifecycle_state) ||
    typeof v.activated !== "boolean" ||
    v.rollback_scope !== "content_and_filename_only" ||
    v.activated !== (v.created_version === v.current_version && v.lifecycle_state === "published")
  ) {
    throw new TypeError("Invalid draft activation result");
  }
  return Object.freeze({ ...v }) as WriteActivationResult;
}

function hasControl(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.codePointAt(0)!;
    return code < 32 || code === 127;
  });
}
