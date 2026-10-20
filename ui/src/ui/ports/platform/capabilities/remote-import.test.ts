import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRemoteCapabilityCandidates } from "./remote-import.ts";

describe("resolveRemoteCapabilityCandidates", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a GitHub repository url to exact candidates", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.github.com/search/repositories")) {
        return {
          ok: true,
          json: async () => ({
            total_count: 1,
            items: [
              {
                full_name: "openclaw/skill-weather",
                name: "skill-weather",
                description: "Weather skill",
                html_url: "https://github.com/openclaw/skill-weather",
                default_branch: "main",
                owner: { login: "openclaw" },
                license: { spdx_id: "MIT" },
              },
            ],
          }),
        };
      }
      if (url.includes("raw.githubusercontent.com/openclaw/skill-weather")) {
        return {
          ok: true,
          text: async () =>
            `---\nname: weather\ndescription: Weather skill\nhomepage: https://github.com/openclaw/skill-weather\n---\n`,
        };
      }
      return { ok: false };
    });

    const matches = await resolveRemoteCapabilityCandidates(
      "https://github.com/openclaw/skill-weather",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.externalId).toBe("openclaw/skill-weather");
  });

  it("resolves an npm package url to exact candidates", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/-/v1/search")) {
        return {
          ok: true,
          json: async () => ({
            objects: [
              {
                package: {
                  name: "@openclaw/skill-weather",
                  version: "1.2.0",
                  description: "Weather forecast skill",
                },
              },
            ],
            total: 1,
          }),
        };
      }
      if (url.includes("%40openclaw%2Fskill-weather/latest")) {
        return {
          ok: true,
          json: async () => ({
            name: "@openclaw/skill-weather",
            version: "1.2.0",
            description: "Weather forecast skill",
            license: "MIT",
            homepage: "https://www.npmjs.com/package/@openclaw/skill-weather",
          }),
        };
      }
      return { ok: false };
    });

    const matches = await resolveRemoteCapabilityCandidates(
      "https://www.npmjs.com/package/@openclaw/skill-weather",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.externalId).toBe("@openclaw/skill-weather");
  });

  it("resolves a GitHub tree skill path to a direct SKILL candidate", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (
        url.includes(
          "api.github.com/repos/anthropics/skills/contents/skills/skill-creator/SKILL.md",
        )
      ) {
        return {
          ok: true,
          json: async () => ({
            type: "file",
            encoding: "base64",
            content: Buffer.from(
              `---\nname: canvas-design\ndescription: Canvas design skill\nhomepage: https://github.com/anthropics/skills\n---\n`,
              "utf8",
            ).toString("base64"),
          }),
        };
      }
      if (
        url.includes(
          "raw.githubusercontent.com/anthropics/skills/main/skills/canvas-design/SKILL.md",
        )
      ) {
        return {
          ok: true,
          text: async () =>
            `---\nname: canvas-design\ndescription: Canvas design skill\nhomepage: https://github.com/anthropics/skills\n---\n`,
        };
      }
      return { ok: false };
    });

    const matches = await resolveRemoteCapabilityCandidates(
      "https://github.com/anthropics/skills/tree/main/skills/canvas-design",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.externalId).toBe("anthropics/skills:skills/canvas-design");
    expect(matches[0]?.manifest.skillKey).toBe("canvas-design");
    expect(matches[0]?.provenance.registryName).toBe("github.com");
  });

  it("falls back to an actionable candidate for explicit GitHub skill paths", async () => {
    fetchMock.mockResolvedValue({ ok: false });

    const matches = await resolveRemoteCapabilityCandidates(
      "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.externalId).toBe("anthropics/skills:skills/skill-creator");
    expect(matches[0]?.manifest.skillKey).toBe("skill-creator");
    expect(matches[0]?.manifest.name).toBe("Skill Creator");
  });
});
