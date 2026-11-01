import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  __setCapabilityAdmissionStorePathForTest,
  upsertModelAdmission,
} from "../../gateway/models/capability-admission/store.js";
import {
  STEPFUN_IMAGE_MODEL_ID,
  normalizeStepfunImageSize,
  resolveStepfunImageApiBaseUrl,
  resolveStepfunImageEndpointConfig,
  toWorkspaceRelativeImagePath,
} from "./stepfun-image-tool.helpers.js";

const readFileMock = vi.hoisted(() => vi.fn());
const loadWebMediaMock = vi.hoisted(() =>
  vi.fn(async () => ({
    buffer: Buffer.from("source-image"),
    mimeType: "image/png",
    kind: "image" as const,
  })),
);

vi.mock("../../web/media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../web/media.js")>();
  return {
    ...actual,
    loadWebMedia: loadWebMediaMock,
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: readFileMock,
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
});

const baseCfg = {
  models: {
    providers: {
      阶跃星辰: {
        baseUrl: "https://api.stepfun.com/step_plan/v1",
        apiKey: "test-key",
        models: [{ id: STEPFUN_IMAGE_MODEL_ID }],
      },
    },
  },
} as unknown as OpenBotConfig;

describe("resolveStepfunImageApiBaseUrl", () => {
  it("maps step_plan chat base URL to image API /v1", () => {
    expect(resolveStepfunImageApiBaseUrl("https://api.stepfun.com/step_plan/v1")).toBe(
      "https://api.stepfun.com/v1",
    );
  });

  it("keeps an existing /v1 base URL unchanged", () => {
    expect(resolveStepfunImageApiBaseUrl("https://api.stepfun.com/v1")).toBe(
      "https://api.stepfun.com/v1",
    );
  });
});

describe("resolveStepfunImageEndpointConfig", () => {
  it("auto-discovers step-image-edit-2 from provider config", () => {
    const resolved = resolveStepfunImageEndpointConfig(baseCfg);
    expect(resolved).toEqual({
      provider: "阶跃星辰",
      model: STEPFUN_IMAGE_MODEL_ID,
      baseUrl: "https://api.stepfun.com/step_plan/v1",
    });
  });

  it("prefers agents.defaults.imageGenerationModel when configured", () => {
    const cfg = {
      ...baseCfg,
      agents: {
        defaults: {
          imageModel: {
            primary: "google/gemini-2.0-flash",
          },
          imageGenerationModel: {
            primary: "阶跃星辰/step-image-edit-2",
          },
        },
      },
    } as unknown as OpenBotConfig;
    expect(resolveStepfunImageEndpointConfig(cfg)?.model).toBe(STEPFUN_IMAGE_MODEL_ID);
  });

  it("prefers agents.defaults.imageModel when it is a generation model", () => {
    const cfg = {
      ...baseCfg,
      agents: {
        defaults: {
          imageModel: {
            primary: "阶跃星辰/step-image-edit-2",
          },
        },
      },
    } as unknown as OpenBotConfig;
    expect(resolveStepfunImageEndpointConfig(cfg)?.model).toBe(STEPFUN_IMAGE_MODEL_ID);
  });

  it("skips chat imageModel google/gemini-2.0-flash and auto-discovers step-image-edit-2", () => {
    const cfg = {
      models: {
        providers: {
          google: {
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            apiKey: "google-key",
            models: [{ id: "gemini-2.0-flash" }],
          },
          阶跃星辰: {
            baseUrl: "https://api.stepfun.com/step_plan/v1",
            apiKey: "test-key",
            models: [{ id: "gemini-2.0-flash" }, { id: STEPFUN_IMAGE_MODEL_ID }],
          },
        },
      },
      agents: {
        defaults: {
          imageModel: {
            primary: "google/gemini-2.0-flash",
          },
        },
      },
    } as unknown as OpenBotConfig;
    expect(resolveStepfunImageEndpointConfig(cfg)).toEqual({
      provider: "阶跃星辰",
      model: STEPFUN_IMAGE_MODEL_ID,
      baseUrl: "https://api.stepfun.com/step_plan/v1",
    });
  });

  it("skips a Stepfun-hosted chat model listed as imageModel", () => {
    const cfg = {
      ...baseCfg,
      models: {
        providers: {
          阶跃星辰: {
            baseUrl: "https://api.stepfun.com/step_plan/v1",
            apiKey: "test-key",
            models: [{ id: "gemini-2.0-flash" }, { id: STEPFUN_IMAGE_MODEL_ID }],
          },
        },
      },
      agents: {
        defaults: {
          imageModel: {
            primary: "阶跃星辰/gemini-2.0-flash",
          },
        },
      },
    } as unknown as OpenBotConfig;
    expect(resolveStepfunImageEndpointConfig(cfg)?.model).toBe(STEPFUN_IMAGE_MODEL_ID);
  });
});

