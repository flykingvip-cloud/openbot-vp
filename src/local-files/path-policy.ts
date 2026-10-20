/**
 * Three-layer path denial, plus the macOS path semantics the design pins down
 * (design 4.9 and 9.5).
 *
 * No authorization can open a hard-denied object. That includes a path the user
 * named themselves and a path they clicked "allow once" for. The node is the
 * enforcement point; the gateway may pre-reject only to save a round trip.
 *
 * Layers:
 *   1. system hard-deny paths (credential stores, keychains, other users, /System…)
 *   2. sensitive file names and content types (private keys, .env, cookies…)
 *   3. ordinary user content — an allowlist of roots. Not being in layers 1 and 2
 *      does NOT make a path readable; it only makes it eligible for a grant.
 *
 * This module is pure. It takes a canonical path plus observed stat facts and
 * returns a decision, so both sides can run the identical rules.
 */

import path from "node:path";

/** Which layer refused, for audit. Never surfaced to the model verbatim. */
export type PathDenyLayer =
  | "system-path"
  | "sensitive-name"
  | "not-user-content"
  | "outside-user-home"
  | "foreign-volume"
  | "special-file"
  | "hardlink"
  | "archive-entry-escape"
  | "malformed-path";

export type PathDecision =
  | { allowed: true; canonicalPath: string }
  | { allowed: false; layer: PathDenyLayer; rule: string };

export type PathPolicyContext = {
  /** Canonical home directory of the bound user. */
  homeDir: string;
  /** APFS is case-insensitive by default, so comparisons must be too. */
  caseInsensitive: boolean;
  /**
   * User content roots, relative to home. Only these are eligible for a grant
   * (design 4.9 layer 3).
   */
  userContentRoots?: readonly string[];
};

export const DEFAULT_USER_CONTENT_ROOTS = [
  "Desktop",
  "Documents",
  "Downloads",
  "Movies",
  "Music",
  "Pictures",
  "Public",
] as const;

/**
 * Credential and system stores. Relative to the user's home directory.
 * Cloud, Kubernetes and Docker credential directories are the same layer.
 */
const HOME_RELATIVE_DENY = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".gpg",
  ".kube",
  ".docker",
  ".azure",
  ".config/gcloud",
  ".config/gh",
  ".openbot",
  ".openclaw",
  ".npm",
  ".cargo/credentials",
  ".gem/credentials",
  "Library/Keychains",
  "Library/Containers/com.apple.Safari",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Firefox",
  "Library/Messages",
  "Library/Mail",
  "Library/Cookies",
  "Library/HomeKit",
  "Library/IdentityServices",
] as const;

/** Absolute system locations that are never readable through this channel. */
const ABSOLUTE_DENY = [
  "/System",
  "/private/etc",
  "/etc",
  "/private/var/db",
  "/var/db",
  "/dev",
  "/Library/Keychains",
  "/private/var/root",
  "/var/root",
  "/proc",
  "/sys",
] as const;

/** Exact basenames that are refused wherever they appear. */
const SENSITIVE_BASENAMES = new Set(
  [
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".htpasswd",
    ".git-credentials",
    ".gitconfig",
    ".dockercfg",
    ".pgpass",
    "credentials",
    "credentials.json",
    "client_secret.json",
    "service-account.json",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_ed25519_sk",
    "id_ecdsa_sk",
    "identity",
    "authorized_keys",
    "cookies",
    "cookies.binarycookies",
    "cookies.sqlite",
    "login data",
    "login data for account",
    "web data",
    "key4.db",
    "logins.json",
    "chat.db",
    "chat.db-wal",
    "chat.db-shm",
    "envelope index",
    "keychain-2.db",
    "login.keychain-db",
    "auth-profiles.json",
    "token.json",
    "secrets.yaml",
    "secrets.yml",
  ].map((name) => name.toLowerCase()),
);

/** Extensions that indicate key or credential material. */
const SENSITIVE_EXTENSIONS = new Set(
  [
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".jks",
    ".keystore",
    ".kdbx",
    ".ppk",
    ".asc",
    ".gpg",
    ".pgp",
    ".mobileprovision",
    ".p8",
    ".cer",
    ".der",
  ].map((ext) => ext.toLowerCase()),
);

