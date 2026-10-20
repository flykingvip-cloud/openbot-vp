/**
 * worktree-archive.ts — file-level archive of a dirty working tree, with a
 * restore rehearsal (engineering-governance D4 / task 0.5.3).
 *
 * WHY THIS EXISTS
 *
 * The original recovery plan said "create `backup/<topic>-<date>` before moving
 * the main worktree". A branch ref saves the COMMIT GRAPH and nothing else. This
 * repository currently carries ~200 modified and untracked files that are in no
 * commit at all, ~141 of them unattributed. A ref protects none of them.
 *
 * That protocol was written after the 2026-07-27 force-push, which stranded 40
 * ALREADY-COMMITTED commits. Reusing it for uncommitted worktree content is a
 * category error — see `.kiro/specs/engineering-governance/review-decision-2026-07-31.md`
 * §2.3.
 *
 * The one guardrail that matters is a rehearsal: an archive nobody has restored
 * is a belief, not a backup. `rehearse` restores into a scratch directory and
 * re-hashes every file; only a passing rehearsal clears the branch switch.
 *
 * Usage:
 *   bun scripts/governance/worktree-archive.ts manifest [--json] [--out <file>]
 *   bun scripts/governance/worktree-archive.ts archive  --out <dir>
 *   bun scripts/governance/worktree-archive.ts verify   --archive <dir>
 *   bun scripts/governance/worktree-archive.ts rehearse --archive <dir> [--keep]
 *
 * This tool NEVER switches branches, commits, or mutates tracked files. It only
 * reads the worktree and writes under `--out`. Moving the worktree itself remains
 * a human action (AGENTS.md forbids agents from switching branches or committing
 * on another agent's behalf).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export const MANIFEST_VERSION = 1 as const;
export const MANIFEST_FILE = "manifest.json";
export const PAYLOAD_DIR = "files";

/** What kind of change an entry represents, and whether content can be archived. */
export type EntryKind = "modified" | "added" | "untracked" | "deleted" | "renamed" | "symlink";

export type ManifestEntry = {
  path: string;
  /** Raw two-character porcelain XY code, kept verbatim for forensics. */
  xy: string;
  kind: EntryKind;
  /** sha256 of the worktree bytes. Absent for deleted entries (no content). */
  sha256?: string;
  size?: number;
  /** Symlink target, when `kind === "symlink"` (the link is archived, not its target). */
  linkTarget?: string;
  /** Rename/copy source path, as reported by porcelain -z. */
  originalPath?: string;
};

export type Manifest = {
  version: typeof MANIFEST_VERSION;
  createdAt: string;
  repo: {
    head: string;
    headBranch: string;
    /** Divergence from the configured upstream, recorded so a restore knows the base. */
    upstream: string;
    ahead: number;
    behind: number;
  };
  entries: ManifestEntry[];
  counts: {
    total: number;
    withContent: number;
    deleted: number;
    symlinks: number;
  };
};

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a porcelain XY code.
 *
 * Order matters: `??` is checked before `D`, because an untracked path never
 * carries a delete flag, and delete is checked before add/modify so a staged
 * delete is never archived as content that no longer exists.
 */
export function classifyXy(xy: string): EntryKind {
  if (xy === "??") {
    return "untracked";
  }
  if (xy.includes("D")) {
    return "deleted";
  }
  if (xy.includes("R") || xy.includes("C")) {
    return "renamed";
  }
  if (xy.includes("A")) {
    return "added";
  }
  return "modified";
}

/** True when the entry has worktree bytes worth archiving. */
export function hasContent(kind: EntryKind): boolean {
  return kind !== "deleted";
}

/**
 * Parse `git status --porcelain=v1 -z` output.
 *
 * `-z` is mandatory: paths in this repository contain non-ASCII characters, and
 * the non-`-z` form quotes and escapes them, which would corrupt the manifest.
 * Rename/copy entries emit the destination first and the source as the FOLLOWING
 * NUL-separated token, so those consume two tokens.
 */
export function parsePorcelainZ(
  output: string,
): { xy: string; path: string; originalPath?: string }[] {
  const tokens = output.split("\0");
  const entries: { xy: string; path: string; originalPath?: string }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (xy.includes("R") || xy.includes("C")) {
      entries.push({ xy, path, originalPath: tokens[i + 1] || undefined });
      i += 1;
      continue;
    }
    entries.push({ xy, path });
  }
  return entries;
}

