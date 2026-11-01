import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalSparkleBuildFromVersion } from "../scripts/sparkle-build.ts";

const APPCAST_URL = new URL("../appcast.xml", import.meta.url);

describe("appcast.xml", () => {
  it("uses canonical sparkle build for the latest stable appcast entry", () => {
    const appcast = readFileSync(APPCAST_URL, "utf8");
    const items = [...appcast.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1] ?? "");
    expect(items.length).toBeGreaterThan(0);

    const parsed = items
      .map((item) => {
        const shortVersion = item.match(
          /<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/,
        )?.[1];
        const sparkleVersion = item.match(/<sparkle:version>([^<]+)<\/sparkle:version>/)?.[1];
        return { shortVersion, sparkleVersion };
      })
      .filter((row) => row.shortVersion && row.sparkleVersion);

    expect(parsed.length).toBeGreaterThan(0);

    // CalVer short versions must use the canonical Sparkle build floor.
    const calver = parsed.find(
      (row) => canonicalSparkleBuildFromVersion(row.shortVersion!) != null,
    );
    if (calver) {
      expect(calver.sparkleVersion).toBe(
        String(canonicalSparkleBuildFromVersion(calver.shortVersion!)),
      );
      return;
    }

    // Legacy semver appcast entries (e.g. 1.0.4) keep a numeric sparkle:version
    // outside the CalVer floor mapping.
    for (const row of parsed) {
      expect(row.sparkleVersion).toMatch(/^\d+$/);
      expect(canonicalSparkleBuildFromVersion(row.shortVersion!)).toBeNull();
    }
  });
});
