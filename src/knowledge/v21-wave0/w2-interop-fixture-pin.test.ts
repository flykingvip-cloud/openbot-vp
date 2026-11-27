import { execFileSync } from "node:child_process";
/**
 * OBS-W2-01 guards: the pinned Sync-W2-1 golden fixture must stay byte-exact.
 * Flags stay unset. Formal T-01–T-27 is not claimed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURE_REL = "src/knowledge/v21-wave0/interop-fixtures/w2_interop_golden.json";
const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "interop-fixtures",
  "w2_interop_golden.json",
);
const EXPECTED_SHA256 = "f8033a902af06b005fa591ab872a74f9569a3783fd3e7cef90c6dc94cf9d0fef";
const EXPECTED_BYTES = 33863;
const EXPECTED_GIT_BLOB = "5afaff1616ddd77dca604dc498fc691ae4a4f37b";

describe("W2 interop golden fixture pin guards", () => {
  it("fails if worktree bytes are not 33863 or SHA-256 is not f8033a90...", () => {
    const bytes = readFileSync(FIXTURE_PATH);
    expect(bytes.byteLength).toBe(EXPECTED_BYTES);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(EXPECTED_SHA256);
  });

  it("fails if worktree bytes != git blob at HEAD", () => {
    const worktreeBlob = execFileSync("git", ["hash-object", FIXTURE_PATH], {
      encoding: "utf8",
    }).trim();
    const headBlob = execFileSync("git", ["rev-parse", `HEAD:${FIXTURE_REL}`], {
      encoding: "utf8",
    }).trim();
    expect(worktreeBlob).toBe(EXPECTED_GIT_BLOB);
    expect(headBlob).toBe(EXPECTED_GIT_BLOB);
    expect(worktreeBlob).toBe(headBlob);
  });
});
