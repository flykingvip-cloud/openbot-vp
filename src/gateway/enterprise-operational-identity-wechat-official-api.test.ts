import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  isWechatHostedContentImageUrl,
  loadWechatOfficialContentImage,
  loadWechatOfficialThumbImage,
  looksLikeFilesystemImagePath,
  normalizeWechatOfficialThumbJpeg,
  readWechatApiId,
  WECHAT_OFFICIAL_CONTENT_IMAGE_MAX_BYTES,
  WECHAT_OFFICIAL_THUMB_MAX_BYTES,
  WECHAT_OFFICIAL_THUMB_SOURCE_MAX_BYTES,
} from "./enterprise-operational-identity-wechat-official-api.js";

describe("loadWechatOfficialThumbImage", () => {
  it("decodes raw base64 thumb payload", async () => {
    const data = Buffer.from("hello-thumb");
    const loaded = await loadWechatOfficialThumbImage({
      thumbBase64: data.toString("base64"),
      thumbFilename: "cover.jpg",
    });
    expect(loaded.filename).toBe("cover.jpg");
    expect(loaded.data.equals(data)).toBe(true);
  });

  it("rejects oversized base64 thumb payload beyond source max", async () => {
    const oversized = Buffer.alloc(WECHAT_OFFICIAL_THUMB_SOURCE_MAX_BYTES + 1, 1);
    await expect(
      loadWechatOfficialThumbImage({
        thumbBase64: oversized.toString("base64"),
      }),
    ).rejects.toThrow("字节上限");
  });

  it("rejects filesystem path strings passed as thumbBase64", async () => {
    expect(looksLikeFilesystemImagePath("/tmp/cover.jpg")).toBe(true);
    await expect(
      loadWechatOfficialThumbImage({
        thumbBase64: "/tmp/cover.png",
      }),
    ).rejects.toThrow("本地文件路径");
  });

  it("allows source larger than thumb cap (normalize later)", async () => {
    const big = Buffer.alloc(WECHAT_OFFICIAL_THUMB_MAX_BYTES + 1024, 1);
    const loaded = await loadWechatOfficialThumbImage({
      thumbBase64: big.toString("base64"),
      thumbFilename: "big.bin",
    });
    expect(loaded.data.length).toBe(big.length);
  });
});

describe("normalizeWechatOfficialThumbJpeg", () => {
  it("re-encodes PNG to JPEG under the 64KB thumb cap", async () => {
    const png = await sharp({
      create: {
        width: 900,
        height: 383,
        channels: 3,
        background: { r: 10, g: 20, b: 80 },
      },
    })
      .png()
      .toBuffer();
    const normalized = await normalizeWechatOfficialThumbJpeg(png);
    expect(normalized.contentType).toBe("image/jpeg");
    expect(normalized.filename).toBe("thumb.jpg");
    expect(normalized.data.length).toBeGreaterThan(0);
    expect(normalized.data.length).toBeLessThanOrEqual(WECHAT_OFFICIAL_THUMB_MAX_BYTES);
    expect(normalized.data[0]).toBe(0xff);
    expect(normalized.data[1]).toBe(0xd8);
  });

  it("rejects garbage bytes that are not an image", async () => {
    await expect(normalizeWechatOfficialThumbJpeg(Buffer.from("hello-thumb"))).rejects.toThrow(
      /无法解码|unsupported file type/,
    );
  });
});

describe("loadWechatOfficialContentImage", () => {
  it("decodes raw base64 content image payload", async () => {
    const data = Buffer.from("hello-content-image");
    const loaded = await loadWechatOfficialContentImage({
      imageBase64: data.toString("base64"),
      imageFilename: "inline.jpg",
    });
    expect(loaded.filename).toBe("inline.jpg");
    expect(loaded.data.equals(data)).toBe(true);
  });

  it("rejects oversized base64 content image payload", async () => {
    const oversized = Buffer.alloc(WECHAT_OFFICIAL_CONTENT_IMAGE_MAX_BYTES + 1, 1);
    await expect(
      loadWechatOfficialContentImage({
        imageBase64: oversized.toString("base64"),
      }),
    ).rejects.toThrow("字节上限");
  });
});

describe("readWechatApiId", () => {
  it("accepts numeric WeChat publish_id values", () => {
    expect(readWechatApiId(2247483650)).toBe("2247483650");
    expect(readWechatApiId("  pub-1 ")).toBe("pub-1");
    expect(readWechatApiId(undefined)).toBe("");
  });
});

describe("isWechatHostedContentImageUrl", () => {
  it("detects wechat hosted image urls", () => {
    expect(isWechatHostedContentImageUrl("https://mmbiz.qpic.cn/mmbiz_jpg/example/0")).toBe(true);
    expect(isWechatHostedContentImageUrl("https://cdn.example.com/a.jpg")).toBe(false);
  });
});
