import { describe, expect, it } from "vitest";
import {
  isWechatHostedContentImageUrl,
  loadWechatOfficialContentImage,
  loadWechatOfficialThumbImage,
  readWechatApiId,
  WECHAT_OFFICIAL_CONTENT_IMAGE_MAX_BYTES,
  WECHAT_OFFICIAL_THUMB_MAX_BYTES,
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

  it("rejects oversized base64 thumb payload", async () => {
    const oversized = Buffer.alloc(WECHAT_OFFICIAL_THUMB_MAX_BYTES + 1, 1);
    await expect(
      loadWechatOfficialThumbImage({
        thumbBase64: oversized.toString("base64"),
      }),
    ).rejects.toThrow("字节上限");
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
