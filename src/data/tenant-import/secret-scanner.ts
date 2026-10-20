/**
 * tenant-import secret scanner (SaaS tenant data architecture §9.2, acceptance SAAS-P-03 /
 * SAAS-T-04). A `tenant-import` package must never carry credentials or device identity. This
 * module provides the pure reject rules used by both the package builder (scan before zipping)
 * and the platform-side import preflight (scan every zip entry). A single finding fails the scan.
 *
 * Two layers:
 *  - path rules: forbidden directory segments, secret store filenames, and key/cert extensions.
 *  - content rules: plaintext secret fields with a non-empty value inside included JSON.
 */

export type SecretScanFindingKind = "path" | "content";

export type SecretScanFinding = {
  /** Package-relative path of the offending entry. */
  path: string;
  /** Rule id, e.g. `path:credentials/` or `content:accessToken`. */
  rule: string;
  kind: SecretScanFindingKind;
  detail?: string;
};

export type SecretScanResult = {
  ok: boolean;
  findings: SecretScanFinding[];
};

/** Path substrings that must never appear in a tenant-import package (§9.2). */
export const FORBIDDEN_PATH_SEGMENTS = ["credentials/", "identity/", "auth-profiles"] as const;

/** Whole secret-store files that must never be packaged, even inside an allowed dir (§9.2). */
export const FORBIDDEN_BASENAMES = new Set<string>([
  "openbot-encrypted-secrets.json",
  "openbot-user-operational-identity-secrets.json",
]);

/** Key/certificate material extensions (§9.2). */
export const FORBIDDEN_EXTENSIONS = [".pem", ".key"] as const;

/** Plaintext secret fields that must be redacted/hashed before packaging (§9.2 / §10.2). */
export const FORBIDDEN_CONTENT_FIELDS = [
  "apiKey",
  "botToken",
  "passwordHash",
  "accessToken",
  "refreshToken",
] as const;

function toPosix(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

function basename(posixPath: string): string {
  const parts = posixPath.split("/");
  return parts[parts.length - 1] ?? posixPath;
}

/** Scan a single package-relative path against the forbidden-path rules. */
export function scanPathForSecrets(relPath: string): SecretScanFinding[] {
  const findings: SecretScanFinding[] = [];
  const posix = toPosix(relPath);
  const lower = posix.toLowerCase();

  for (const segment of FORBIDDEN_PATH_SEGMENTS) {
    // Match as a path segment: at the start, after a slash, or (for `auth-profiles`) as a basename fragment.
    if (lower.includes(segment) || lower.includes(`/${segment}`)) {
      findings.push({ path: relPath, rule: `path:${segment}`, kind: "path" });
    }
  }

  const base = basename(lower);
  if (FORBIDDEN_BASENAMES.has(basename(posix))) {
    findings.push({ path: relPath, rule: `path:${basename(posix)}`, kind: "path" });
  }
  for (const ext of FORBIDDEN_EXTENSIONS) {
    if (base.endsWith(ext)) {
      findings.push({ path: relPath, rule: `path:*${ext}`, kind: "path" });
    }
  }
  return findings;
}

/** Recursively collect forbidden plaintext secret fields (non-empty string values) from a value. */
function collectSecretFields(value: unknown, relPath: string, findings: SecretScanFinding[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSecretFields(item, relPath, findings);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      (FORBIDDEN_CONTENT_FIELDS as readonly string[]).includes(key) &&
      typeof child === "string" &&
      child.trim().length > 0
    ) {
      findings.push({
        path: relPath,
        rule: `content:${key}`,
        kind: "content",
        detail: `字段 ${key} 含非空明文值，须脱敏或哈希后再打包`,
      });
    }
    collectSecretFields(child, relPath, findings);
  }
}

/**
 * Scan JSON text for plaintext secret fields. Falls back to a regex sweep when the text is not
 * valid JSON so a malformed/partial file cannot smuggle a secret past the parser.
 */
export function scanJsonForSecrets(relPath: string, jsonText: string): SecretScanFinding[] {
  const findings: SecretScanFinding[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    for (const field of FORBIDDEN_CONTENT_FIELDS) {
      // "field" : "non-empty" — whitespace tolerant, rejects empty string values.
      const re = new RegExp(`"${field}"\\s*:\\s*"[^"]+"`);
      if (re.test(jsonText)) {
        findings.push({
          path: relPath,
          rule: `content:${field}`,
          kind: "content",
          detail: `字段 ${field} 疑似含明文值（非 JSON 文本回退检测）`,
        });
      }
    }
    return findings;
  }
  collectSecretFields(parsed, relPath, findings);
  return findings;
}

export type TenantImportScanEntry = {
  /** Package-relative path. */
  path: string;
  /** JSON text for `.json` entries; scanned for plaintext secret fields. */
  json?: string;
};

/**
 * Scan a set of package entries. `ok` is true only when there are zero findings — the packaging
 * builder must abort and the import preflight must reject on any finding.
 */
export function scanTenantImportEntries(entries: TenantImportScanEntry[]): SecretScanResult {
  const findings: SecretScanFinding[] = [];
  for (const entry of entries) {
    findings.push(...scanPathForSecrets(entry.path));
    if (typeof entry.json === "string" && entry.path.toLowerCase().endsWith(".json")) {
      findings.push(...scanJsonForSecrets(entry.path, entry.json));
    }
  }
  return { ok: findings.length === 0, findings };
}