describe("normalizeStepfunImageSize", () => {
  it("defaults to 1024x1024", () => {
    expect(normalizeStepfunImageSize()).toBe("1024x1024");
  });

  it("rejects unsupported sizes", () => {
    expect(() => normalizeStepfunImageSize("512x512")).toThrow(/Invalid size/);
  });
});

describe("toWorkspaceRelativeImagePath", () => {
  it("returns a POSIX path under the workspace", () => {
    expect(
      toWorkspaceRelativeImagePath(
        "/tmp/openbot-test/.openbot/generated-images/stepfun-gen-1.png",
        "/tmp/openbot-test",
      ),
    ).toBe(".openbot/generated-images/stepfun-gen-1.png");
  });
});

describe("createStepfunImageTool", () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  afterEach(() => {
    __setCapabilityAdmissionStorePathForTest(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null when step-image-edit-2 is not configured", async () => {
    const { createStepfunImageTool } = await import("./stepfun-image-tool.js");
    expect(createStepfunImageTool({ config: { models: { providers: {} } } })).toBeNull();
  });

  it("does not expose image_gen when only a chat imageModel is configured", async () => {
    const { createStepfunImageTool } = await import("./stepfun-image-tool.js");
    expect(
      createStepfunImageTool({
        config: {
          models: {
            providers: {
              google: {
                baseUrl: "https://generativelanguage.googleapis.com/v1beta",
                apiKey: "google-key",
                models: [{ id: "gemini-2.0-flash" }],
              },
            },
          },
          agents: {
            defaults: {
              imageModel: { primary: "google/gemini-2.0-flash" },
            },
          },
        } as unknown as OpenBotConfig,
      }),
    ).toBeNull();
  });

  it("generates an image and saves it locally", async () => {
    const pngBytes = Buffer.from("fake-png-bytes");
    readFileMock.mockResolvedValue(pngBytes);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.stepfun.com/v1/images/generations");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ data: [{ b64_json: pngBytes.toString("base64") }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createStepfunImageTool } = await import("./stepfun-image-tool.js");
    const tool = createStepfunImageTool({ config: baseCfg, workspaceDir: "/tmp/openbot-test" });
    expect(tool?.name).toBe("image_gen");

    const result = await tool!.execute("call-1", {
      prompt: "a red apple on white background",
      size: "1024x1024",
    });

    const textBlock = result.content.find((block) => block.type === "text");
    expect(textBlock?.type).toBe("text");
    if (textBlock?.type === "text") {
      expect(textBlock.text).toMatch(/^MEDIA:/);
      expect(textBlock.text).toContain("relativePath: .openbot/generated-images/");
      expect(textBlock.text).toContain('type="image"');
      expect(textBlock.text).toContain(SILENT_REPLY_TOKEN);
    }
    expect(result.details).toMatchObject({
      relativePath: expect.stringMatching(/^\.openbot\/generated-images\//),
      workspaceFilename: expect.stringMatching(/^\.openbot\/generated-images\//),
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const posted = init?.body;
    expect(typeof posted).toBe("string");
    expect(JSON.parse(posted as string)).toMatchObject({
      model: STEPFUN_IMAGE_MODEL_ID,
      prompt: "a red apple on white background",
    });
  });

  it("does not send google/gemini-2.0-flash to Stepfun images/generations", async () => {
    const pngBytes = Buffer.from("fake-png-bytes");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.stepfun.com/v1/images/generations");
      const posted = init?.body;
      expect(typeof posted).toBe("string");
      const body = JSON.parse(posted as string);
      expect(body.model).toBe(STEPFUN_IMAGE_MODEL_ID);
      expect(body.model).not.toBe("gemini-2.0-flash");
      return new Response(JSON.stringify({ data: [{ b64_json: pngBytes.toString("base64") }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createStepfunImageTool } = await import("./stepfun-image-tool.js");
    const tool = createStepfunImageTool({
      config: {
        models: {
          providers: {
            google: {
              baseUrl: "https://generativelanguage.googleapis.com/v1beta",
              apiKey: "google-key",
              models: [{ id: "gemini-2.0-flash" }],
            },
            阶跃星辰: {
              baseUrl: "https://api.stepfun.com/step_plan/v1",
              apiKey: "test-key",
              models: [{ id: STEPFUN_IMAGE_MODEL_ID }],
            },
          },
        },
        agents: {
          defaults: {
            imageModel: { primary: "google/gemini-2.0-flash" },
          },
        },
      } as unknown as OpenBotConfig,
      workspaceDir: "/tmp/openbot-test",
    });
    expect(tool?.name).toBe("image_gen");
    await tool!.execute("call-gemini-skip", { prompt: "a lighthouse at dusk" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces empty Stepfun 404 as a model-name mismatch, not a dead API", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("", {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createStepfunImageTool } = await import("./stepfun-image-tool.js");
    const tool = createStepfunImageTool({ config: baseCfg, workspaceDir: "/tmp/openbot-test" });
    await expect(
      tool!.execute("call-404", { prompt: "a red apple on white background" }),
    ).rejects.toThrow(/Stepfun image generation failed \(404\): empty response/);
  });

  it("edits an image via multipart upload", async () => {
    const outBytes = Buffer.from("edited-png");
    readFileMock.mockResolvedValue(outBytes);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.stepfun.com/v1/images/edits");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ data: [{ b64_json: outBytes.toString("base64") }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { createStepfunImageTool } = await import("./stepfun-image-tool.js");
    const tool = createStepfunImageTool({ config: baseCfg, workspaceDir: "/tmp/openbot-test" });
    const result = await tool!.execute("call-2", {
      prompt: "make the background blue",
      mode: "edit",
      image: "https://example.com/source.png",
    });

    expect(loadWebMediaMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const textBlock = result.content.find((block) => block.type === "text");
    expect(textBlock?.type).toBe("text");
    if (textBlock?.type === "text") {
      expect(textBlock.text).toMatch(/^MEDIA:/);
      expect(textBlock.text).toContain("relativePath: .openbot/generated-images/");
    }
  });

  it("does not call Stepfun when the platform image model is paused", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-stepfun-admit-"));
    const storePath = path.join(dir, "admission.json");
    __setCapabilityAdmissionStorePathForTest(storePath);
    await upsertModelAdmission(
      `阶跃星辰/${STEPFUN_IMAGE_MODEL_ID}`,
      { autoRouting: "paused", autoRoutingReason: "管理员暂停" },
      storePath,
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("generation must not be called");
    });
    vi.stubGlobal("fetch", fetchMock);
    const generate = vi.spyOn(
      await import("./stepfun-image-tool.helpers.js"),
      "callStepfunImageGeneration",
    );
    const edit = vi.spyOn(await import("./stepfun-image-tool.helpers.js"), "callStepfunImageEdit");
    const { createStepfunImageTool } = await import("./stepfun-image-tool.js");
    const tool = createStepfunImageTool({ config: baseCfg, workspaceDir: dir });
    await expect(tool!.execute("call-paused", { prompt: "海报" })).rejects.toMatchObject({
      code: "PLATFORM_ADMISSION_EMPTY",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    generate.mockRestore();
    edit.mockRestore();
  });
});
