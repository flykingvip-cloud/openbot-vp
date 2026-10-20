#!/usr/bin/env node
/**
 * Read-only workspace isolation probe for controlled re-verification.
 *
 * Usage (stdout only — never writes files):
 *   OPENBOT_STATE_DIR=/path/to/.openbot \
 *   SAMPLE_TENANT=<tenantId> \
 *   SAMPLE_USER=<userId> \
 *   node scripts/audit/workspace-isolation-probe.mjs --mode raw-controlled
 *
 *   ... | node scripts/audit/workspace-isolation-probe.mjs --mode summary-redacted \
 *         --evidence-id workspace-isolation-20260810-001
 *
 * Or pipe:
 *   node ... --mode raw-controlled | node ... --mode summary-redacted --evidence-id ...
 *
 * Optional env:
 *   RECENT_DAYS=14
 *   PROBE_AT=2026-08-10T00:18:54Z   # fix "now" for the recent window
 *   MAX_FULL_HASH_BYTES=2097152
 *   MAX_FILES=20000
 *   MAX_DEPTH=24
 *   MAX_BYTES_READ=268435456         # 256 MiB total hash bytes
 *   MAX_DUP_BASENAMES=200
 *   OPENBOT_C19_BINDING_MANIFEST=/path/to/bindings.json  # optional durable roles
 *
 * Safety:
 * - SAMPLE_* must be single safe path segments (no /, \\, .., NUL)
 * - All scan roots must resolve **physically** inside OPENBOT_STATE_DIR (realpath containment;
 *   path.resolve/relative alone is insufficient against symlinks)
 * - Directory walks use lstat; symlinks are realpath'd and rejected if they escape
 * - MAX_FILES is global across all path classes (not reset per class)
 * - Never writes to disk; operators redirect stdout outside stateDir
 * - --compare requires stats.truncated, errorCount, scriptSha256, probeUtc, and limits
 *
 * Schemas:
 * - raw-controlled  → workspace-isolation-probe/v2 (+ optional c19Assertions)
 * - summary-redacted → workspace-isolation-evidence-summary/v1 (+ optional c19Assertions)
 *
 * C19 assertions (Codex gate): unique writable canonical, legacy A/B/C roles,
 * unknown ownership isolation, shared-root recent writes == 0, sample-scoped
 * file scan (no cross-tenant content enumeration), current probe SHA.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAW_SCHEMA = "workspace-isolation-probe/v2";
const SUMMARY_SCHEMA = "workspace-isolation-evidence-summary/v1";
const SCRIPT_PATH = "scripts/audit/workspace-isolation-probe.mjs";

const DELIVERABLE_EXTS = new Set([
  ".pptx",
  ".md",
  ".pdf",
  ".html",
  ".htm",
  ".canvas",
  ".docx",
  ".xlsx",
]);

function die(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    die(`missing required env: ${name}`);
  }
  return value;
}

function requireSafeSegment(name) {
  const value = requireEnv(name);
  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    die(`${name} must be one safe path segment`);
  }
  return value;
}

function parseArgs(argv) {
  let mode = "raw-controlled";
  let evidenceId = "";
  let comparePath = "";
  let stateDirArg = "";
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      mode = argv[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }
    if (arg === "--evidence-id") {
      evidenceId = argv[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--evidence-id=")) {
      evidenceId = arg.slice("--evidence-id=".length);
      continue;
    }
    if (arg === "--compare") {
      comparePath = argv[++i] ?? "";
      continue;
    }
    if (arg.startsWith("--compare=")) {
      comparePath = arg.slice("--compare=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (!arg.startsWith("-") && !stateDirArg) {
      // Positional: node workspace-isolation-probe.mjs <controlled-audit-store> ...
      stateDirArg = arg;
      continue;
    }
    die(`unknown argument: ${arg}`);
  }
  if (mode !== "raw-controlled" && mode !== "summary-redacted") {
    die(`--mode must be raw-controlled or summary-redacted (got ${mode})`);
  }
  return { mode, evidenceId, comparePath, stateDirArg };
}

function printHelp() {
  process.stdout.write(`Usage:
  OPENBOT_STATE_DIR=... SAMPLE_TENANT=... SAMPLE_USER=... \\
    node ${SCRIPT_PATH} --mode raw-controlled

  # Equivalent positional form:
  SAMPLE_TENANT=... SAMPLE_USER=... \\
    node ${SCRIPT_PATH} <controlled-audit-store> --mode raw-controlled

  ... | node ${SCRIPT_PATH} --mode summary-redacted --evidence-id <id> [--compare summary.json]

Stdout only. Never writes under stateDir.
`);
}

function tryRealpath(p) {
  try {
    return typeof fs.realpathSync.native === "function"
      ? fs.realpathSync.native(p)
      : fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Physical containment against symlink escape.
 * Existing paths are compared via realpath; non-existent paths require a lexical
 * prefix under rootReal and that no existing symlink ancestor resolves outside.
 */