/**
 * The macOS data-volume firmlink. `/System/Volumes/Data/Users/x` and `/Users/x`
 * are the same file, so the prefix is stripped before any rule runs — otherwise a
 * legitimate path would be denied for the wrong reason, and the two spellings
 * would not compare equal (design 9.5, acceptance 9.6 case 8).
 */
const DATA_VOLUME_PREFIX = "/System/Volumes/Data";

export function stripDataVolumePrefix(input: string): string {
  if (input === DATA_VOLUME_PREFIX) {
    return "/";
  }
  if (input.startsWith(`${DATA_VOLUME_PREFIX}/`)) {
    return input.slice(DATA_VOLUME_PREFIX.length);
  }
  return input;
}

/**
 * Normalize for comparison only. Unicode NFC folds the NFD spellings that macOS
 * produces for accented names; case folding matches APFS default behaviour.
 * The value returned here is never used as the path to open.
 */
export function normalizeForComparison(input: string, caseInsensitive: boolean): string {
  const nfc = input.normalize("NFC");
  return caseInsensitive ? nfc.toLowerCase() : nfc;
}

function isWithin(parent: string, candidate: string): boolean {
  if (candidate === parent) {
    return true;
  }
  const withSep = parent.endsWith("/") ? parent : `${parent}/`;
  return candidate.startsWith(withSep);
}

/** Layers 1 to 3, using only the path. Stat facts are checked separately. */
export function evaluateCanonicalPath(canonicalPath: string, ctx: PathPolicyContext): PathDecision {
  if (!canonicalPath.startsWith("/")) {
    return { allowed: false, layer: "malformed-path", rule: "path must be absolute" };
  }
  // A canonical path may not still contain traversal or a trailing separator.
  if (canonicalPath.includes("/../") || canonicalPath.endsWith("/..")) {
    return { allowed: false, layer: "malformed-path", rule: "unresolved traversal segment" };
  }
  if (canonicalPath.includes("\0")) {
    return { allowed: false, layer: "malformed-path", rule: "NUL byte in path" };
  }

  const stripped = stripDataVolumePrefix(path.posix.normalize(canonicalPath));
  const cmp = normalizeForComparison(stripped, ctx.caseInsensitive);
  const home = normalizeForComparison(
    stripDataVolumePrefix(path.posix.normalize(ctx.homeDir)),
    ctx.caseInsensitive,
  );

  // ---- Layer 1: absolute system deny ----
  for (const denied of ABSOLUTE_DENY) {
    if (isWithin(normalizeForComparison(denied, ctx.caseInsensitive), cmp)) {
      return { allowed: false, layer: "system-path", rule: `absolute deny ${denied}` };
    }
  }

  // External disks, disk images and network mounts are out of scope for the
  // prototype and are refused before anything else looks at them (design 9.5).
  if (isWithin("/volumes", normalizeForComparison(cmp, true))) {
    return { allowed: false, layer: "foreign-volume", rule: "not a local ordinary volume" };
  }
  if (isWithin("/net", normalizeForComparison(cmp, true))) {
    return { allowed: false, layer: "foreign-volume", rule: "network mount" };
  }

  // Everything must live under the bound user's home. This is what keeps other
  // users' home directories, /tmp and system paths out without enumerating them.
  if (!isWithin(home, cmp)) {
    return {
      allowed: false,
      layer: "outside-user-home",
      rule: "path is not under the bound user's home directory",
    };
  }

  const relative =
    cmp === home ? "" : cmp.slice(home.endsWith("/") ? home.length : home.length + 1);

  for (const denied of HOME_RELATIVE_DENY) {
    const deniedCmp = normalizeForComparison(denied, ctx.caseInsensitive);
    if (relative === deniedCmp || relative.startsWith(`${deniedCmp}/`)) {
      return { allowed: false, layer: "system-path", rule: `home deny ~/${denied}` };
    }
  }

  // ---- Layer 2: sensitive names and types ----
  const sensitive = evaluateSensitiveName(stripped);
  if (!sensitive.allowed) {
    return sensitive;
  }

  // ---- Layer 3: ordinary user content allowlist ----
  const roots = ctx.userContentRoots ?? DEFAULT_USER_CONTENT_ROOTS;
  const inUserContent = roots.some((root) => {
    const rootCmp = normalizeForComparison(root, ctx.caseInsensitive);
    return relative === rootCmp || relative.startsWith(`${rootCmp}/`);
  });
  if (!inUserContent) {
    return {
      allowed: false,
      layer: "not-user-content",
      rule: `outside the user content roots (${roots.join(", ")})`,
    };
  }

  return { allowed: true, canonicalPath };
}

