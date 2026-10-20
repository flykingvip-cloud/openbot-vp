import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "./request-helpers.ts";

describe("normalizeDisplayName", () => {
  it("keeps a human name", () => {
    expect(normalizeDisplayName("张飞", "zhangfei@example.com")).toBe("张飞");
  });

  it("does not persist an email as the display name", () => {
    expect(normalizeDisplayName("hedon25@126.com", "hedon25@126.com")).toBe("hedon25");
    expect(normalizeDisplayName("", "368809901@qq.com")).toBe("368809901");
  });
});
