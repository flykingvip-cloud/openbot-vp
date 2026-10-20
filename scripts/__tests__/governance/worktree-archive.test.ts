import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArchiveError,
  buildManifest,
  classifyXy,
  createArchive,
  diffManifests,
  hasContent,
  loadManifest,
  MANIFEST_FILE,
  type Manifest,
  PAYLOAD_DIR,
  parsePorcelainZ,
  rehearseRestore,
  verifyArchive,
} from "../../governance/worktree-archive.js";

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** A repo with one commit, so `git status` has a baseline to diff against. */
function repo(): string {
  const dir = tmp("wt-archive-repo-");
  git(["init", "-q", "."], dir);
  git(["config", "user.email", "t@t"], dir);
  git(["config", "user.name", "t"], dir);
  writeFileSync(join(dir, "tracked.txt"), "original\n");
  git(["add", "-A"], dir);
  git(["commit", "-qm", "init"], dir);
  return dir;
}

function write(dir: string, rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("worktree-archive — classifyXy", () => {
  it("treats ?? as untracked before anything else", () => {
    expect(classifyXy("??")).toBe("untracked");
  });

  // Delete must win over add/modify: a staged delete has no worktree bytes, so
  // classifying it as modified would make the archiver try to read a gone file.
  it("prefers deleted over other flags", () => {
    expect(classifyXy(" D")).toBe("deleted");
    expect(classifyXy("D ")).toBe("deleted");
    expect(classifyXy("AD")).toBe("deleted");
  });

  it("classifies rename and copy", () => {
    expect(classifyXy("R ")).toBe("renamed");
    expect(classifyXy("C ")).toBe("renamed");
  });

  it("classifies add and modify", () => {
    expect(classifyXy("A ")).toBe("added");
    expect(classifyXy(" M")).toBe("modified");
    expect(classifyXy("MM")).toBe("modified");
  });

  it("only deleted entries lack content", () => {
    expect(hasContent("deleted")).toBe(false);
    for (const kind of ["modified", "added", "untracked", "renamed", "symlink"] as const) {
      expect(hasContent(kind)).toBe(true);
    }
  });
});

describe("worktree-archive — parsePorcelainZ", () => {
  it("parses plain entries", () => {
    expect(parsePorcelainZ(" M a.ts\0?? b.ts\0")).toEqual([
      { xy: " M", path: "a.ts" },
      { xy: "??", path: "b.ts" },
    ]);
  });

  // Rename entries emit destination then source as the NEXT token; consuming one
  // token would turn the source path into a phantom entry.
  it("consumes the source token of a rename", () => {
    const entries = parsePorcelainZ("R  new.ts\0old.ts\0 M other.ts\0");
    expect(entries).toEqual([
      { xy: "R ", path: "new.ts", originalPath: "old.ts" },
      { xy: " M", path: "other.ts" },
    ]);
  });

  it("preserves non-ASCII paths verbatim (this is why -z is mandatory)", () => {
    const entries = parsePorcelainZ(" M AI项目/文件.ts\0");
    expect(entries).toEqual([{ xy: " M", path: "AI项目/文件.ts" }]);
  });

  it("ignores empty trailing tokens", () => {
    expect(parsePorcelainZ("")).toEqual([]);
    expect(parsePorcelainZ("\0\0")).toEqual([]);
  });
});

describe("worktree-archive — diffManifests", () => {
  const manifest = (entries: { path: string; sha256?: string }[]): Manifest =>
    ({
      version: 1,
      createdAt: "",
      repo: { head: "", headBranch: "", upstream: "", ahead: 0, behind: 0 },
      entries: entries.map((e) => ({ ...e, xy: " M", kind: "modified" as const })),
      counts: { total: entries.length, withContent: entries.length, deleted: 0, symlinks: 0 },
    }) as Manifest;

  it("reports nothing for identical manifests", () => {
    const m = manifest([{ path: "a", sha256: "1" }]);
    expect(diffManifests(m, m)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("detects added, removed, and content-changed paths", () => {
    const before = manifest([
      { path: "keep", sha256: "1" },
      { path: "gone", sha256: "2" },
      { path: "edited", sha256: "3" },
    ]);
    const after = manifest([
      { path: "keep", sha256: "1" },
      { path: "edited", sha256: "3-changed" },
      { path: "fresh", sha256: "4" },
    ]);
    expect(diffManifests(before, after)).toEqual({
      added: ["fresh"],
      removed: ["gone"],
      changed: ["edited"],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildManifest — the -uall property is the whole point
// ─────────────────────────────────────────────────────────────────────────────

describe("worktree-archive — buildManifest", () => {
  it("expands untracked directories to file level", () => {
    // Without `-uall` git collapses this into a single `?? nested/` entry and the
    // three files never reach the archive. Measured on the real repository: 58
    // collapsed entries vs 105 expanded — 47 files would be silently lost.
    const dir = repo();
    write(dir, "nested/a.ts", "a");
    write(dir, "nested/deep/b.ts", "b");
    write(dir, "nested/deep/c.ts", "c");

    const collapsed = git(["status", "--porcelain=v1"], dir)
      .split("\n")
      .filter((l) => l.startsWith("??"));
    expect(collapsed).toEqual(["?? nested/"]); // git's default really does collapse

    const paths = buildManifest(dir).entries.map((e) => e.path);
    expect(paths).toEqual(["nested/a.ts", "nested/deep/b.ts", "nested/deep/c.ts"]);
  });

  it("hashes worktree content and records size", () => {
    const dir = repo();
    write(dir, "tracked.txt", "changed\n");
    const entry = buildManifest(dir).entries.find((e) => e.path === "tracked.txt")!;
    expect(entry.kind).toBe("modified");
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.size).toBe("changed\n".length);
  });

  it("records a deleted file with no checksum", () => {
    const dir = repo();
    rmSync(join(dir, "tracked.txt"));
    const entry = buildManifest(dir).entries.find((e) => e.path === "tracked.txt")!;
    expect(entry.kind).toBe("deleted");
    expect(entry.sha256).toBeUndefined();
    expect(buildManifest(dir).counts.deleted).toBe(1);
  });

  // Following the link would copy content owned by something else, and on restore
  // would silently replace a link with a file.
  it("records a symlink by its target, without following it", () => {
    const dir = repo();
    symlinkSync("tracked.txt", join(dir, "link.txt"));
    const entry = buildManifest(dir).entries.find((e) => e.path === "link.txt")!;
    expect(entry.kind).toBe("symlink");
    expect(entry.linkTarget).toBe("tracked.txt");
    expect(buildManifest(dir).counts.symlinks).toBe(1);
  });

  it("sorts entries by path so manifests are comparable", () => {
    const dir = repo();
    write(dir, "z.ts", "z");
    write(dir, "a.ts", "a");
    write(dir, "m.ts", "m");
    const paths = buildManifest(dir).entries.map((e) => e.path);
    expect(paths).toEqual([...paths].toSorted());
  });

  it("records head, branch, and divergence from the upstream", () => {
    const dir = repo();
    write(dir, "x.ts", "x");
    const m = buildManifest(dir, "HEAD");
    expect(m.repo.head).toMatch(/^[0-9a-f]{40}$/);
    expect(m.repo.upstream).toBe("HEAD");
    expect(m.repo.ahead).toBe(0);
    expect(m.repo.behind).toBe(0);
  });

  it("tolerates a missing upstream instead of throwing", () => {
    const dir = repo();
    write(dir, "x.ts", "x");
    expect(() => buildManifest(dir, "origin/does-not-exist")).not.toThrow();
  });

  it("counts only content-bearing entries as archivable", () => {
    const dir = repo();
    write(dir, "new.ts", "n");
    rmSync(join(dir, "tracked.txt"));
    const counts = buildManifest(dir).counts;
    expect(counts.total).toBe(2);
    expect(counts.withContent).toBe(1);
    expect(counts.deleted).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createArchive / verify / rehearse
// ─────────────────────────────────────────────────────────────────────────────

describe("worktree-archive — createArchive", () => {
  it("copies content-bearing files under files/ preserving paths", () => {
    const dir = repo();
    write(dir, "nested/deep/a.ts", "hello");
    write(dir, "tracked.txt", "changed\n");
    const out = tmp("wt-archive-out-");

    const { manifest, drift } = createArchive(out, dir, "HEAD");
    expect(drift).toEqual({ added: [], removed: [], changed: [] });
    expect(manifest.counts.withContent).toBe(2);
    expect(readFileSync(join(out, PAYLOAD_DIR, "nested/deep/a.ts"), "utf8")).toBe("hello");
    expect(readFileSync(join(out, PAYLOAD_DIR, "tracked.txt"), "utf8")).toBe("changed\n");
    expect(loadManifest(out).entries).toHaveLength(2);
  });

  it("keeps a symlink a symlink rather than copying its target", () => {
    const dir = repo();
    symlinkSync("tracked.txt", join(dir, "link.txt"));
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");
    expect(verifyArchive(out).ok).toBe(true);
  });

  // Regression: `cpSync(..., { dereference: false })` rewrites a RELATIVE link
  // target into an absolute path resolved against the source directory. That
  // defeats the entire purpose here — the archive exists to survive the worktree
  // moving, and an absolute target points back at where the worktree used to be,
  // so every restored link would be wrong or dangling. Caught by the rehearsal on
  // its first run.
  it("preserves a relative link target verbatim, not as an absolute path", () => {
    const dir = repo();
    symlinkSync("tracked.txt", join(dir, "link.txt"));
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");
    expect(readlinkSync(join(out, PAYLOAD_DIR, "link.txt"))).toBe("tracked.txt");
  });

  it("preserves a nested relative link target verbatim", () => {
    const dir = repo();
    mkdirSync(join(dir, "a/b"), { recursive: true });
    symlinkSync("../../tracked.txt", join(dir, "a/b/up.txt"));
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");
    expect(readlinkSync(join(out, PAYLOAD_DIR, "a/b/up.txt"))).toBe("../../tracked.txt");
    expect(verifyArchive(out).ok).toBe(true);
  });

  it("does not try to archive a deleted file", () => {
    const dir = repo();
    rmSync(join(dir, "tracked.txt"));
    const out = tmp("wt-archive-out-");
    const { manifest } = createArchive(out, dir, "HEAD");
    expect(manifest.counts.deleted).toBe(1);
    expect(verifyArchive(out).ok).toBe(true); // nothing to check, nothing missing
  });

  it("round-trips non-ASCII paths", () => {
    const dir = repo();
    write(dir, "AI项目/文件.ts", "内容");
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");
    expect(readFileSync(join(out, PAYLOAD_DIR, "AI项目/文件.ts"), "utf8")).toBe("内容");
    expect(verifyArchive(out).ok).toBe(true);
  });
});

describe("worktree-archive — verifyArchive", () => {
  it("fails on a missing archived file", () => {
    const dir = repo();
    write(dir, "a.ts", "a");
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");
    rmSync(join(out, PAYLOAD_DIR, "a.ts"));
    const result = verifyArchive(out);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["a.ts"]);
  });

  it("fails on a corrupted archived file", () => {
    const dir = repo();
    write(dir, "a.ts", "a");
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");
    writeFileSync(join(out, PAYLOAD_DIR, "a.ts"), "tampered");
    const result = verifyArchive(out);
    expect(result.ok).toBe(false);
    expect(result.mismatched).toEqual(["a.ts"]);
  });

  it("rejects a directory with no manifest", () => {
    expect(() => verifyArchive(tmp("wt-archive-empty-"))).toThrow(ArchiveError);
  });

  it("rejects an unsupported manifest version", () => {
    const out = tmp("wt-archive-out-");
    writeFileSync(join(out, MANIFEST_FILE), JSON.stringify({ version: 99 }));
    expect(() => loadManifest(out)).toThrow(/version 99/);
  });
});

describe("worktree-archive — rehearseRestore", () => {
  // Verifying in place only proves the copy is self-consistent. Restoring proves
  // the archive can be turned back into files at the right paths, which is the
  // property the branch switch actually depends on.
  it("restores every file to a scratch dir with matching checksums", () => {
    const dir = repo();
    write(dir, "nested/deep/a.ts", "hello");
    write(dir, "AI项目/文件.ts", "内容");
    write(dir, "tracked.txt", "changed\n");
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");

    const result = rehearseRestore(out);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(3);
    expect(result.missing).toEqual([]);
    expect(result.mismatched).toEqual([]);
  });

  it("restores symlinks as symlinks with the target intact", () => {
    const dir = repo();
    symlinkSync("tracked.txt", join(dir, "link.txt"));
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");

    const result = rehearseRestore(out, true);
    scratchDirs.push(result.restoredTo);
    expect(result.ok).toBe(true);
    expect(readlinkSync(join(result.restoredTo, "link.txt"))).toBe("tracked.txt");
  });

  // A link may point at a file that was never dirty and so was never archived.
  // `existsSync` follows links, so that reads as "missing" unless handled.
  it("does not report a dangling archived link as missing", () => {
    const dir = repo();
    symlinkSync("never-dirty.txt", join(dir, "link.txt"));
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");
    const result = rehearseRestore(out);
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("detects a corrupted archive during rehearsal, not just in verify", () => {
    const dir = repo();
    write(dir, "a.ts", "a");
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");
    writeFileSync(join(out, PAYLOAD_DIR, "a.ts"), "tampered");
    const result = rehearseRestore(out);
    expect(result.ok).toBe(false);
    expect(result.mismatched).toEqual(["a.ts"]);
  });

  it("cleans up the scratch dir unless --keep is requested", () => {
    const dir = repo();
    write(dir, "a.ts", "a");
    const out = tmp("wt-archive-out-");
    createArchive(out, dir, "HEAD");

    const cleaned = rehearseRestore(out, false);
    expect(existsSync(cleaned.restoredTo)).toBe(false);

    const kept = rehearseRestore(out, true);
    scratchDirs.push(kept.restoredTo);
    expect(existsSync(kept.restoredTo)).toBe(true);
  });
});
