/**
 * Write-effect contract for the SAR P4 extension review.
 *
 * The read parser in `contract.ts` stays read-only. A write manifest is a
 * separate object: create or update, never publish, delete, or payment.
 * OI/grant is not this manifest and not an account binding.
 */

import { createHash } from "node:crypto";
import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import { findSarScriptKey } from "./operations.js";

export const SAR_WRITE_EFFECTS = ["create", "update"] as const;
export type SarWriteEffect = (typeof SAR_WRITE_EFFECTS)[number];

export const SAR_WRITE_FIXTURE_ORIGIN = "https://fixture.sar-write.test";
export const SAR_WRITE_VERSION = "2026.10.17";
export const SAR_DRAFT_NOTE_CREATE_ID = "fixture.sar.draft-note.create";
export const SAR_DRAFT_NOTE_UPDATE_ID = "fixture.sar.draft-note.update";

const WRITE_EFFECT_SET = new Set<string>(SAR_WRITE_EFFECTS);
const EXECUTION_MODES = new Set(["http", "browser_fetch", "browser_dom"]);
const AUTH_MODES = new Set(["none", "browser_session"]);

const MANIFEST_KEYS = new Set([
  "schemaVersion",
  "id",
  "version",
  "site",
  "operation",
  "description",
  "effect",
  "authMode",
  "executionMode",
  "allowedOrigins",
  "permissions",
]);

export type WriteCapabilityManifest = {
  schemaVersion: "1";
  id: string;
  version: string;
  site: string;
  operation: string;
  description: string;
  effect: SarWriteEffect;
  authMode: "none" | "browser_session";
  executionMode: "http" | "browser_fetch" | "browser_dom";
  allowedOrigins: string[];
  permissions: ["apply_draft"];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

/**
 * Schema check for the write extension only.
 * Read, publish, delete, and unknown fields are rejected.
 * The default site catalog does not call this parser.
 */
export function parseWriteCapabilityManifest(
  raw: unknown,
): { ok: true; manifest: WriteCapabilityManifest } | SarDenial {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "write manifest must be an object");
  }
  const scriptKey = findSarScriptKey(raw);
  if (scriptKey) {
    return sarDeny(SAR_DENIAL_CODE.evaluate, `write manifest cannot carry ${scriptKey}`);
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!MANIFEST_KEYS.has(key)) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, `unknown write manifest field: ${key}`);
    }
  }
  if (record.schemaVersion !== "1") {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "schemaVersion must be 1");
  }
  if (record.effect === "read") {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "write manifest does not accept read");
  }
  if (record.effect === "publish" || record.effect === "delete" || record.effect === "payment") {
    return sarDeny(
      SAR_DENIAL_CODE.invalidManifest,
      "write extension rejects publish, delete, and payment",
    );
  }
  if (typeof record.effect !== "string" || !WRITE_EFFECT_SET.has(record.effect)) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "write effect must be create or update");
  }
  if (typeof record.authMode !== "string" || !AUTH_MODES.has(record.authMode)) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "authMode is not allowed for a write");
  }
  if (typeof record.executionMode !== "string" || !EXECUTION_MODES.has(record.executionMode)) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "executionMode is outside the write set");
  }
  const textFields = ["id", "version", "site", "operation", "description"] as const;
  for (const field of textFields) {
    if (typeof record[field] !== "string" || record[field].trim().length === 0) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, `${field} is required`);
    }
  }
  if (!isStringArray(record.allowedOrigins) || record.allowedOrigins.length === 0) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "allowedOrigins is required");
  }
  for (const origin of record.allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "allowed origin is not a URL");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== origin) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, "allowed origin must be an https origin");
    }
  }
  if (!Array.isArray(record.permissions) || record.permissions.length !== 1) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "write permission must be apply_draft only");
  }
  const permission = record.permissions[0];
  if (permission === "evaluate" || permission === "eval") {
    return sarDeny(SAR_DENIAL_CODE.evaluate, "write manifests cannot grant page evaluation");
  }
  if (permission !== "apply_draft") {
    return sarDeny(
      SAR_DENIAL_CODE.invalidManifest,
      `write permission is outside the fixture set: ${String(permission)}`,
    );
  }
  const effect = record.effect as SarWriteEffect;
  const authMode = record.authMode as WriteCapabilityManifest["authMode"];
  const executionMode = record.executionMode as WriteCapabilityManifest["executionMode"];
  return {
    ok: true,
    manifest: {
      schemaVersion: "1",
      id: (record.id as string).trim(),
      version: (record.version as string).trim(),
      site: (record.site as string).trim(),
      operation: (record.operation as string).trim(),
      description: (record.description as string).trim(),
      effect,
      authMode,
      executionMode,
      allowedOrigins: [...record.allowedOrigins],
      permissions: ["apply_draft"],
    },
  };
}

/** Digest of the trusted apply_draft plan. Callers cannot substitute a script. */
export function writeArtifactDigest(manifest: WriteCapabilityManifest): string {
  const body = JSON.stringify({
    capabilityId: manifest.id,
    version: manifest.version,
    effect: manifest.effect,
    operation: manifest.operation,
    site: manifest.site,
    allowedOrigins: manifest.allowedOrigins,
    permissions: manifest.permissions,
    plan: [{ op: "apply_draft" }],
  });
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

export function writePayloadDigest(input: {
  effect: SarWriteEffect;
  noteId: string;
  title: string;
  body: string;
}): string {
  const encoded = JSON.stringify({
    effect: input.effect,
    noteId: input.noteId,
    title: input.title,
    body: input.body,
  });
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

export function draftNoteContentDigest(input: {
  noteId: string;
  title: string;
  body: string;
  revision: number;
}): string {
  const encoded = JSON.stringify(input);
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

function fixtureManifest(
  id: string,
  effect: SarWriteEffect,
  description: string,
): WriteCapabilityManifest {
  return {
    schemaVersion: "1",
    id,
    version: SAR_WRITE_VERSION,
    site: "fixture.sar-write.test",
    operation: "draft-note",
    description,
    effect,
    authMode: "browser_session",
    executionMode: "browser_dom",
    allowedOrigins: [SAR_WRITE_FIXTURE_ORIGIN],
    permissions: ["apply_draft"],
  };
}

/** One controllable site, create effect. Not part of the process default catalog. */
export const SAR_DRAFT_NOTE_CREATE: WriteCapabilityManifest = fixtureManifest(
  SAR_DRAFT_NOTE_CREATE_ID,
  "create",
  "Create a draft note on the controllable write fixture",
);

/** Same fixture, update effect. A create grant does not cover this manifest. */
export const SAR_DRAFT_NOTE_UPDATE: WriteCapabilityManifest = fixtureManifest(
  SAR_DRAFT_NOTE_UPDATE_ID,
  "update",
  "Update a draft note on the controllable write fixture",
);
