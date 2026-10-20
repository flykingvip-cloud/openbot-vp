/**
 * P0.0a — offline migration of collaboration runtime facts into the tenant runtime
 * namespace (Floor Runtime v2.1 §3.4). CLI: scripts/migrate-collab-runtime-namespace.ts.
 *
 * - Copy only, never move or delete. Dry-run unless `apply: true` (writes nothing).
 * - Every copied file is re-read and sha256-verified; a merged ledger is verified by
 *   content hash plus key coverage of every source record.
 * - Per group: `<ns>/migration/MIGRATION_MANIFEST.json` (source, target, sha256, lines,
 *   bytes, mtime, baseline) and `<ns>/migration/audit.jsonl`; `MIGRATED_TO.json` marker
 *   in the legacy group dir.
 * - Idempotent / incremental: a file that differs on both sides is replaced only when
 *   the destination still equals the manifest baseline, otherwise `conflict` (no write).
 * - `direction: "reverse"`: `<ns>` → legacy root (rollback after the flag is turned
 *   off). Enumerates target namespaces, so groups created after cutover sync back too.
 * - Non-terminal rounds are copied as-is and listed; round restart recovery
 *   (`decideRoundRecovery`, never re-runs) settles them on the next round.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  countNonBlankLines,
  ledgerKeys,
  mergeLedgerSources,
  sha256Hex,
} from "./runtime-namespace-ledger-merge.js";
import {
  MIGRATED_TO_FILENAME,
  decideCopy,
  decodeGroupDirName,
  isRoundFactFile,
  listDir,
  listNonTerminalRounds,
  listRetained,
  readMaybe,
  summarize,
  LEDGER_FACT,
} from "./runtime-namespace-migration-io.js";
import type {
  FileAction,
  FileEntry,
  GroupReport,
  GroupStatus,
  GroupTenant,
  ManifestFile,
  MigrationManifest,
  MigrationOptions,
  MigrationReport,
  MigrationTarget,
} from "./runtime-namespace-migration-types.js";
import { inferGroupTenant } from "./runtime-namespace-tenant-inference.js";
import { buildRuntimeNamespace, type RuntimeNamespace } from "./runtime-namespace.js";

export * from "./runtime-namespace-migration-types.js";
export {
  MIGRATED_TO_FILENAME,
  decideCopy,
  isRoundFactFile,
} from "./runtime-namespace-migration-io.js";

export const LEGACY_ROUNDS_RELATIVE = path.join("runtime", "rounds");
/** Precedence order: canonical first, then the older flat file. */
export const LEGACY_LEDGER_FILES = [
  path.join("ledger", "collaboration.jsonl"),
  "collaboration-ledger.jsonl",
];
export const MIGRATION_SUBDIR = "migration";
export const MANIFEST_FILENAME = "MIGRATION_MANIFEST.json";
export const AUDIT_FILENAME = "audit.jsonl";

/** CLI exit when `--apply` is missing `--confirm-write-freeze`. */
export const MIGRATION_APPLY_REFUSED_EXIT = 3;

/**
 * P0 G7. `--apply` is refused unless the operator passes `--confirm-write-freeze`.
 * Dry-run (`apply` omitted) does not call this. The library itself stays callable
 * for fixture drills; the CLI is the production gate and must use this helper.
 */
export function runtimeNamespaceMigrationApplyRefusal(confirmWriteFreeze: boolean): string | null {
  if (confirmWriteFreeze) {
    return null;
  }
  return "refused: --apply requires --confirm-write-freeze (set collaboration.runtimeWriteFreeze=true and quiesce the gateway first)";
}
const CHANGING: ReadonlySet<FileAction> = new Set(["copy", "overwrite", "merge", "append"]);

type Ctx = { opts: MigrationOptions; runId: string; apply: boolean; now: () => number };

