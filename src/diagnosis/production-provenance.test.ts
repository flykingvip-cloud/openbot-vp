import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  provenancePeeledTargetMatchesLive,
  provenanceShaForLiveCompare,
  provenanceTagNameForSha,
  resolvePeeledProvenanceTag,
} from "./production-provenance.js";

const LIVE = "04690f8d2ed51f24a06825c153b7c1885d17182a";
const TAG_OBJECT = "8efc2eaa052590713dd3edc210b09c748a8c34e5";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function gitOk(args: readonly string[]): boolean {
  try {
    execFileSync("git", [...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

describe("provenance peeled-target resolution", () => {
  it("peels the annotated LIVE tag to the commit, not the tag object", () => {
    const tagName = "provenance/sha-04690f8d2ed5";
    const mockGit = (args: readonly string[]): string => {
      const joined = args.join(" ");
      if (
        joined.includes(`${tagName}^{commit}`) ||
        joined.includes(`refs/tags/${tagName}^{commit}`)
      ) {
        return LIVE;
      }
      if (joined.includes(tagName) || joined.includes(`refs/tags/${tagName}`)) {
        return TAG_OBJECT;
      }
      throw new Error(`unexpected git args: ${joined}`);
    };
    const mockGitOk = (args: readonly string[]): boolean => {
      try {
        mockGit(args);
        return true;
      } catch {
        return false;
      }
    };
    const resolved = resolvePeeledProvenanceTag(LIVE, { git: mockGit, gitOk: mockGitOk });
    expect(resolved.tagName).toBe(tagName);
    expect(resolved.tagObjectSha).toBe(TAG_OBJECT);
    expect(resolved.peeledCommitSha).toBe(LIVE);
    expect(resolved.tagObjectSha).not.toBe(resolved.peeledCommitSha);
    expect(provenanceShaForLiveCompare(resolved)).toBe(LIVE);
    expect(provenanceShaForLiveCompare(resolved)).not.toBe(TAG_OBJECT);
    expect(
      provenancePeeledTargetMatchesLive({
        liveSha: LIVE,
        peeledCommitSha: resolved.peeledCommitSha,
      }),
    ).toBe(true);
    expect(provenancePeeledTargetMatchesLive({ liveSha: LIVE, peeledCommitSha: TAG_OBJECT })).toBe(
      false,
    );
  });

  it("returns a missing peel when the provenance tag does not exist", () => {
    const missing = "ffffffffffffffffffffffffffffffffffffffff";
    const resolved = resolvePeeledProvenanceTag(missing, { git, gitOk });
    expect(resolved.tagName).toBe(provenanceTagNameForSha(missing));
    expect(resolved.tagObjectSha).toBeNull();
    expect(resolved.peeledCommitSha).toBeNull();
    expect(provenanceShaForLiveCompare(resolved)).toBeNull();
    expect(
      provenancePeeledTargetMatchesLive({
        liveSha: missing,
        peeledCommitSha: resolved.peeledCommitSha,
      }),
    ).toBe(false);
  });

  it("does not treat a missing live SHA as a peeled match", () => {
    expect(provenanceTagNameForSha(null)).toBeNull();
    expect(resolvePeeledProvenanceTag(null, { git, gitOk })).toEqual({
      tagName: null,
      tagObjectSha: null,
      peeledCommitSha: null,
    });
    expect(provenancePeeledTargetMatchesLive({ liveSha: null, peeledCommitSha: LIVE })).toBe(false);
  });
});
