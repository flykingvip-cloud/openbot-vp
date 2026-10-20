import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeStewardCutover } from "./steward-materialize.js";
import { verifiedCopyStewardWorkspace } from "./steward-write.js";

const tmpDirs: string[] = [];
function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steward-materialize-"));
  tmpDirs.push(dir);
  return dir;
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      try {
        fs.chmodSync(dir, 0o755);
      } catch {
        // ignore
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("materializeStewardCutover", () => {
  it("stages, atomically publishes, and preserves the source (all-or-nothing)", () => {
    const root = tmpRoot();
    const sourceRoot = path.join(root, "src");
    const targetRoot = path.join(root, "tgt");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "report.md"), "steward-bytes");

    const result = materializeStewardCutover({
      sourceRoot,
      targetRoot,
      stagingRoot: `${targetRoot}.staging-op`,
      quarantineRoot: `${targetRoot}.quarantine-op`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.published).toBe(targetRoot);
    expect(typeof result.digest).toBe("string");
    // Target holds the copied bytes.
    expect(fs.readFileSync(path.join(targetRoot, "report.md"), "utf8")).toBe("steward-bytes");
    // Source preserved (never moved/renamed).
    expect(fs.existsSync(path.join(sourceRoot, "report.md"))).toBe(true);
    // Staging consumed by the atomic publish (rename), not left behind.
    expect(fs.existsSync(`${targetRoot}.staging-op`)).toBe(false);
  });

  it("never clobbers an already-published target", () => {
    const root = tmpRoot();
    const sourceRoot = path.join(root, "src");
    const targetRoot = path.join(root, "tgt");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "existing.md"), "keep");

    const result = materializeStewardCutover({
      sourceRoot,
      targetRoot,
      stagingRoot: `${targetRoot}.staging-op`,
      quarantineRoot: `${targetRoot}.quarantine-op`,
    });

    expect(result).toMatchObject({ ok: false, reason: "target_exists", residualPath: null });
    // Existing target untouched.
    expect(fs.readFileSync(path.join(targetRoot, "existing.md"), "utf8")).toBe("keep");
  });

  it.skipIf(isRoot)(
    "quarantines the partial staging and records a residual path when the copy throws",
    () => {
      const root = tmpRoot();
      const sourceRoot = path.join(root, "src");
      const targetRoot = path.join(root, "tgt");
      fs.mkdirSync(sourceRoot, { recursive: true });
      const unreadable = path.join(sourceRoot, "secret.bin");
      fs.writeFileSync(unreadable, "top-secret");
      fs.chmodSync(unreadable, 0o000); // force cpSync to throw mid-copy

      const stagingRoot = `${targetRoot}.staging-op`;
      const quarantineRoot = `${targetRoot}.quarantine-op`;
      const result = materializeStewardCutover({
        sourceRoot,
        targetRoot,
        stagingRoot,
        quarantineRoot,
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.reason).toBe("copy_failed");
      // The partial artifact was quarantined (never exposed as the live target).
      expect(result.residualPath).toBe(quarantineRoot);
      expect(fs.existsSync(quarantineRoot)).toBe(true);
      expect(fs.existsSync(targetRoot)).toBe(false);
      expect(fs.existsSync(stagingRoot)).toBe(false);
    },
  );
});

describe("verifiedCopyStewardWorkspace (structured failure)", () => {
  it("returns source_missing when the source does not exist", () => {
    const root = tmpRoot();
    expect(
      verifiedCopyStewardWorkspace({
        sourceRoot: path.join(root, "nope"),
        targetRoot: path.join(root, "tgt"),
      }),
    ).toMatchObject({ ok: false, reason: "source_missing" });
  });

  it("converts a thrown copy into a structured copy_failed (no exception escapes)", () => {
    const root = tmpRoot();
    // Source is a FILE; copying a non-directory into a directory target throws inside cpSync.
    const sourceFile = path.join(root, "src-file");
    fs.writeFileSync(sourceFile, "x");
    const targetRoot = path.join(root, "tgt");
    fs.mkdirSync(targetRoot, { recursive: true });
    expect(verifiedCopyStewardWorkspace({ sourceRoot: sourceFile, targetRoot })).toMatchObject({
      ok: false,
      reason: "copy_failed",
    });
  });

  it("reports digest_mismatch when the target diverges from the source", () => {
    const root = tmpRoot();
    const sourceRoot = path.join(root, "src");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "a.txt"), "a");
    // Pre-populate the target with an extra file cpSync will not remove -> digests differ.
    const targetRoot = path.join(root, "tgt");
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "extra.txt"), "extra");
    expect(verifiedCopyStewardWorkspace({ sourceRoot, targetRoot })).toMatchObject({
      ok: false,
      reason: "digest_mismatch",
    });
  });

  it("succeeds and returns a digest for a clean copy", () => {
    const root = tmpRoot();
    const sourceRoot = path.join(root, "src");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "a.txt"), "a");
    const result = verifiedCopyStewardWorkspace({ sourceRoot, targetRoot: path.join(root, "tgt") });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.digest).toBe("string");
    }
  });
});
