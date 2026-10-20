import { describe, expect, it } from "vitest";
import {
  collectReleasePackageMetadataErrors,
  collectReleaseTagErrors,
  parseReleaseVersion,
} from "../scripts/openclaw-npm-release-check.ts";

describe("parseReleaseVersion", () => {
  it("parses stable SemVer releases", () => {
    expect(parseReleaseVersion("1.0.0")).toMatchObject({
      version: "1.0.0",
      channel: "stable",
      major: 1,
      minor: 0,
      patch: 0,
    });
  });

  it("parses beta SemVer releases", () => {
    expect(parseReleaseVersion("1.2.0-beta.2")).toMatchObject({
      version: "1.2.0-beta.2",
      channel: "beta",
      major: 1,
      minor: 2,
      patch: 0,
      betaNumber: 2,
    });
  });

  it("still parses legacy CalVer numbers as SemVer", () => {
    expect(parseReleaseVersion("2026.3.9")).toMatchObject({
      channel: "stable",
      major: 2026,
      minor: 3,
      patch: 9,
    });
  });

  it("rejects malformed release formats", () => {
    expect(parseReleaseVersion("1.0.0-1")).toBeNull();
    expect(parseReleaseVersion("1.0")).toBeNull();
    expect(parseReleaseVersion("01.0.0")).toBeNull();
    expect(parseReleaseVersion("v1.0.0")).toBeNull();
    expect(parseReleaseVersion("1.0.0-beta2")).toBeNull();
    expect(parseReleaseVersion("1.0.0-beta.0")).toBeNull();
  });
});

describe("collectReleaseTagErrors", () => {
  it("accepts a matching stable tag", () => {
    expect(
      collectReleaseTagErrors({
        packageVersion: "1.0.0",
        releaseTag: "v1.0.0",
      }),
    ).toEqual([]);
  });

  it("accepts a matching beta tag", () => {
    expect(
      collectReleaseTagErrors({
        packageVersion: "1.2.0-beta.1",
        releaseTag: "v1.2.0-beta.1",
      }),
    ).toEqual([]);
  });

  it("rejects tags that do not match the release format", () => {
    expect(
      collectReleaseTagErrors({
        packageVersion: "1.0.0",
        releaseTag: "v1.0.0-1",
      }),
    ).toContainEqual(expect.stringContaining("must match vX.Y.Z or vX.Y.Z-beta.N"));
  });

  it("rejects a tag that does not match the package version", () => {
    expect(
      collectReleaseTagErrors({
        packageVersion: "1.0.0",
        releaseTag: "v1.0.1",
      }),
    ).toContainEqual(expect.stringContaining("does not match package.json version"));
  });
});

describe("collectReleasePackageMetadataErrors", () => {
  it("validates the expected npm package metadata", () => {
    expect(
      collectReleasePackageMetadataErrors({
        name: "@upbeyond/openbot",
        description: "Multi-channel AI gateway with extensible messaging integrations",
        license: "MIT",
        repository: { url: "git+https://github.com/gmood2008/openbot.git" },
        bin: { openbot: "openbot.mjs" },
      }),
    ).toEqual([]);
  });
});
