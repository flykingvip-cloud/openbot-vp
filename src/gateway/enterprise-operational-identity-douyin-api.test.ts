import { describe, expect, it } from "vitest";
import {
  DOUYIN_SIMPLE_UPLOAD_MAX_BYTES,
  loadDouyinVideoFile,
} from "./enterprise-operational-identity-douyin-api.js";

describe("loadDouyinVideoFile", () => {
  it("decodes raw base64 video payload", async () => {
    const data = Buffer.from("hello-douyin-video");
    const loaded = await loadDouyinVideoFile({
      videoBase64: data.toString("base64"),
      videoFilename: "clip.mp4",
    });
    expect(loaded.filename).toBe("clip.mp4");
    expect(loaded.data.equals(data)).toBe(true);
  });

  it("rejects oversized base64 video for simple upload", async () => {
    const oversized = Buffer.alloc(DOUYIN_SIMPLE_UPLOAD_MAX_BYTES + 1, 1);
    await expect(
      loadDouyinVideoFile({
        videoBase64: oversized.toString("base64"),
      }),
    ).rejects.toThrow("50MB");
  });
});
