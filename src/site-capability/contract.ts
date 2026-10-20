/**
 * Site execution contract (SAR).
 *
 * `src/gateway/skill-capability-contract.ts` stays the verb-discovery and
 * lifecycle hint surface. This module is a new contract: finite read-only
 * site operations. Do not rename skill verbs to pretend this gap is closed.
 *
 * OI/grant is an authorization source. It is not an AccountBinding and it is
 * not a site operation capability.
 */

import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";

export const SITE_EXECUTION_CONTRACT_ID = "openbot.site-execution-contract" as const;

/**
 * Product tool names. Being on this list is not per-capability authorization.
 * Each invoke checks eligibility for the server principal, fixed version, and account.
 */
export const SAR_P1_PRODUCT_TOOLS = {
  site_list: "implemented",
  site_describe: "implemented",
  site_invoke: "implemented",
} as const;

export const SAR_OP_KINDS = ["navigate", "read_page", "request_context", "capture_result"] as const;

export type SarOpKind = (typeof SAR_OP_KINDS)[number];

export const SAR_EFFECTS = ["read"] as const;
export const SAR_AUTH_MODES = ["none", "browser_session"] as const;
export const SAR_EXECUTION_MODES = ["http", "browser_fetch", "browser_dom"] as const;

const OP_SET = new Set<string>(SAR_OP_KINDS);

export type SiteCapabilityManifest = {
  schemaVersion: "1";
  id: string;
  version: string;
  site: string;
  operation: string;
  description: string;
  effect: "read";
  authMode: "none" | "browser_session";
  executionMode: "http" | "browser_fetch" | "browser_dom";
  allowedOrigins: string[];
  permissions: SarOpKind[];
};

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

/**
 * Runtime schema check. Unknown fields are rejected so a manifest cannot
 * smuggle evaluate scripts, CDP endpoints, or write effects.
 */
export function parseSiteCapabilityManifest(
  raw: unknown,
): { ok: true; manifest: SiteCapabilityManifest } | SarDenial {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "manifest must be an object");
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!MANIFEST_KEYS.has(key)) {
      return sarDeny(SAR_DENIAL_CODE.invalidManifest, `unknown manifest field: ${key}`);
    }
  }
  if (record.schemaVersion !== "1") {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "schemaVersion must be 1");
  }
  if (record.effect !== "read") {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "P0 site capabilities are read-only");
  }
  if (record.authMode !== "none" && record.authMode !== "browser_session") {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "authMode is not allowed in P0");
  }
  if (
    record.executionMode !== "http" &&
    record.executionMode !== "browser_fetch" &&
    record.executionMode !== "browser_dom"
  ) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "executionMode is outside the P0 set");
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
  if (!Array.isArray(record.permissions) || record.permissions.length === 0) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "permissions is required");
  }
  const permissions: SarOpKind[] = [];
  for (const permission of record.permissions) {
    if (permission === "evaluate" || permission === "eval") {
      return sarDeny(SAR_DENIAL_CODE.evaluate, "site manifests cannot grant page evaluation");
    }
    if (typeof permission !== "string" || !OP_SET.has(permission)) {
      return sarDeny(
        SAR_DENIAL_CODE.invalidManifest,
        `permission not in finite set: ${String(permission)}`,
      );
    }
    permissions.push(permission as SarOpKind);
  }
  return {
    ok: true,
    manifest: {
      schemaVersion: "1",
      id: (record.id as string).trim(),
      version: (record.version as string).trim(),
      site: (record.site as string).trim(),
      operation: (record.operation as string).trim(),
      description: (record.description as string).trim(),
      effect: "read",
      authMode: record.authMode,
      executionMode: record.executionMode,
      allowedOrigins: record.allowedOrigins,
      permissions,
    },
  };
}