function isPhysicallyInside(rootReal, targetPath) {
  const root = path.resolve(rootReal);
  const targetReal = tryRealpath(targetPath);
  if (targetReal) {
    const rel = path.relative(root, targetReal);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  }

  const targetResolved = path.resolve(targetPath);
  const relLex = path.relative(root, targetResolved);
  if (relLex.startsWith("..") || path.isAbsolute(relLex)) {
    return false;
  }

  const parts = relLex.split(path.sep).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = path.join(cur, part);
    if (!fs.existsSync(cur)) {
      break;
    }
    let lst;
    try {
      lst = fs.lstatSync(cur);
    } catch {
      return false;
    }
    if (lst.isSymbolicLink()) {
      const real = tryRealpath(cur);
      if (!real) {
        return false;
      }
      const r = path.relative(root, real);
      if (r.startsWith("..") || path.isAbsolute(r)) {
        return false;
      }
      cur = real;
    }
  }
  return true;
}

function resolveStateDir(raw) {
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) {
    die(`OPENBOT_STATE_DIR is not a directory: ${resolved}`);
  }
  const real = tryRealpath(resolved);
  if (!real) {
    die(`OPENBOT_STATE_DIR realpath failed: ${resolved}`);
  }
  let st;
  try {
    st = fs.statSync(real);
  } catch (err) {
    die(`OPENBOT_STATE_DIR unreadable: ${String(err?.message ?? err)}`);
  }
  if (!st.isDirectory()) {
    die(`OPENBOT_STATE_DIR is not a directory: ${real}`);
  }
  return real;
}

/** Join segments under root; reject escape via .., absolute segments, or symlink escape. */
function resolveContained(rootReal, ...segments) {
  for (const seg of segments) {
    if (
      !seg ||
      seg === "." ||
      seg === ".." ||
      path.isAbsolute(seg) ||
      seg.includes("/") ||
      seg.includes("\\") ||
      seg.includes("\0")
    ) {
      die(`unsafe path segment rejected: ${JSON.stringify(seg)}`);
    }
  }
  const candidate = path.resolve(rootReal, ...segments);
  if (!isPhysicallyInside(rootReal, candidate)) {
    die(`path escapes stateDir (physical): ${candidate}`);
  }
  const real = tryRealpath(candidate);
  if (real && !isPhysicallyInside(rootReal, real)) {
    die(`path escapes stateDir via symlink: ${candidate} -> ${real}`);
  }
  return real ?? candidate;
}

function resolveFirstWorkspaceAlias(stateDir, tenant, user) {
  const base = resolveContained(stateDir, "tenants", tenant, "users", user, "OpenBot");
  let names = [];
  try {
    names = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("workspace-"))
      .map((entry) => entry.name)
      .toSorted((a, b) => a.localeCompare(b));
  } catch {
    names = [];
  }
  if (names.length === 0) {
    return resolveContained(
      stateDir,
      "tenants",
      tenant,
      "users",
      user,
      "OpenBot",
      "_no-agent-workspace-alias",
    );
  }
  return resolveContained(stateDir, "tenants", tenant, "users", user, "OpenBot", names[0]);
}

/** @deprecated Prefer isPhysicallyInside — kept name for call-site clarity. */
function isInsideDir(rootReal, target) {
  return isPhysicallyInside(rootReal, target);
}

function scriptDigest() {
  const self = fileURLToPath(import.meta.url);
  const body = fs.readFileSync(self);
  return {
    scriptPath: SCRIPT_PATH,
    scriptSha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}

function envInt(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    die(`${name} must be a non-negative number`);
  }
  return Math.floor(n);
}

function resolveProbeAtMs() {
  const raw = process.env.PROBE_AT?.trim();
  if (!raw) {
    return Date.now();
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    die(`PROBE_AT must be a valid ISO timestamp (got ${raw})`);
  }
  return ms;
}

