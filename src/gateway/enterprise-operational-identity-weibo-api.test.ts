import { describe, expect, it } from "vitest";
import {
  loadWeiboPicImage,
  WEIBO_PIC_MAX_BYTES,
} from "./enterprise-operational-identity-weibo-api.js";

describe("loadWeiboPicImage", () => {
  it("decodes raw base64 pic payload", async () => {
    const data = Buffer.from("hello-weibo-pic");
    const loaded = await loadWeiboPicImage({
      picBase64: data.toString("base64"),
      picFilename: "cover.jpg",
    });
    expect(loaded.filename).toBe("cover.jpg");
    expect(loaded.data.equals(data)).toBe(true);
  });

  it("rejects oversized base64 pic payload", async () => {
    const oversized = Buffer.alloc(WEIBO_PIC_MAX_BYTES + 1, 1);
    await expect(
      loadWeiboPicImage({
        picBase64: oversized.toString("base64"),
      }),
    ).rejects.toThrow("字节上限");
  });
});