/** Stable diff of two manifests by path + hash. Used as the freeze check. */
export function diffManifests(
  before: Manifest,
  after: Manifest,
): { added: string[]; removed: string[]; changed: string[] } {
  const beforeByPath = new Map(before.entries.map((e) => [e.path, e]));
  const afterByPath = new Map(after.entries.map((e) => [e.path, e]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [path, entry] of afterByPath) {
    const prior = beforeByPath.get(path);
    if (!prior) {
      added.push(path);
    } else if (prior.sha256 !== entry.sha256) {
      changed.push(path);
    }
  }
  for (const path of beforeByPath.keys()) {
    if (!afterByPath.has(path)) {
      removed.push(path);
    }
  }
  return { added: added.toSorted(), removed: removed.toSorted(), changed: changed.toSorted() };
}

// ─────────────────────────────────────────────────────────────────────────────
// IO boundary
// ─────────────────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Copy a file or symlink, preserving a relative link target VERBATIM.
 *
 * `cpSync(..., { dereference: false })` cannot be used for links: it resolves a
 * relative target against the source directory and writes an ABSOLUTE path. A
 * link recorded as `tracked.txt` comes out as
 * `/var/folders/.../sym-probe-XXX/tracked.txt`.
 *
 * That is not a cosmetic difference. The whole point of this archive is to
 * survive the worktree moving, and an absolute target points back at where the
 * worktree used to be — so every restored link would be wrong or dangling. The
 * restore rehearsal caught this on its first run, which is precisely why the
 * rehearsal is the gate rather than a formality.
 */
function copyPreservingLinks(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const stat = lstatSync(src);
  if (stat.isSymbolicLink()) {
    symlinkSync(readlinkSync(src), dest);
    return;
  }
  cpSync(src, dest, { dereference: false });
}

/** Read the bytes a checksum is computed over: link target for links, else content. */
function contentBytes(path: string): Buffer {
  return lstatSync(path).isSymbolicLink()
    ? Buffer.from(readlinkSync(path), "utf8")
    : readFileSync(path);
}

function countAheadBehind(cwd: string, upstream: string): { ahead: number; behind: number } {
  try {
    // `--left-right --count` prints "<behind>\t<ahead>" for `upstream...HEAD`.
    const out = git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], cwd).trim();
    const [behind, ahead] = out.split(/\s+/).map((n) => Number.parseInt(n, 10));
    return { ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

/**
 * Build a manifest of every dirty path, with checksums.
 *
 * `-uall` is mandatory. Without it git COLLAPSES untracked directories into a
 * single `?? dir/` entry: measured on this repository, the default form reports
 * 58 untracked entries where `-uall` reports 105 — 47 files would be silently
 * absent from the archive, which is exactly the failure this tool exists to
 * prevent.
 */
export function buildManifest(cwd: string = process.cwd(), upstream = "origin/main"): Manifest {
  const raw = git(["status", "--porcelain=v1", "-z", "-uall"], cwd);
  const parsed = parsePorcelainZ(raw);
  const entries: ManifestEntry[] = [];
  let withContent = 0;
  let deleted = 0;
  let symlinks = 0;

  for (const { xy, path, originalPath } of parsed) {
    const kind = classifyXy(xy);
    const entry: ManifestEntry = { path, xy, kind };
    if (originalPath) {
      entry.originalPath = originalPath;
    }
    if (!hasContent(kind)) {
      deleted += 1;
      entries.push(entry);
      continue;
    }
    const abs = join(cwd, path);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(abs);
    } catch {
      // Reported dirty but gone from disk: another agent removed it between the
      // status call and this read. Record it as deleted rather than guessing.
      entry.kind = "deleted";
      deleted += 1;
      entries.push(entry);
      continue;
    }
    if (stat.isSymbolicLink()) {
      // Archive the link itself, never its target: following it would silently
      // copy content that belongs to something else.
      entry.kind = "symlink";
      entry.linkTarget = readlinkSync(abs);
      entry.sha256 = sha256(Buffer.from(entry.linkTarget, "utf8"));
      symlinks += 1;
      withContent += 1;
      entries.push(entry);
      continue;
    }
    if (stat.isDirectory()) {
      // With `-uall` git reports files, so a directory here means a submodule or
      // a race. Skip content but keep it visible in the manifest.
      entries.push(entry);
      continue;
    }
    const bytes = readFileSync(abs);
    entry.sha256 = sha256(bytes);
    entry.size = bytes.byteLength;
    withContent += 1;
    entries.push(entry);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    version: MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    repo: {
      head: git(["rev-parse", "HEAD"], cwd).trim(),
      headBranch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim(),
      upstream,
      ...countAheadBehind(cwd, upstream),
    },
    entries,
    counts: { total: entries.length, withContent, deleted, symlinks },
  };
}

/**
 * Copy every content-bearing entry into `<out>/files/<path>` and write the
 * manifest.
 *
 * After copying, the manifest is rebuilt and compared. A non-empty diff means the
 * tree moved while we were reading it, so the archive is INCOMPLETE by
 * construction and the command fails. This is the mechanical form of the "freeze
 * writes first" step: measured drift on this repository was ~9 files in 30
 * minutes, so an unfrozen archive is not merely theoretical.
 */
export function createArchive(
  outDir: string,
  cwd: string = process.cwd(),
  upstream = "origin/main",
): { manifest: Manifest; drift: ReturnType<typeof diffManifests> } {
  const before = buildManifest(cwd, upstream);
  const payload = join(outDir, PAYLOAD_DIR);
  mkdirSync(payload, { recursive: true });

  for (const entry of before.entries) {
    if (!entry.sha256) {
      continue; // deleted, directory, or otherwise no bytes
    }
    copyPreservingLinks(join(cwd, entry.path), join(payload, entry.path));
  }

  const after = buildManifest(cwd, upstream);
  const drift = diffManifests(before, after);
  writeFileSync(join(outDir, MANIFEST_FILE), `${JSON.stringify(before, null, 2)}\n`, "utf8");
  return { manifest: before, drift };
}

export function loadManifest(archiveDir: string): Manifest {
  const file = join(archiveDir, MANIFEST_FILE);
  if (!existsSync(file)) {
    throw new ArchiveError(`no ${MANIFEST_FILE} in ${archiveDir}`);
  }
  // Untrusted input until validated: an archive directory may be hand-edited or
  // written by an older build, so the version must be checked before the shape is
  // assumed.
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const version = (parsed as { version?: unknown } | null)?.version;
  if (version !== MANIFEST_VERSION) {
    throw new ArchiveError(`manifest version ${String(version)} is not supported`);
  }
  return parsed as Manifest;
}

export type VerifyResult = {
  ok: boolean;
  checked: number;
  missing: string[];
  mismatched: string[];
};

/** Re-hash every archived file against the manifest. */
export function verifyArchive(archiveDir: string): VerifyResult {
  const manifest = loadManifest(archiveDir);
  const payload = join(archiveDir, PAYLOAD_DIR);
  const missing: string[] = [];
  const mismatched: string[] = [];
  let checked = 0;

  for (const entry of manifest.entries) {
    if (!entry.sha256) {
      continue;
    }
    const abs = join(payload, entry.path);
    let bytes: Buffer;
    try {
      bytes = contentBytes(abs);
    } catch {
      missing.push(entry.path);
      continue;
    }
    checked += 1;
    if (sha256(bytes) !== entry.sha256) {
      mismatched.push(entry.path);
    }
  }
  return { ok: missing.length === 0 && mismatched.length === 0, checked, missing, mismatched };
}

export type RehearsalResult = VerifyResult & { restoredTo: string };

/**
 * Restore the archive into a scratch directory and verify it there.
 *
 * Verifying in place only proves the copy is self-consistent. Restoring proves
 * the archive can actually be turned back into files at the right paths, which is
 * the property the branch switch depends on.
 */
export function rehearseRestore(archiveDir: string, keep = false): RehearsalResult {
  const manifest = loadManifest(archiveDir);
  const payload = join(archiveDir, PAYLOAD_DIR);
  const scratch = mkdtempSync(join(tmpdir(), "worktree-rehearse-"));
  const missing: string[] = [];
  const mismatched: string[] = [];
  let checked = 0;

  try {
    for (const entry of manifest.entries) {
      if (!entry.sha256) {
        continue;
      }
      const src = join(payload, entry.path);
      const dest = join(scratch, entry.path);
      // `existsSync` follows links, so a dangling archived link reads as absent —
      // and dangling is normal here: an archived link may point at a file that was
      // never dirty and therefore never archived.
      if (!existsSync(src) && !isBrokenSymlink(src)) {
        missing.push(entry.path);
        continue;
      }
      copyPreservingLinks(src, dest);
      checked += 1;
      if (sha256(contentBytes(dest)) !== entry.sha256) {
        mismatched.push(entry.path);
      }
    }
    return {
      ok: missing.length === 0 && mismatched.length === 0,
      checked,
      missing,
      mismatched,
      restoredTo: scratch,
    };
  } finally {
    if (!keep) {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

/** `existsSync` follows symlinks, so a dangling link reads as absent. */
function isBrokenSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function readOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function usage(): void {
  console.log("Usage: worktree-archive <manifest|archive|verify|rehearse> [options]");
  console.log("  manifest [--json] [--out <file>]      build a dirty manifest with checksums");
  console.log("  archive  --out <dir>                  copy dirty files + write the manifest");
  console.log("  verify   --archive <dir>              re-hash archived files vs the manifest");
  console.log("  rehearse --archive <dir> [--keep]     restore to a scratch dir and verify there");
}

function printManifestSummary(m: Manifest): void {
  console.log(`- head:      ${m.repo.head.slice(0, 10)} (${m.repo.headBranch})`);
  console.log(`- vs ${m.repo.upstream}: behind ${m.repo.behind}, ahead ${m.repo.ahead}`);
  console.log(`- entries:   ${m.counts.total}`);
  console.log(`- archivable: ${m.counts.withContent} (symlinks ${m.counts.symlinks})`);
  console.log(`- deleted:   ${m.counts.deleted} (no content to archive)`);
}

function main(argv: string[]): number {
  const [command, ...args] = argv;
  const cwd = process.cwd();

  if (!command || command === "--help" || command === "-h") {
    usage();
    return command ? 0 : 1;
  }

  if (command === "manifest") {
    const manifest = buildManifest(cwd);
    const out = readOpt(args, "--out");
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    if (out) {
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(out, json, "utf8");
      console.log(`Wrote manifest: ${out}`);
      printManifestSummary(manifest);
      return 0;
    }
    if (args.includes("--json")) {
      process.stdout.write(json);
      return 0;
    }
    console.log("Dirty manifest");
    printManifestSummary(manifest);
    return 0;
  }

  if (command === "archive") {
    const out = readOpt(args, "--out");
    if (!out) {
      console.error("archive requires --out <dir>");
      return 1;
    }
    const dir = resolve(out);
    if (existsSync(join(dir, MANIFEST_FILE))) {
      console.error(`refusing to overwrite an existing archive at ${dir}`);
      return 1;
    }
    const { manifest, drift } = createArchive(dir, cwd);
    console.log(`Archived to ${dir}`);
    printManifestSummary(manifest);
    const drifted = drift.added.length + drift.removed.length + drift.changed.length;
    if (drifted > 0) {
      console.error("");
      console.error(`ARCHIVE INCOMPLETE: the tree changed while archiving (${drifted} path(s)).`);
      for (const p of drift.added) {
        console.error(`  + ${p}`);
      }
      for (const p of drift.removed) {
        console.error(`  - ${p}`);
      }
      for (const p of drift.changed) {
        console.error(`  ~ ${p}`);
      }
      console.error("");
      console.error("Freeze writes to the worktree, then archive again. Do NOT switch branches");
      console.error("on the strength of this archive: it is missing changes by construction.");
      return 1;
    }
    console.log("");
    console.log("No drift during archiving. Next: rehearse the restore.");
    console.log(`  bun scripts/governance/worktree-archive.ts rehearse --archive ${dir}`);
    return 0;
  }

  if (command === "verify" || command === "rehearse") {
    const archive = readOpt(args, "--archive");
    if (!archive) {
      console.error(`${command} requires --archive <dir>`);
      return 1;
    }
    const dir = resolve(archive);
    const keep = args.includes("--keep");
    const isRehearsal = command === "rehearse";
    // Kept as two concrete calls rather than one union-typed result, so
    // `restoredTo` stays properly typed instead of widening to `unknown`.
    const result: VerifyResult = isRehearsal ? rehearseRestore(dir, keep) : verifyArchive(dir);

    console.log(isRehearsal ? "Restore rehearsal" : "Archive verification");
    console.log(`- checked:    ${result.checked}`);
    console.log(`- missing:    ${result.missing.length}`);
    console.log(`- mismatched: ${result.mismatched.length}`);
    if (isRehearsal && keep) {
      console.log(`- restored to: ${(result as RehearsalResult).restoredTo}`);
    }
    for (const p of result.missing.slice(0, 20)) {
      console.error(`  MISSING     ${p}`);
    }
    for (const p of result.mismatched.slice(0, 20)) {
      console.error(`  MISMATCHED  ${p}`);
    }
    if (!result.ok) {
      console.error("");
      console.error(`${command} FAILED. The archive is not restorable as recorded.`);
      return 1;
    }
    console.log("");
    console.log(
      isRehearsal
        ? "Rehearsal PASSED — every archived file restored with a matching checksum."
        : "Verification PASSED.",
    );
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  usage();
  return 1;
}

// Only run as a CLI when invoked directly, so tests can import the pure helpers.
if (
  process.argv[1] &&
  resolve(process.argv[1]).endsWith(join("governance", "worktree-archive.ts"))
) {
  process.exit(main(process.argv.slice(2)));
}

export { main as runCli, relative as _relative };