/** Round artifacts worth migrating: snapshots, event logs, pending txns (no locks/tmp). */
/**
 * Same layout as the runtime resolver (`resolveTrustedGroupLocator` + `/runtime`),
 * computed from explicit roots so the offline tool never depends on process config.
 */
export function resolveMigrationNamespace(
  target: MigrationTarget,
  groupId: string,
  tenantId: string | null,
): RuntimeNamespace {
  const encoded = encodeURIComponent(groupId);
  if (target.profile === "managed_enterprise") {
    if (!tenantId) {
      throw new Error(`managed_enterprise migration requires a tenant for ${groupId}`);
    }
    return buildRuntimeNamespace({
      profile: "managed_enterprise",
      tenantId,
      groupId,
      groupLocator: path.join(target.tenantsRoot, tenantId, "collaboration", "groups", encoded),
    });
  }
  return buildRuntimeNamespace({
    profile: "personal_local",
    tenantId: null,
    groupId,
    groupLocator: path.join(target.groupsRoot, encoded),
  });
}

async function writeVerified(ctx: Ctx, dest: string, bytes: Buffer, mtimeMs?: number) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.migrating-${ctx.runId}`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, dest);
  if (mtimeMs !== undefined) {
    await fs.utimes(dest, new Date(mtimeMs), new Date(mtimeMs));
  }
  return sha256Hex(await fs.readFile(dest)) === sha256Hex(bytes);
}

async function syncFile(
  ctx: Ctx,
  fact: string,
  from: string,
  to: string,
  manifest: MigrationManifest | null,
): Promise<FileEntry> {
  if (path.resolve(from) === path.resolve(to)) {
    return { fact, from: [from], to, action: "same_path", verified: true };
  }
  const src = await fs.readFile(from);
  const stat = await fs.stat(from);
  const srcSha = sha256Hex(src);
  const dest = await readMaybe(to);
  const destSha = dest ? sha256Hex(dest) : null;
  const action = decideCopy(srcSha, destSha, manifest?.files[fact]?.baselineSha256);
  const entry: FileEntry = {
    fact,
    from: [from],
    to,
    action,
    sourceSha256: srcSha,
    ...(destSha ? { destSha256: destSha } : {}),
    lines: countNonBlankLines(src.toString("utf8")),
    bytes: src.length,
    sourceMtimeMs: Math.trunc(stat.mtimeMs),
  };
  if (action === "unchanged") {
    entry.verified = true;
  } else if (ctx.apply && (action === "copy" || action === "overwrite")) {
    entry.verified = await writeVerified(ctx, to, src, stat.mtimeMs);
    entry.destSha256 = entry.verified ? srcSha : entry.destSha256;
  }
  return entry;
}

async function readLegacyLedgers(legacyGroupDir: string) {
  const out: Array<{ label: string; file: string; content: string }> = [];
  for (const rel of LEGACY_LEDGER_FILES) {
    const file = path.join(legacyGroupDir, rel);
    const content = await readMaybe(file);
    if (content) {
      out.push({ label: rel, file, content: content.toString("utf8") });
    }
  }
  return out;
}

/** Ledger sync. Forward: legacy file(s) → `<ns>`; reverse: `<ns>` → legacy canonical. */
async function syncLedger(
  ctx: Ctx,
  legacyGroupDir: string,
  ns: RuntimeNamespace,
  reverse: boolean,
): Promise<FileEntry | null> {
  const legacy = await readLegacyLedgers(legacyGroupDir);
  const nsBuf = await readMaybe(ns.ledgerFile);
  const nsContent = nsBuf ? nsBuf.toString("utf8") : null;
  const canonical = path.join(legacyGroupDir, LEGACY_LEDGER_FILES[0]);
  if (!reverse && legacy.length === 0) {
    return null;
  }
  if (reverse && nsContent === null) {
    return null;
  }
  if (!reverse && legacy.length === 1 && nsContent === null) {
    // Single source, first migration: verbatim copy (sha256 identical).
    return await syncFile(ctx, LEDGER_FACT, legacy[0].file, ns.ledgerFile, null);
  }
  const canonicalContent = legacy.find((s) => s.file === canonical)?.content ?? null;
  const merged = reverse
    ? mergeLedgerSources({
        sources: [{ label: "namespace", content: nsContent ?? "" }],
        existingTarget: canonicalContent ?? "",
        knownKeys: legacy.flatMap((s) => [...ledgerKeys(s.content)]),
      })
    : mergeLedgerSources({
        sources: legacy.map((s) => ({ label: s.label, content: s.content })),
        existingTarget: nsContent,
      });
  const destPath = reverse ? canonical : ns.ledgerFile;
  const destExists = reverse ? canonicalContent !== null : nsContent !== null;
  const action: FileAction = merged.appended === 0 ? "unchanged" : destExists ? "append" : "merge";
  const entry: FileEntry = {
    fact: LEDGER_FACT,
    from: reverse ? [ns.ledgerFile] : legacy.map((s) => s.file),
    to: destPath,
    action,
    sourceSha256: merged.sha256,
    lines: merged.lines,
    bytes: Buffer.byteLength(merged.content),
    duplicatesDropped: merged.duplicatesDropped,
  };
  const sourceTexts = reverse ? [nsContent ?? ""] : legacy.map((s) => s.content);
  if (action === "unchanged") {
    entry.verified = true;
  } else if (ctx.apply) {
    const ok = await writeVerified(ctx, destPath, Buffer.from(merged.content, "utf8"));
    const written = new Set([
      ...ledgerKeys((await fs.readFile(destPath)).toString("utf8")),
      ...(reverse ? legacy.flatMap((s) => [...ledgerKeys(s.content)]) : []),
    ]);
    const covered = sourceTexts.every((text) => [...ledgerKeys(text)].every((k) => written.has(k)));
    entry.verified = ok && covered;
    entry.destSha256 = merged.sha256;
  }
  return entry;
}

async function readManifest(ns: RuntimeNamespace): Promise<MigrationManifest | null> {
  const raw = await readMaybe(path.join(ns.root, MIGRATION_SUBDIR, MANIFEST_FILENAME));
  return raw ? (JSON.parse(raw.toString("utf8")) as MigrationManifest) : null;
}

async function migrateGroup(
  ctx: Ctx,
  groupId: string,
  legacyGroupDir: string,
  tenant: GroupTenant,
): Promise<GroupReport> {
  const reverse = ctx.opts.direction === "reverse";
  const legacyRounds = path.join(legacyGroupDir, LEGACY_ROUNDS_RELATIVE);
  const ns =
    tenant.status === "resolved"
      ? resolveMigrationNamespace(ctx.opts.target, groupId, tenant.tenantId)
      : null;
  const files: FileEntry[] = [];
  if (ns) {
    const manifest = await readManifest(ns);
    const [srcRounds, dstRounds] = reverse
      ? [ns.roundsDir, legacyRounds]
      : [legacyRounds, ns.roundsDir];
    for (const name of (await listDir(srcRounds, "file")).filter(isRoundFactFile)) {
      const fact = `rounds/${name}`;
      files.push(
        await syncFile(ctx, fact, path.join(srcRounds, name), path.join(dstRounds, name), manifest),
      );
    }
    const ledger = await syncLedger(ctx, legacyGroupDir, ns, reverse);
    if (ledger) {
      files.push(ledger);
    }
    if (ctx.apply && files.some((f) => CHANGING.has(f.action))) {
      await persistManifest(ctx, { groupId, legacyGroupDir, ns, files, previous: manifest });
    }
  }
  const failed = files.some((f) => f.action === "conflict" || (ctx.apply && f.verified === false));
  const changed = files.some((f) => CHANGING.has(f.action));
  const status: GroupStatus = !ns
    ? "quarantined"
    : files.length === 0
      ? "skipped_no_runtime_facts"
      : failed
        ? "failed"
        : !changed
          ? "unchanged"
          : ctx.apply
            ? "migrated"
            : "planned";
  const report: GroupReport = {
    groupId,
    legacyGroupDir,
    status,
    tenant,
    namespaceRoot: ns?.root ?? null,
    files,
    nonTerminalRounds: await listNonTerminalRounds(reverse && ns ? ns.roundsDir : legacyRounds),
    retainedOnLegacyStore: await listRetained(legacyGroupDir),
    audit: {
      kind: "collab_runtime_namespace_migration",
      version: 1,
      runId: ctx.runId,
      actor: "migration",
      mode: ctx.apply ? "apply" : "dry-run",
      direction: reverse ? "reverse" : "forward",
      groupId,
      tenantId: tenant.status === "resolved" ? tenant.tenantId : null,
      tenantKey: ns?.tenantKey ?? null,
      reason: tenant.reason,
      from: reverse && ns ? ns.root : legacyGroupDir,
      to: reverse ? legacyGroupDir : (ns?.root ?? null),
      status,
      recordedAtMs: ctx.now(),
    },
  };
  if (ctx.apply && ns && changed) {
    await appendAudit(ns, report);
  }
  return report;
}

async function persistManifest(
  ctx: Ctx,
  params: {
    groupId: string;
    legacyGroupDir: string;
    ns: RuntimeNamespace;
    files: FileEntry[];
    previous: MigrationManifest | null;
  },
) {
  const { ns, previous } = params;
  const files: Record<string, ManifestFile> = { ...previous?.files };
  for (const f of params.files) {
    if (f.verified && f.destSha256) {
      files[f.fact] = {
        baselineSha256: f.destSha256,
        lines: f.lines ?? 0,
        bytes: f.bytes ?? 0,
        ...(f.sourceMtimeMs !== undefined ? { sourceMtimeMs: f.sourceMtimeMs } : {}),
      };
    }
  }
  const direction = ctx.opts.direction === "reverse" ? "reverse" : "forward";
  const manifest: MigrationManifest = {
    version: 1,
    groupId: params.groupId,
    tenantId: ns.tenantId,
    tenantKey: ns.tenantKey,
    profile: ns.profile,
    source: { legacyGroupDir: params.legacyGroupDir },
    target: { namespaceRoot: ns.root },
    files,
    history: [
      ...(previous?.history ?? []),
      { runId: ctx.runId, direction, atMs: ctx.now(), files: params.files.length },
    ],
  };
  const dir = path.join(ns.root, MIGRATION_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);
  if (direction === "forward") {
    const marker = { runId: ctx.runId, namespaceRoot: ns.root, tenantKey: ns.tenantKey };
    await fs.writeFile(
      path.join(params.legacyGroupDir, MIGRATED_TO_FILENAME),
      `${JSON.stringify(marker, null, 2)}\n`,
    );
  }
}

async function appendAudit(ns: RuntimeNamespace, report: GroupReport) {
  const dir = path.join(ns.root, MIGRATION_SUBDIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(path.join(dir, AUDIT_FILENAME), `${JSON.stringify(report.audit)}\n`);
}

/** A group already migrated to another namespace is never silently re-homed. */
async function checkMarker(
  opts: MigrationOptions,
  legacyGroupDir: string,
  tenant: GroupTenant,
): Promise<GroupTenant> {
  const raw = await readMaybe(path.join(legacyGroupDir, MIGRATED_TO_FILENAME));
  if (!raw || tenant.status !== "resolved") {
    return tenant;
  }
  const marker = JSON.parse(raw.toString("utf8")) as { namespaceRoot?: string; tenantKey?: string };
  const groupId = decodeGroupDirName(path.basename(legacyGroupDir));
  const root = resolveMigrationNamespace(opts.target, groupId, tenant.tenantId).root;
  if (!marker.namespaceRoot || path.resolve(marker.namespaceRoot) === path.resolve(root)) {
    return tenant;
  }
  return {
    status: "quarantine",
    reason: "tenant-changed-since-last-migration",
    candidates: [marker.tenantKey ?? "?", tenant.tenantId ?? "_local"],
    evidence: [...tenant.evidence, `${MIGRATED_TO_FILENAME}:${marker.namespaceRoot}`],
  };
}

/** Reverse discovery: every namespace under the target, keyed by groupId → tenants. */
async function discoverTargetGroups(target: MigrationTarget) {
  const found = new Map<string, Array<{ tenantId: string | null; dirName: string }>>();
  const add = (dirName: string, tenantId: string | null) => {
    const groupId = decodeGroupDirName(dirName);
    found.set(groupId, [...(found.get(groupId) ?? []), { tenantId, dirName }]);
  };
  if (target.profile === "managed_enterprise") {
    for (const tenantId of await listDir(target.tenantsRoot, "dir")) {
      const groupsRoot = path.join(target.tenantsRoot, tenantId, "collaboration", "groups");
      for (const dirName of await listDir(groupsRoot, "dir")) {
        if ((await listDir(path.join(groupsRoot, dirName), "dir")).includes("runtime")) {
          add(dirName, tenantId);
        }
      }
    }
  } else {
    for (const dirName of await listDir(target.groupsRoot, "dir")) {
      add(dirName, null);
    }
  }
  return found;
}

export async function runRuntimeNamespaceMigration(
  opts: MigrationOptions,
): Promise<MigrationReport> {
  const now = opts.now ?? Date.now;
  const ctx: Ctx = {
    opts,
    apply: opts.apply === true,
    now,
    runId: opts.runId ?? `ns-migrate-${now()}`,
  };
  const wanted = opts.groupIds?.length ? new Set(opts.groupIds) : null;
  const groups: GroupReport[] = [];
  if (opts.direction === "reverse") {
    for (const [groupId, homes] of await discoverTargetGroups(opts.target)) {
      if (wanted && !wanted.has(groupId)) {
        continue;
      }
      const legacyGroupDir = path.join(opts.sourceGroupsRoot, encodeURIComponent(groupId));
      const tenant: GroupTenant =
        homes.length === 1
          ? {
              status: "resolved",
              tenantId: homes[0].tenantId,
              reason: "target-namespace",
              evidence: [],
            }
          : {
              status: "quarantine",
              reason: "tenant-conflict",
              candidates: homes.map((h) => h.tenantId ?? "_local"),
              evidence: ["same groupId under several tenants; legacy root cannot hold both"],
            };
      groups.push(await migrateGroup(ctx, groupId, legacyGroupDir, tenant));
    }
  } else {
    for (const dirName of await listDir(opts.sourceGroupsRoot, "dir")) {
      const groupId = decodeGroupDirName(dirName);
      if (wanted && !wanted.has(groupId)) {
        continue;
      }
      const legacyGroupDir = path.join(opts.sourceGroupsRoot, dirName);
      const tenant: GroupTenant =
        opts.target.profile === "managed_enterprise"
          ? await inferGroupTenant({
              groupId,
              legacyGroupDir,
              tenantMap: opts.tenantMap,
              tenantsRoot: opts.target.tenantsRoot,
            })
          : { status: "resolved", tenantId: null, reason: "personal-local", evidence: [] };
      groups.push(
        await migrateGroup(
          ctx,
          groupId,
          legacyGroupDir,
          await checkMarker(opts, legacyGroupDir, tenant),
        ),
      );
    }
  }
  return {
    runId: ctx.runId,
    mode: ctx.apply ? "apply" : "dry-run",
    direction: opts.direction ?? "forward",
    sourceGroupsRoot: opts.sourceGroupsRoot,
    target: opts.target,
    groups,
    totals: summarize(groups),
  };
}
