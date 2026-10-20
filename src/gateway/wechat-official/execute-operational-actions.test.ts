import { describe, expect, it } from "vitest";
import {
  executeWechatOfficialActionsWithAccessToken,
  parseWechatOfficialOperationalActionPayload,
} from "./execute-operational-actions.js";

describe("parseWechatOfficialOperationalActionPayload", () => {
  it("maps snake_case and camelCase fields", () => {
    expect(
      parseWechatOfficialOperationalActionPayload({
        title: "  Hello  ",
        body: "content",
        thumb_media_id: "thumb-1",
        send_to_all: "true",
        tag_id: "42",
        rewrite_content_images: false,
      }),
    ).toEqual({
      title: "Hello",
      content: "content",
      thumbMediaId: "thumb-1",
      sendToAll: true,
      tagId: 42,
      rewriteContentImages: false,
    });
  });

  it("returns empty object for non-records", () => {
    expect(parseWechatOfficialOperationalActionPayload(null)).toEqual({});
    expect(parseWechatOfficialOperationalActionPayload(["x"])).toEqual({});
  });
});

describe("executeWechatOfficialActionsWithAccessToken", () => {
  it("rejects missing credentials", async () => {
    await expect(
      executeWechatOfficialActionsWithAccessToken({
        action: "upload_thumb",
        payload: {},
        accessToken: "",
        appId: "wx-app",
      }),
    ).rejects.toThrow(/缺少 AppID 或 access_token/);
  });

  it("rejects unknown actions", async () => {
    await expect(
      executeWechatOfficialActionsWithAccessToken({
        action: "unknown_action",
        payload: {},
        accessToken: "token",
        appId: "wx-app",
      }),
    ).rejects.toThrow(/不支持动作/);
  });

  it("requires publishId for get_publish_status", async () => {
    await expect(
      executeWechatOfficialActionsWithAccessToken({
        action: "get_publish_status",
        payload: {},
        accessToken: "token",
        appId: "wx-app",
      }),
    ).rejects.toThrow(/publishId/);
  });
});