/**
 * Layer 2 in isolation.
 *
 * Exported because archive entries must pass the same check: a ZIP sitting on the
 * Desktop does not make the `.env` or private key inside it readable (design 9.5).
 */
export function evaluateSensitiveName(targetPath: string): PathDecision {
  const base = path.posix.basename(targetPath).normalize("NFC").toLowerCase();
  if (!base) {
    return { allowed: true, canonicalPath: targetPath };
  }
  if (SENSITIVE_BASENAMES.has(base)) {
    return { allowed: false, layer: "sensitive-name", rule: `sensitive basename ${base}` };
  }
  // `.env`, `.env.local`, `.env.production`, …
  if (base === ".env" || base.startsWith(".env.")) {
    return { allowed: false, layer: "sensitive-name", rule: "dotenv file" };
  }
  // `id_rsa.pub` is harmless, but `id_rsa-backup` is not; treat the `id_` SSH
  // key prefix as sensitive unless it is an explicit public key.
  if (base.startsWith("id_") && !base.endsWith(".pub")) {
    return { allowed: false, layer: "sensitive-name", rule: "ssh private key name" };
  }
  const ext = path.posix.extname(base);
  if (ext && SENSITIVE_EXTENSIONS.has(ext)) {
    return { allowed: false, layer: "sensitive-name", rule: `sensitive extension ${ext}` };
  }
  return { allowed: true, canonicalPath: targetPath };
}

/**
 * Gateway-side prefilter over the path as the user wrote it.
 *
 * The gateway cannot canonicalize a path on a foreign filesystem: `~` belongs to
 * the node's bound user, and symlinks and real paths only exist there (design 9.1).
 * So this can only ever be a **deny-only** filter, and it is deliberately not
 * authoritative: `undefined` means "undecided, ask the node", never "allowed".
 * The node's own three layers remain the last word (design 4.9).
 *
 * Its purpose is the one the design gives it: refuse the unmistakable cases
 * without spending a round trip, and give the model the same uniform denial it
 * would have received from the node.
 */
export function prefilterRawPath(rawPath: string): PathDecision | undefined {
  const raw = rawPath.trim();
  if (!raw) {
    return { allowed: false, layer: "malformed-path", rule: "empty path" };
  }
  if (raw.includes("\0")) {
    return { allowed: false, layer: "malformed-path", rule: "NUL byte in path" };
  }

  // Compare on a lowercased, NFC form. Case folding is safe here because every
  // rule below is a denial: folding can only widen what gets refused.
  const cmp = raw.normalize("NFC").toLowerCase().replaceAll("\\", "/");
  const withoutDataVolume = stripDataVolumePrefix(cmp);

  if (withoutDataVolume.startsWith("/")) {
    for (const denied of ABSOLUTE_DENY) {
      if (isWithin(denied.toLowerCase(), withoutDataVolume)) {
        return { allowed: false, layer: "system-path", rule: `absolute deny ${denied}` };
      }
    }
    if (isWithin("/volumes", withoutDataVolume) || isWithin("/net", withoutDataVolume)) {
      return { allowed: false, layer: "foreign-volume", rule: "not a local ordinary volume" };
    }
  }

  // Only a literal `~/` prefix is home-relative with certainty. `$HOME/...` and
  // bare relative paths are left to the node, which is the fail-open direction
  // this filter is allowed to take.
  if (withoutDataVolume === "~" || withoutDataVolume.startsWith("~/")) {
    const relative = withoutDataVolume === "~" ? "" : withoutDataVolume.slice(2);
    for (const denied of HOME_RELATIVE_DENY) {
      const deniedCmp = denied.toLowerCase();
      if (relative === deniedCmp || relative.startsWith(`${deniedCmp}/`)) {
        return { allowed: false, layer: "system-path", rule: `home deny ~/${denied}` };
      }
    }
  }

  // Sensitive basenames and extensions need no canonicalization to recognise.
  const sensitive = evaluateSensitiveName(raw);
  if (!sensitive.allowed) {
    return sensitive;
  }

  return undefined;
}