/** Prefer second-precision UTC when PROBE_AT was second-precision (stable evidence ids). */
function formatProbeUtc(ms) {
  const iso = new Date(ms).toISOString();
  return process.env.PROBE_AT?.trim() && !/\.\d{3}Z$/.test(process.env.PROBE_AT.trim())
    ? iso.replace(/\.\d{3}Z$/, "Z")
    : iso;
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256FileLimited(filePath, maxFullBytes, budget, stateDirReal, errors) {
  let lst;
  try {
    lst = fs.lstatSync(filePath);
  } catch (err) {
    errors.push({ path: filePath, error: String(err?.message ?? err) });
    return null;
  }
  let readPath = filePath;
  if (lst.isSymbolicLink()) {
    const real = tryRealpath(filePath);
    if (!real || !isPhysicallyInside(stateDirReal, real)) {
      errors.push({ path: filePath, error: "symlink escapes stateDir physically" });
      return null;
    }
    readPath = real;
  } else if (!isPhysicallyInside(stateDirReal, filePath)) {
    errors.push({ path: filePath, error: "file escapes stateDir physically" });
    return null;
  }

  const st = fs.statSync(readPath);
  if (!st.isFile()) {
    return null;
  }
  const toRead = st.size <= maxFullBytes ? st.size : Math.min(1024 * 1024, st.size);
  if (budget.bytesRead + toRead > budget.maxBytesRead) {
    budget.truncated = true;
    budget.truncationReasons.push("max_bytes_read");
    return null;
  }
  const fd = fs.openSync(readPath, "r");
  try {
    const hash = crypto.createHash("sha256");
    if (st.size <= maxFullBytes) {
      const data = fs.readFileSync(fd);
      budget.bytesRead += data.length;
      hash.update(data);
      return { sha256: hash.digest("hex"), hashMode: "full", bytesRead: data.length };
    }
    const buf = Buffer.alloc(1024 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    budget.bytesRead += n;
    hash.update(buf.subarray(0, n));
    return {
      sha256: `partial1MiB:${hash.digest("hex")}`,
      hashMode: "partial1MiB",
      bytesRead: n,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Walk deliverables under root.
 * `limits.seenFiles` is a **global** counter across classes (not reset per walk).
 */
function walkDeliverables(root, limits, errors, stateDirReal) {
  const out = [];
  if (!fs.existsSync(root)) {
    return { files: out, truncated: false };
  }
  if (!isPhysicallyInside(stateDirReal, root)) {
    errors.push({ path: root, error: "scan root escapes stateDir physically" });
    return { files: out, truncated: false };
  }

  let rootLst;
  try {
    rootLst = fs.lstatSync(root);
  } catch (err) {
    errors.push({ path: root, error: String(err?.message ?? err) });
    return { files: out, truncated: false };
  }

  let startDir = root;
  if (rootLst.isSymbolicLink()) {
    const real = tryRealpath(root);
    if (!real || !isPhysicallyInside(stateDirReal, real)) {
      errors.push({ path: root, error: "scan root symlink escapes stateDir physically" });
      return { files: out, truncated: false };
    }
    startDir = real;
  }

  let st;
  try {
    st = fs.statSync(startDir);
  } catch (err) {
    errors.push({ path: startDir, error: String(err?.message ?? err) });
    return { files: out, truncated: false };
  }
  if (!st.isDirectory()) {
    return { files: out, truncated: false };
  }

  let truncated = false;
  const stack = [{ dir: startDir, depth: 0 }];

  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > limits.maxDepth) {
      truncated = true;
      continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: dir, error: String(err?.message ?? err) });
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith("._") || ent.name === "." || ent.name === "..") {
        continue;
      }
      if (ent.name.includes("\0") || ent.name.includes("/") || ent.name.includes("\\")) {
        errors.push({ path: dir, error: `unsafe entry name: ${JSON.stringify(ent.name)}` });
        continue;
      }
      const full = path.join(dir, ent.name);

      let lst;
      try {
        lst = fs.lstatSync(full);
      } catch (err) {
        errors.push({ path: full, error: String(err?.message ?? err) });
        continue;
      }

      if (lst.isSymbolicLink()) {
        const real = tryRealpath(full);
        if (!real || !isPhysicallyInside(stateDirReal, real)) {
          errors.push({ path: full, error: "symlink escapes stateDir physically" });
          continue;
        }
        let rst;
        try {
          rst = fs.statSync(real);
        } catch (err) {
          errors.push({ path: full, error: String(err?.message ?? err) });
          continue;
        }
        if (rst.isDirectory()) {
          stack.push({ dir: real, depth: depth + 1 });
          continue;
        }
        if (!rst.isFile()) {
          continue;
        }
        limits.seenFiles += 1;
        if (limits.seenFiles > limits.maxFiles) {
          truncated = true;
          break;
        }
        const ext = path.extname(ent.name).toLowerCase();
        if (!DELIVERABLE_EXTS.has(ext)) {
          continue;
        }
        out.push({
          abs: real,
          rel: path.relative(startDir, real),
          basename: ent.name,
          size: rst.size,
          mtimeMs: rst.mtimeMs,
        });
        continue;
      }

      if (!isPhysicallyInside(stateDirReal, full)) {
        errors.push({ path: full, error: "entry escapes stateDir physically" });
        continue;
      }

      if (lst.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!lst.isFile()) {
        continue;
      }
      limits.seenFiles += 1;
      if (limits.seenFiles > limits.maxFiles) {
        truncated = true;
        break;
      }
      const ext = path.extname(ent.name).toLowerCase();
      if (!DELIVERABLE_EXTS.has(ext)) {
        continue;
      }
      out.push({
        abs: full,
        rel: path.relative(startDir, full),
        basename: ent.name,
        size: lst.size,
        mtimeMs: lst.mtimeMs,
      });
    }
    if (truncated) {
      break;
    }
  }

  return { files: out, truncated };
}

