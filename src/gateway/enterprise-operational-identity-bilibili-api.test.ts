import { describe, expect, it } from "vitest";
import {
  BILIBILI_SINGLE_PART_MAX_BYTES,
  loadBilibiliVideoFile,
  resolveBilibiliExpiresAtIso,
} from "./enterprise-operational-identity-bilibili-api.js";

describe("loadBilibiliVideoFile", () => {
  it("decodes raw base64 video payload", async () => {
    const data = Buffer.from("hello-bilibili-video");
    const loaded = await loadBilibiliVideoFile({
      videoBase64: data.toString("base64"),
      videoFilename: "clip.mp4",
    });
    expect(loaded.filename).toBe("clip.mp4");
    expect(loaded.data.equals(data)).toBe(true);
  });

  it("rejects oversized base64 video for single-part upload", async () => {
    const oversized = Buffer.alloc(BILIBILI_SINGLE_PART_MAX_BYTES + 1, 1);
    await expect(
      loadBilibiliVideoFile({
        videoBase64: oversized.toString("base64"),
      }),
    ).rejects.toThrow("20MB");
  });
});

describe("resolveBilibiliExpiresAtIso", () => {
  it("treats large expires_in as absolute unix seconds", () => {
    expect(resolveBilibiliExpiresAtIso(1_630_220_614, "2026-01-01T00:00:00.000Z")).toBe(
      "2021-08-29T07:30:14.000Z",
    );
  });

  it("treats small expires_in as relative seconds", () => {
    expect(resolveBilibiliExpiresAtIso(3600, "2026-01-01T00:00:00.000Z")).toBe(
      "2026-01-01T01:00:00.000Z",
    );
  });
});
