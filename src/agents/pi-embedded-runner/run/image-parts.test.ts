import { describe, expect, it } from "vitest";
import {
  containsObjectObjectToken,
  formatUnsupportedImageInputMessage,
  isStructuredImagePart,
  serializeMultimodalContent,
  toOpenAiCompatibleImageParts,
} from "./image-parts.js";
import { detectAndLoadPromptImages, modelSupportsImages } from "./images.js";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";
const JPEG_1x1 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwD/2Q==";

describe("serializeMultimodalContent", () => {
  it("serializes a text-only message without image parts", () => {
    const parts = serializeMultimodalContent({ text: "hello" });
    expect(parts).toEqual([{ type: "text", text: "hello" }]);
    expect(containsObjectObjectToken(parts)).toBe(false);
  });

  it("serializes an image-only message as image_url parts", () => {
    const parts = serializeMultimodalContent({
      images: [{ type: "image", data: PNG_1x1, mimeType: "image/png" }],
    });
    expect(parts).toEqual([
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${PNG_1x1}` },
      },
    ]);
    expect(containsObjectObjectToken(parts)).toBe(false);
  });

  it("serializes text + image as structured multimodal content", () => {
    const parts = serializeMultimodalContent({
      text: "what is in this screenshot?",
      images: [{ type: "image", data: PNG_1x1, mimeType: "image/png" }],
    });
    expect(parts[0]).toEqual({ type: "text", text: "what is in this screenshot?" });
    expect(parts[1]).toMatchObject({ type: "image_url" });
    expect(JSON.stringify(parts)).toContain('"type":"image_url"');
    expect(containsObjectObjectToken(parts)).toBe(false);
  });

  it("keeps PNG mime in the data URL", () => {
    const [part] = toOpenAiCompatibleImageParts([
      { type: "image", data: PNG_1x1, mimeType: "image/png" },
    ]);
    expect(part?.image_url.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("keeps JPEG mime in the data URL", () => {
    const [part] = toOpenAiCompatibleImageParts([
      { type: "image", data: JPEG_1x1, mimeType: "image/jpeg" },
    ]);
    expect(part?.image_url.url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("drops invalid image parts instead of stringifying them", () => {
    expect(isStructuredImagePart({ type: "image" })).toBe(false);
    expect(isStructuredImagePart("[object Object]")).toBe(false);
    const parts = toOpenAiCompatibleImageParts([
      { type: "image", data: "", mimeType: "image/png" },
    ] as never);
    expect(parts).toEqual([]);
  });
});

describe("unsupported model + OpenAI-compatible endpoints", () => {
  it("reports a clear unsupported-model message", () => {
    const message = formatUnsupportedImageInputMessage({
      provider: "custom-bm",
      modelId: "MiniMax-M2.7-highspeed",
      visionModelHint: "api-proxy-google/gemini-3-flash-preview",
    });
    expect(message).toContain("does not support image input");
    expect(message).toContain("gemini-3-flash-preview");
  });

  it("keeps structured image_url parts for a vision OpenAI-compatible endpoint", () => {
    const model = { input: ["text", "image"] };
    expect(modelSupportsImages(model)).toBe(true);
    const payload = serializeMultimodalContent({
      text: "describe",
      images: [{ type: "image", data: PNG_1x1, mimeType: "image/png" }],
    });
    expect(payload.some((part) => part.type === "image_url")).toBe(true);
    expect(containsObjectObjectToken(payload)).toBe(false);
  });

  it("drops image parts for a text-only OpenAI-compatible endpoint instead of sending them", async () => {
    const model = { input: ["text"] };
    expect(modelSupportsImages(model)).toBe(false);
    const result = await detectAndLoadPromptImages({
      prompt: "describe this",
      workspaceDir: "/tmp",
      model,
      existingImages: [{ type: "image", data: PNG_1x1, mimeType: "image/png" }],
    });
    expect(result.images).toEqual([]);
    expect(serializeMultimodalContent({ text: "describe this", images: result.images })).toEqual([
      { type: "text", text: "describe this" },
    ]);
  });

  it("does not coerce image parts through String() ([object Object] regression)", () => {
    const images = [
      { type: "image" as const, data: PNG_1x1, mimeType: "image/png" },
      { type: "image" as const, data: JPEG_1x1, mimeType: "image/jpeg" },
    ];
    const serialized = serializeMultimodalContent({ text: "compare", images });
    expect(containsObjectObjectToken(serialized)).toBe(false);
    expect(JSON.stringify(serialized)).toContain('"type":"image_url"');
    expect(JSON.stringify(serialized)).not.toContain("[object Object]");
  });
});