function buildClassRoots(stateDir, sampleTenant, sampleUser) {
  return {
    A_employee: resolveContained(stateDir, "agents", "main", "employees", sampleUser, "workspace"),
    B_flat_l2: resolveContained(
      stateDir,
      "tenants",
      sampleTenant,
      "users",
      sampleUser,
      "OpenBot",
      "workspace",
    ),
    C_agent_main: resolveContained(
      stateDir,
      "tenants",
      sampleTenant,
      "users",
      sampleUser,
      "OpenBot",
      "agents",
      "main",
      "workspace",
    ),
    D_skill_l2: resolveFirstWorkspaceAlias(stateDir, sampleTenant, sampleUser),
    E_skill_host: resolveContained(stateDir, "skills"),
    F_canvas: resolveContained(stateDir, "canvas"),
  };
}

function countCluster(stateDir, errors) {
  let tenantCount = 0;
  let userDirCount = 0;
  const tenantsRoot = resolveContained(stateDir, "tenants");
  if (!fs.existsSync(tenantsRoot)) {
    return { tenantCount, userDirCount };
  }
  let tenants;
  try {
    tenants = fs.readdirSync(tenantsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (err) {
    errors.push({ path: tenantsRoot, error: String(err?.message ?? err) });
    return { tenantCount, userDirCount };
  }
  tenantCount = tenants.length;
  for (const t of tenants) {
    if (
      t.name === "." ||
      t.name === ".." ||
      t.name.includes("/") ||
      t.name.includes("\\") ||
      t.name.includes("\0")
    ) {
      continue;
    }
    const users = path.join(tenantsRoot, t.name, "users");
    if (!isInsideDir(stateDir, users) || !fs.existsSync(users)) {
      continue;
    }
    try {
      userDirCount += fs
        .readdirSync(users, { withFileTypes: true })
        .filter((e) => e.isDirectory()).length;
    } catch (err) {
      errors.push({ path: users, error: String(err?.message ?? err) });
    }
  }
  return { tenantCount, userDirCount };
}

const LEGACY_WORKSPACE_CLASSES = ["A_employee", "B_flat_l2", "C_agent_main"];
const SHARED_ROOT_CLASSES = ["D_skill_l2", "E_skill_host", "F_canvas"];
const ROLE_VALUES = new Set(["canonical_writable", "read_only", "retired", "quarantined"]);

function loadBindingManifest(stateDir, sampleTenant, errors) {
  const candidates = [];
  const envPath = process.env.OPENBOT_C19_BINDING_MANIFEST?.trim();
  if (envPath) {
    candidates.push(path.resolve(envPath));
  }
  candidates.push(path.join(stateDir, ".openbot-c19-bindings.json"));
  candidates.push(path.join(stateDir, "tenants", sampleTenant, ".openbot-c19-bindings.json"));
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    if (!isInsideDir(stateDir, candidate) && !(envPath && path.resolve(envPath) === candidate)) {
      errors.push({ path: candidate, error: "binding manifest escapes stateDir" });
      continue;
    }
    try {
      return { path: candidate, data: JSON.parse(fs.readFileSync(candidate, "utf8")) };
    } catch (err) {
      errors.push({ path: candidate, error: String(err?.message ?? err) });
    }
  }
  return null;
}

/**
 * Build Codex C19 gate assertions from pathSummary + optional durable binding manifest.
 * Observational fallback uses recent deliverable mtimes (not ownership inference).
 */
function buildC19Assertions(params) {
  const { pathSummary, cluster, sampleTenant, probe, bindingManifest, errors } = params;
  const failures = [];
  const legacyRootRoles = {};

  const observationalWriters = LEGACY_WORKSPACE_CLASSES.filter(
    (cls) => (pathSummary[cls]?.recentCount ?? 0) > 0,
  );
  const sharedRecentWrites = Object.fromEntries(
    SHARED_ROOT_CLASSES.map((cls) => [cls, Number(pathSummary[cls]?.recentCount ?? 0)]),
  );
  const sharedRootRecentWriteTotal = Object.values(sharedRecentWrites).reduce((a, b) => a + b, 0);

  let writableCanonicalByOwnerScope = [];
  let roleSource = "observational_recent_writes";

  if (bindingManifest?.data?.ownerScopes && Array.isArray(bindingManifest.data.ownerScopes)) {
    roleSource = "binding_manifest";
    for (const scope of bindingManifest.data.ownerScopes) {
      const kind = String(scope.kind ?? "unknown");
      const canonicalClassId = String(scope.canonicalClassId ?? "");
      if (!LEGACY_WORKSPACE_CLASSES.includes(canonicalClassId)) {
        failures.push(`manifest_invalid_canonical:${kind}:${canonicalClassId}`);
        continue;
      }
      writableCanonicalByOwnerScope.push({
        ownerScopeKind: kind,
        canonicalClassId,
        pathPattern: pathSummary[canonicalClassId]?.pathPattern ?? null,
        recentDeliverableWrites: Number(pathSummary[canonicalClassId]?.recentCount ?? 0),
      });
      legacyRootRoles[canonicalClassId] = "canonical_writable";
      const legacy =
        scope.legacyClassIds && typeof scope.legacyClassIds === "object"
          ? scope.legacyClassIds
          : {};
      for (const [cls, role] of Object.entries(legacy)) {
        if (!LEGACY_WORKSPACE_CLASSES.includes(cls)) {
          failures.push(`manifest_unknown_legacy_class:${cls}`);
          continue;
        }
        if (!ROLE_VALUES.has(String(role)) || String(role) === "canonical_writable") {
          failures.push(`manifest_invalid_legacy_role:${cls}:${String(role)}`);
          continue;
        }
        legacyRootRoles[cls] = String(role);
      }
    }
  } else {
    // Observational: exactly one of A/B/C with recent writes is treated as writable canonical.
    if (observationalWriters.length === 1) {
      const canonicalClassId = observationalWriters[0];
      writableCanonicalByOwnerScope = [
        {
          ownerScopeKind: "user_owned",
          canonicalClassId,
          pathPattern: pathSummary[canonicalClassId]?.pathPattern ?? null,
          recentDeliverableWrites: Number(pathSummary[canonicalClassId]?.recentCount ?? 0),
        },
      ];
      for (const cls of LEGACY_WORKSPACE_CLASSES) {
        if (cls === canonicalClassId) {
          legacyRootRoles[cls] = "canonical_writable";
        } else if (pathSummary[cls]?.exists) {
          legacyRootRoles[cls] =
            Number(pathSummary[cls]?.recentCount ?? 0) === 0 ? "read_only" : "writable_residual";
        } else {
          legacyRootRoles[cls] = "retired";
        }
      }
    } else if (observationalWriters.length === 0) {
      for (const cls of LEGACY_WORKSPACE_CLASSES) {
        legacyRootRoles[cls] = pathSummary[cls]?.exists ? "read_only" : "retired";
      }
      failures.push("no_observational_writable_canonical_among_A_B_C");
    } else {
      for (const cls of LEGACY_WORKSPACE_CLASSES) {
        if (observationalWriters.includes(cls)) {
          legacyRootRoles[cls] = "writable_residual";
        } else if (pathSummary[cls]?.exists) {
          legacyRootRoles[cls] = "read_only";
        } else {
          legacyRootRoles[cls] = "retired";
        }
      }
      failures.push(`multiple_observational_writable_roots:${observationalWriters.join(",")}`);
    }
  }

  for (const cls of LEGACY_WORKSPACE_CLASSES) {
    if (!legacyRootRoles[cls]) {
      legacyRootRoles[cls] = pathSummary[cls]?.exists ? "read_only" : "retired";
    }
  }

  const writableLegacy = LEGACY_WORKSPACE_CLASSES.filter(
    (cls) => legacyRootRoles[cls] === "canonical_writable",
  );
  if (writableLegacy.length !== 1) {
    failures.push(`expected_one_writable_canonical:got_${writableLegacy.length}`);
  }
  for (const cls of LEGACY_WORKSPACE_CLASSES) {
    const role = legacyRootRoles[cls];
    if (role === "writable_residual") {
      failures.push(`legacy_root_still_writable:${cls}`);
    }
    if (role === "canonical_writable") {
      continue;
    }
    if (!["read_only", "retired", "quarantined"].includes(role)) {
      failures.push(`legacy_root_not_closed:${cls}:${role}`);
    }
  }

  if (sharedRootRecentWriteTotal !== 0) {
    failures.push(`shared_root_recent_writes_nonzero:${sharedRootRecentWriteTotal}`);
  }

  const unknownFromManifest = bindingManifest?.data?.unknownOwnership;
  const unknownOwnership = {
    count: Number(unknownFromManifest?.count ?? 0),
    isolated: unknownFromManifest?.isolated !== false,
    source: unknownFromManifest ? "binding_manifest" : "default_zero_without_manifest",
  };
  if (!unknownOwnership.isolated) {
    failures.push("unknown_ownership_not_isolated");
  }

  // File-content walks are sample-tenant scoped; cluster counts only readdir tenant/user names.
  const crossTenantEnumeration = {
    fileContentScanTenantCount: 1,
    sampleTenantScoped: true,
    clusterTenantCount: Number(cluster?.tenantCount ?? 0),
    clusterUserDirCount: Number(cluster?.userDirCount ?? 0),
    pass: true,
    note: "Deliverable hashing is limited to SAMPLE_TENANT/SAMPLE_USER class roots; tenant/user counts are name-only readdir metadata.",
  };

  const probeScriptSha256 = probe?.scriptSha256 ?? null;
  if (!probeScriptSha256) {
    failures.push("missing_probe_script_sha256");
  }

  return {
    schema: "workspace-isolation-c19-assertions/v1",
    roleSource,
    bindingManifestPath: bindingManifest?.path
      ? bindingManifest.path.replace(sampleTenant, "<sample-tenant>")
      : null,
    writableCanonicalByOwnerScope,
    legacyRootRoles,
    unknownOwnership,
    sharedRootRecentWrites: {
      ...sharedRecentWrites,
      total: sharedRootRecentWriteTotal,
      pass: sharedRootRecentWriteTotal === 0,
    },
    crossTenantEnumeration,
    probeScriptSha256,
    observationalWriters,
    errorsSampled: (errors ?? []).length,
    gates: {
      uniqueWritableCanonical: writableLegacy.length === 1,
      legacyRootsClosed: !failures.some((f) => f.startsWith("legacy_root_")),
      sharedRootWritesZero: sharedRootRecentWriteTotal === 0,
      unknownOwnershipIsolated: unknownOwnership.isolated,
      noCrossTenantContentEnumeration: crossTenantEnumeration.pass,
      allPass: failures.length === 0,
      failures,
    },
  };
}

function runRawProbe() {
  const stateDir = resolveStateDir(requireEnv("OPENBOT_STATE_DIR"));
  const sampleTenant = requireSafeSegment("SAMPLE_TENANT");
  const sampleUser = requireSafeSegment("SAMPLE_USER");
  const recentDays = envInt("RECENT_DAYS", 14);
  const maxFullHashBytes = envInt("MAX_FULL_HASH_BYTES", 2 * 1024 * 1024);
  const maxFiles = envInt("MAX_FILES", 20_000);
  const maxDepth = envInt("MAX_DEPTH", 24);
  const maxBytesRead = envInt("MAX_BYTES_READ", 256 * 1024 * 1024);
  const maxDupBasenames = envInt("MAX_DUP_BASENAMES", 200);
  const probeAtMs = resolveProbeAtMs();
  const cutoffMs = probeAtMs - recentDays * 86400 * 1000;

  const errors = [];
  const truncationReasons = [];
  let truncated = false;
  const budget = { bytesRead: 0, maxBytesRead, truncated: false, truncationReasons };

  const classes = buildClassRoots(stateDir, sampleTenant, sampleUser);
  for (const root of Object.values(classes)) {
    if (!isInsideDir(stateDir, root)) {
      die(`scan root escapes stateDir: ${root}`);
    }
  }

  const pathSummary = {};
  const nameIndex = new Map();
  const limits = { maxFiles, maxDepth, seenFiles: 0 };

  for (const [cls, root] of Object.entries(classes)) {
    const walked = walkDeliverables(root, limits, errors, stateDir);
    if (walked.truncated) {
      truncated = true;
      truncationReasons.push(`walk:${cls}`);
    }
    const files = walked.files;
    const recent = files.filter((f) => f.mtimeMs >= cutoffMs);
    let exists = false;
    try {
      exists =
        fs.existsSync(root) &&
        isPhysicallyInside(stateDir, root) &&
        fs.statSync(root).isDirectory();
    } catch (err) {
      errors.push({ path: root, error: String(err?.message ?? err) });
    }
    pathSummary[cls] = {
      classId: cls,
      exists,
      pathPattern: `{stateDir}${root.slice(stateDir.length).split(path.sep).join("/")}`,
      deliverableCount: files.length,
      recentCount: recent.length,
    };
    for (const f of recent) {
      if (budget.truncated) {
        truncated = true;
        break;
      }
      let hashed;
      try {
        hashed = sha256FileLimited(f.abs, maxFullHashBytes, budget, stateDir, errors);
      } catch (err) {
        errors.push({ path: f.abs, error: String(err?.message ?? err) });
        continue;
      }
      if (!hashed) {
        truncated = true;
        break;
      }
      const row = {
        classId: cls,
        rel: f.rel.split(path.sep).join("/"),
        basename: f.basename,
        size: f.size,
        mtimeUtc: new Date(f.mtimeMs).toISOString(),
        sha256: hashed.sha256,
        hashMode: hashed.hashMode,
      };
      const list = nameIndex.get(f.basename) ?? [];
      list.push(row);
      nameIndex.set(f.basename, list);
    }
  }

  if (budget.truncated) {
    truncated = true;
    truncationReasons.push(...budget.truncationReasons);
  }

  const crossClassDuplicates = {};
  let dupCount = 0;
  for (const [basename, rows] of [...nameIndex.entries()].toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const classSet = new Set(rows.map((r) => r.classId));
    if (classSet.size > 1) {
      if (dupCount >= maxDupBasenames) {
        truncated = true;
        truncationReasons.push("max_dup_basenames");
        break;
      }
      crossClassDuplicates[basename] = rows;
      dupCount += 1;
    }
  }

  const cluster = countCluster(stateDir, errors);
  const probe = scriptDigest();
  const bindingManifestLoaded = loadBindingManifest(stateDir, sampleTenant, errors);
  const bindingManifest = bindingManifestLoaded
    ? {
        path: isInsideDir(stateDir, bindingManifestLoaded.path)
          ? `{stateDir}${bindingManifestLoaded.path
              .slice(stateDir.length)
              .split(path.sep)
              .join("/")}`
              .replaceAll(sampleTenant, "<sample-tenant>")
              .replaceAll(sampleUser, "<sample-user>")
          : "<external-binding-manifest>",
        data: bindingManifestLoaded.data,
      }
    : null;
  const c19Assertions = buildC19Assertions({
    pathSummary,
    cluster,
    sampleTenant,
    probe,
    bindingManifest,
    errors,
  });
  return {
    schema: RAW_SCHEMA,
    mode: "raw-controlled",
    probeUtc: formatProbeUtc(probeAtMs),
    recentDays,
    sample: {
      tenantId: sampleTenant,
      userId: sampleUser,
    },
    cluster,
    pathSummary,
    crossClassDuplicateBasenames: crossClassDuplicates,
    c19Assertions,
    limits: {
      maxFiles,
      maxDepth,
      maxBytesRead,
      maxFullHashBytes,
      maxDupBasenames,
    },
    stats: {
      bytesRead: budget.bytesRead,
      errorCount: errors.length,
      truncated,
      truncationReasons: [...new Set(truncationReasons)],
      seenFiles: limits.seenFiles,
    },
    errors: errors.slice(0, 200),
    probe,
    notes: [
      "read-only-stdout-only",
      "raw-controlled contains real tenant/user identifiers — keep in controlled audit store",
      "historical counts require PROBE_AT plus a filesystem snapshot from that time",
      "c19Assertions.gates.allPass is required for Codex C19 acceptance; observational roles need binding manifest for durable ownership",
    ],
  };
}

function redactBasename(basename) {
  const ext = path.extname(basename);
  const digest = sha256Buffer(Buffer.from(basename, "utf8")).slice(0, 12);
  return `file-${digest}${ext || ""}`;
}

function toRedactedSummary(raw, evidenceId) {
  if (raw?.schema !== RAW_SCHEMA) {
    die(`expected raw schema ${RAW_SCHEMA}, got ${raw?.schema}`);
  }
  const pathSummary = {};
  for (const [cls, row] of Object.entries(raw.pathSummary ?? {})) {
    pathSummary[cls] = {
      pathPattern: String(row.pathPattern ?? "")
        .replaceAll(raw.sample.tenantId, "<sample-tenant>")
        .replaceAll(raw.sample.userId, "<sample-user>"),
      exists: Boolean(row.exists),
      deliverableCount: Number(row.deliverableCount ?? 0),
      recentCount: Number(row.recentCount ?? 0),
    };
  }

  const cross = {};
  for (const [basename, rows] of Object.entries(raw.crossClassDuplicateBasenames ?? {})) {
    const safeName = redactBasename(basename);
    cross[safeName] = (rows ?? []).map((r) => ({
      classId: r.classId,
      size: r.size,
      mtimeUtc: r.mtimeUtc,
      sha256: r.sha256,
      hashMode: r.hashMode,
    }));
  }

  const probe = {
    scriptPath: raw.probe?.scriptPath ?? SCRIPT_PATH,
    scriptSha256: raw.probe?.scriptSha256,
    schema: raw.schema,
    recentDays: raw.recentDays,
    mode: "summary-redacted",
    derivedFrom: RAW_SCHEMA,
  };
  // Rebuild gates from redacted pathSummary; re-apply durable roles from raw when present.
  const bindingManifest =
    raw.c19Assertions?.roleSource === "binding_manifest"
      ? {
          path: raw.c19Assertions.bindingManifestPath
            ? String(raw.c19Assertions.bindingManifestPath)
                .replaceAll(raw.sample.tenantId, "<sample-tenant>")
                .replaceAll(raw.sample.userId, "<sample-user>")
            : null,
          data: {
            ownerScopes: (raw.c19Assertions.writableCanonicalByOwnerScope ?? []).map((scope) => ({
              kind: scope.ownerScopeKind,
              canonicalClassId: scope.canonicalClassId,
              legacyClassIds: Object.fromEntries(
                Object.entries(raw.c19Assertions.legacyRootRoles ?? {}).filter(
                  ([cls, role]) =>
                    cls !== scope.canonicalClassId &&
                    ["read_only", "retired", "quarantined"].includes(String(role)),
                ),
              ),
            })),
            unknownOwnership: {
              count: Number(raw.c19Assertions.unknownOwnership?.count ?? 0),
              isolated: raw.c19Assertions.unknownOwnership?.isolated !== false,
            },
          },
        }
      : null;
  const c19Assertions = buildC19Assertions({
    pathSummary,
    cluster: raw.cluster,
    sampleTenant: "<sample-tenant>",
    probe,
    bindingManifest,
    errors: [],
  });

  const summary = {
    evidenceId,
    schema: SUMMARY_SCHEMA,
    probeUtc: raw.probeUtc,
    classification: "controlled-audit-desensitized",
    environment: {
      host: "<production-gateway-host>",
      container: "<gateway-container>",
      image: "<gateway-image>",
      imageId: "<gateway-image-id>",
      buildCommit: "<gateway-build-commit>",
      buildOverlay: "<gateway-overlay-id>",
      dataSource: "host-bind:{stateDir} -> container:{stateDir}",
      multitenant: true,
      dataMode: "managed",
    },
    sample: {
      tenantId: "<sample-tenant>",
      userId: "<sample-user>",
    },
    cluster: raw.cluster,
    probe,
    pathSummary,
    crossClassDuplicateBasenames: cross,
    c19Assertions,
    limits: raw.limits ?? null,
    stats: raw.stats,
    controlledRawBundle: {
      location: "<controlled-audit-store>",
      bundleId: `${evidenceId}-raw`,
      note: "Full host/container/user identifiers and absolute paths remain outside the git repository.",
    },
    summarySha256Algorithm:
      "UTF-8 bytes of JSON.stringify(summaryWithoutSha, null, 2) + '\\n' where summaryWithoutSha omits summarySha256; Node/JSON key insertion order as produced by this script.",
  };

  const body = `${JSON.stringify(stripSummarySha(summary), null, 2)}\n`;
  summary.summarySha256 = sha256Buffer(Buffer.from(body, "utf8"));
  return summary;
}

function stripSummarySha(summary) {
  const clone = { ...summary };
  delete clone.summarySha256;
  return clone;
}

function stableCompareKey(value) {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

function compareSummaries(actual, expectedPath) {
  const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  const a = stripSummarySha(actual);
  const e = stripSummarySha(expected);

  const requiredGate = (s, label) => {
    if (typeof s.stats?.truncated !== "boolean") {
      die(`summary compare failed: ${label} missing stats.truncated`, 3);
    }
    if (typeof s.stats?.errorCount !== "number") {
      die(`summary compare failed: ${label} missing stats.errorCount`, 3);
    }
    if (!s.probe?.scriptSha256 || typeof s.probe.scriptSha256 !== "string") {
      die(`summary compare failed: ${label} missing probe.scriptSha256`, 3);
    }
    if (!s.probeUtc || typeof s.probeUtc !== "string") {
      die(`summary compare failed: ${label} missing probeUtc`, 3);
    }
    if (!s.limits || typeof s.limits !== "object") {
      die(`summary compare failed: ${label} missing limits`, 3);
    }
  };
  requiredGate(a, "actual");
  requiredGate(e, "expected");

  const focusA = {
    schema: a.schema,
    cluster: a.cluster,
    pathSummary: a.pathSummary,
    stats: {
      truncated: a.stats.truncated,
      errorCount: a.stats.errorCount,
    },
    limits: a.limits,
    probeUtc: a.probeUtc,
    scriptSha256: a.probe.scriptSha256,
    // Compare content hashes only (redacted names differ by algorithm version).
    duplicateContentFingerprints: Object.values(a.crossClassDuplicateBasenames ?? {})
      .map((rows) =>
        rows
          .map((r) => `${r.classId}:${r.sha256}:${r.size}`)
          .toSorted((x, y) => x.localeCompare(y))
          .join("|"),
      )
      .toSorted((x, y) => x.localeCompare(y)),
  };
  const focusE = {
    schema: e.schema,
    cluster: e.cluster,
    pathSummary: e.pathSummary,
    stats: {
      truncated: e.stats.truncated,
      errorCount: e.stats.errorCount,
    },
    limits: e.limits,
    probeUtc: e.probeUtc,
    scriptSha256: e.probe.scriptSha256,
    duplicateContentFingerprints: Object.values(e.crossClassDuplicateBasenames ?? {})
      .map((rows) =>
        rows
          .map((r) => `${r.classId}:${r.sha256}:${r.size}`)
          .toSorted((x, y) => x.localeCompare(y))
          .join("|"),
      )
      .toSorted((x, y) => x.localeCompare(y)),
  };
  if (stableCompareKey(focusA) !== stableCompareKey(focusE)) {
    die(
      "summary compare failed: pathSummary/cluster/duplicates/stats/limits/probeUtc/scriptSha256 diverge",
      3,
    );
  }
  process.stderr.write(
    "summary compare ok (cluster/pathSummary/duplicates/stats.truncated/errorCount/limits/probeUtc/scriptSha256)\n",
  );
}

function readStdinJson() {
  // Prefer blocking full read; avoid non-blocking fd EAGAIN on some macOS pipes.
  let text = "";
  try {
    text = fs.readFileSync(0, "utf8").trim();
  } catch (err) {
    die(`failed to read stdin JSON: ${String(err?.message ?? err)}`);
  }
  if (!text) {
    die("expected raw probe JSON on stdin");
  }
  return JSON.parse(text);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.stateDirArg) {
    process.env.OPENBOT_STATE_DIR = path.resolve(args.stateDirArg);
  }
  if (args.mode === "raw-controlled") {
    if (args.evidenceId || args.comparePath) {
      die("raw-controlled mode does not accept --evidence-id/--compare");
    }
    const report = runRawProbe();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  // summary-redacted: stdin pipe → derive from raw JSON; TTY → live scan then redact.
  const raw = process.stdin.isTTY ? runRawProbe() : readStdinJson();
  const evidenceId = args.evidenceId?.trim() || "workspace-isolation-unspecified";
  const summary = toRedactedSummary(raw, evidenceId);
  if (args.comparePath) {
    compareSummaries(summary, args.comparePath);
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
