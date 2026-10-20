import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRemoteCapabilityImport } from "./capability-remote-import.js";

describe("resolveRemoteCapabilityImport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a GitHub tree skill URL through the contents API", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = String(url);
      if (
        href.includes(
          "api.github.com/repos/anthropics/skills/contents/skills/skill-creator/SKILL.md",
        )
      ) {
        return {
          ok: true,
          json: async () => ({
            type: "file",
            encoding: "base64",
            content: Buffer.from(
              `---\nname: skill-creator\ndescription: Create new skills\nhomepage: https://github.com/anthropics/skills\n---\n`,
              "utf8",
            ).toString("base64"),
          }),
        };
      }
      return { ok: false };
    });

    const matches = await resolveRemoteCapabilityImport(
      "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.sourceId).toBe("github-url");
    expect(matches[0]?.externalId).toBe("anthropics/skills:skills/skill-creator");
    expect(matches[0]?.manifest.skillKey).toBe("skill-creator");
    expect(matches[0]?.manifest.name).toBe("Skill Creator");
  });

  it("keeps explicit GitHub skill paths actionable when remote content fetch fails", async () => {
    fetchMock.mockResolvedValue({ ok: false });

    const matches = await resolveRemoteCapabilityImport(
      "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.sourceId).toBe("github-url");
    expect(matches[0]?.externalId).toBe("anthropics/skills:skills/skill-creator");
    expect(matches[0]?.manifest.skillKey).toBe("skill-creator");
    expect(matches[0]?.manifest.name).toBe("Skill Creator");
  });

  it("searches npm-backed capability candidates for market keywords", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("registry.npmjs.org/-/v1/search")) {
        return {
          ok: true,
          json: async () => ({
            objects: [
              {
                package: {
                  name: "@openclaw/skill-weather",
                  version: "1.2.0",
                  description: "Weather capability",
                  homepage: "https://www.npmjs.com/package/@openclaw/skill-weather",
                },
              },
            ],
          }),
        };
      }
      return { ok: false };
    });

    const matches = await resolveRemoteCapabilityImport("weather");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.sourceId).toBe("npm");
    expect(matches[0]?.externalId).toBe("@openclaw/skill-weather");
  });
});