/** Observed facts about the object actually opened. */
export type PathStatFacts = {
  kind:
    | "file"
    | "directory"
    | "symlink"
    | "socket"
    | "fifo"
    | "char-device"
    | "block-device"
    | "other";
  /** Hard link count. */
  nlink: number;
};

/**
 * Checks that need the object, not just its name.
 *
 * The hard link rule is the important one: a sensitive file can be linked into an
 * ordinary directory, and checking the final path name plus inode type cannot
 * reveal that the same inode is still linked inside a credential directory. The
 * prototype therefore refuses `nlink > 1` on a regular file rather than guess
 * (design 9.5, acceptance 9.6 case 14).
 */
export function evaluateStatFacts(facts: PathStatFacts): PathDecision | { allowed: true } {
  if (facts.kind === "symlink") {
    return { allowed: false, layer: "special-file", rule: "symlink as final target" };
  }
  if (facts.kind !== "file" && facts.kind !== "directory") {
    return { allowed: false, layer: "special-file", rule: `not a regular file (${facts.kind})` };
  }
  if (facts.kind === "file" && facts.nlink > 1) {
    return {
      allowed: false,
      layer: "hardlink",
      rule: `nlink=${facts.nlink}; a hard-linked file may also live in a denied directory`,
    };
  }
  return { allowed: true };
}

/**
 * Validate an archive entry path.
 *
 * Rejects Zip Slip and absolute or traversing entry names, then applies the same
 * sensitive-name rules as an on-disk file (design 4.7, 9.5).
 */
export function evaluateArchiveEntryPath(entryPath: string): PathDecision {
  if (!entryPath || entryPath.includes("\0")) {
    return { allowed: false, layer: "malformed-path", rule: "empty or NUL entry name" };
  }
  if (entryPath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(entryPath)) {
    return { allowed: false, layer: "archive-entry-escape", rule: "absolute entry path" };
  }
  if (entryPath.includes("\\")) {
    return {
      allowed: false,
      layer: "archive-entry-escape",
      rule: "backslash separator in entry path",
    };
  }
  const segments = entryPath.split("/");
  if (segments.includes("..")) {
    return { allowed: false, layer: "archive-entry-escape", rule: "traversal segment in entry" };
  }
  return evaluateSensitiveName(entryPath);
}

/**
 * Full target evaluation: path layers plus stat facts.
 *
 * `targetKind` must agree with what was actually opened, so a grant for a file
 * cannot be spent on a directory or vice versa.
 */
export function evaluateTarget(params: {
  canonicalPath: string;
  facts: PathStatFacts;
  expectedKind?: "file" | "directory";
  ctx: PathPolicyContext;
}): PathDecision {
  const pathDecision = evaluateCanonicalPath(params.canonicalPath, params.ctx);
  if (!pathDecision.allowed) {
    return pathDecision;
  }
  const factsDecision = evaluateStatFacts(params.facts);
  if (!factsDecision.allowed) {
    return factsDecision;
  }
  if (params.expectedKind && params.facts.kind !== params.expectedKind) {
    return {
      allowed: false,
      layer: "special-file",
      rule: `expected ${params.expectedKind}, found ${params.facts.kind}`,
    };
  }
  return { allowed: true, canonicalPath: params.canonicalPath };
}
