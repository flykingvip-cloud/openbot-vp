// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  __setCapabilityAdmissionStorePathForTest,
  upsertModelAdmission,
} from "../../gateway/models/capability-admission/store.js";
import { SUNO_MUSIC_MODEL_ID } from "../music-generation-models.js";
import {
  resolveSunoMusicApiUrl,
  resolveSunoMusicEndpointConfig,
  toWorkspaceRelativeAudioPath,
} from "./suno-music-tool.helpers.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  __setCapabilityAdmissionStorePathForTest(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(
    tmpDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

function musicCfg(): OpenBotConfig {
  return {
    models: {
      providers: {
        suno: {
          baseUrl: "https://api.sunoapi.org/api/v1",
          apiKey: "test-key",
          models: [{ id: SUNO_MUSIC_MODEL_ID }],
        },
      },
    },
    agents: {
      defaults: {
        musicGenerationModel: { primary: `suno/${SUNO_MUSIC_MODEL_ID}` },
      },
    },
  } as unknown as OpenBotConfig;
}

describe("suno-music-tool helpers", () => {
  it("resolves endpoint from musicGenerationModel", () => {
    const endpoint = resolveSunoMusicEndpointConfig(musicCfg());
    expect(endpoint).toEqual({
      provider: "suno",
      model: SUNO_MUSIC_MODEL_ID,
      baseUrl: "https://api.sunoapi.org/api/v1",
    });
  });

  it("returns null when music generation is not configured", () => {
    expect(resolveSunoMusicEndpointConfig({} as OpenBotConfig)).toBeNull();
  });

  it("builds generations URL", () => {
    expect(resolveSunoMusicApiUrl("https://api.sunoapi.org/api/v1")).toBe(
      "https://api.sunoapi.org/api/v1/music/generations",
    );
    expect(resolveSunoMusicApiUrl("https://example.com/v1/music")).toBe(
      "https://example.com/v1/music/generations",
    );
  });

  it("maps workspace-relative audio paths", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-music-ws-"));
    tmpDirs.push(ws);
    const abs = path.join(ws, ".openbot", "generated-audio", "suno-gen-1.mp3");
    expect(toWorkspaceRelativeAudioPath(abs, ws)).toBe(".openbot/generated-audio/suno-gen-1.mp3");
  });
});

describe("createSunoMusicTool", () => {
  it("does not expose music_gen without config", async () => {
    const { createSunoMusicTool } = await import("./suno-music-tool.js");
    expect(createSunoMusicTool({ config: {} as OpenBotConfig, agentDir: "/tmp" })).toBeNull();
  });

  it("calls mock generations API and returns MEDIA path", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-music-tool-"));
    tmpDirs.push(ws);
    const audioBytes = Buffer.from("ID3fake-audio");
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.sunoapi.org/api/v1/music/generations");
      return new Response(JSON.stringify({ data: [{ b64_json: audioBytes.toString("base64") }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createSunoMusicTool } = await import("./suno-music-tool.js");
    const tool = createSunoMusicTool({
      config: musicCfg(),
      agentDir: ws,
      workspaceDir: ws,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(tool?.name).toBe("music_gen");
    const result = await tool!.execute("call-1", { prompt: "upbeat lo-fi beat" });
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === "text",
    )?.text;
    expect(text).toMatch(/^MEDIA:/);
    expect(text).toContain(".openbot/generated-audio/");
    expect(result.details).toMatchObject({
      provider: "suno",
      model: `suno/${SUNO_MUSIC_MODEL_ID}`,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not call the Suno-compatible API when that platform model is paused", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-suno-admit-"));
    tmpDirs.push(dir);
    const storePath = path.join(dir, "admission.json");
    __setCapabilityAdmissionStorePathForTest(storePath);
    await upsertModelAdmission(
      `suno/${SUNO_MUSIC_MODEL_ID}`,
      { autoRouting: "paused", autoRoutingReason: "管理员暂停" },
      storePath,
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("generation must not be called");
    });
    const { createSunoMusicTool } = await import("./suno-music-tool.js");
    const tool = createSunoMusicTool({
      config: musicCfg(),
      agentDir: dir,
      workspaceDir: dir,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(tool!.execute("call-paused", { prompt: "配乐" })).rejects.toMatchObject({
      code: "PLATFORM_ADMISSION_EMPTY",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
