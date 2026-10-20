/**
 * Plugin allowlist integrity pinning (security review 2026-08, F-4).
 *
 * `plugins.allow` entries may pin a plugin to `sha256:<hex>` computed over the
 * plugin entry file. The loader refuses to load (fail-closed) on any mismatch
 * or malformed pin. This is a supply-chain tripwire, not a sandbox: loaded
 * plugins remain fully trusted per SECURITY.md's Plugin Trust Boundary.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import type { PluginAllowEntry } from "../config/types.plugins.js";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export type ParsedPluginIntegrity =
  | { ok: true; algorithm: "sha256"; hex: string }
  | { ok: false; error: string };

/** Parse an allowlist integrity pin. Only `sha256:<64 lowercase/uppercase hex>` is accepted. */
export function parsePluginIntegrity(value: string): ParsedPluginIntegrity {
  const trimmed = value.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return { ok: false, error: `invalid integrity "${trimmed}" (expected "sha256:<hex>")` };
  }
  const algorithm = trimmed.slice(0, separator).toLowerCase();
  const hex = trimmed.slice(separator + 1).toLowerCase();
  if (algorithm !== "sha256") {
    return {
      ok: false,
      error: `unsupported integrity algorithm "${algorithm}" (only "sha256" is supported)`,
    };
  }
  if (!SHA256_HEX_RE.test(hex)) {
    return { ok: false, error: `invalid sha256 digest in integrity "${trimmed}"` };
  }
  return { ok: true, algorithm: "sha256", hex };
}

/**
 * Verify the plugin entry file (already opened via the boundary check) against
 * an expected `sha256:<hex>` pin. Reads through the open fd so the hashed
 * content is the same inode the boundary check admitted.
 */
export function verifyPluginEntryIntegrity(params: {
  fd: number;
  expected: string;
}): { ok: true } | { ok: false; error: string } {
  const parsed = parsePluginIntegrity(params.expected);
  if (!parsed.ok) {
    return parsed;
  }
  let actual: string;
  try {
    actual = createHash("sha256").update(fs.readFileSync(params.fd)).digest("hex");
  } catch (err) {
    return { ok: false, error: `failed to read plugin entry for integrity check: ${String(err)}` };
  }
  if (actual === parsed.hex) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `plugin entry sha256 mismatch (expected ${parsed.hex}, actual ${actual})`,
  };
}

export type PluginAllowIntegrityAnalysis = {
  /** Allow entries whose integrity pin is present but malformed (will refuse to load). */
  invalid: string[];
  /** Allow entry ids without any integrity pin. */
  unpinned: string[];
};

/** Pure analysis of `plugins.allow` entries for audit/startup reporting. */
export function analyzePluginAllowIntegrity(
  allow: PluginAllowEntry[] | undefined,
): PluginAllowIntegrityAnalysis {
  const invalid: string[] = [];
  const unpinned: string[] = [];
  for (const entry of allow ?? []) {
    if (typeof entry === "string") {
      const id = entry.trim();
      if (id) {
        unpinned.push(id);
      }
      continue;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) {
      continue;
    }
    const pin = typeof entry.integrity === "string" ? entry.integrity.trim() : "";
    if (!pin) {
      unpinned.push(id);
      continue;
    }
    const parsed = parsePluginIntegrity(pin);
    if (!parsed.ok) {
      invalid.push(`${id} (${parsed.error})`);
    }
  }
  return { invalid, unpinned };
}
