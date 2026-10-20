import { describe, expect, it } from "vitest";
import {
  CATALOG_PROJECTION_MISS_MESSAGE,
  CLOUD_PC_CONTROL_STARTING_BANNER,
  GENERIC_CHAT_ERROR_MESSAGE,
  MISSING_AGENT_ASSET_MESSAGE,
  MISSING_MODEL_API_KEY_MESSAGE,
  UNKNOWN_COLLABORATION_SPACE_MESSAGE,
  WORKSPACE_AUTHORIZATION_FAILED_MESSAGE,
  isInternalChatError,
  sanitizeUserFacingChatError,
} from "./chat-error-sanitize.ts";

describe("isInternalChatError", () => {
  it("recognizes node error codes", () => {
    expect(isInternalChatError("ERR_MODULE_NOT_FOUND")).toBe(true);
    expect(isInternalChatError("Error: ERR_INVALID_ARG_TYPE at ...")).toBe(true);
  });

  it("recognizes dist/ chunk paths", () => {
    expect(isInternalChatError("/workspace/dist/reply-ed9a3c.js not found")).toBe(true);
  });

  it("recognizes node_modules paths", () => {
    expect(isInternalChatError("Cannot resolve node_modules/@openai/sdk")).toBe(true);
  });

  it("recognizes stack frames", () => {
    expect(isInternalChatError("at handleRequest (server.ts:42:10)")).toBe(true);
  });

  it("recognizes absolute file paths", () => {
    expect(isInternalChatError("/Users/daniel/project/src/index.ts")).toBe(true);
    expect(isInternalChatError("Error in /home/user/app.js")).toBe(true);
  });

  it("recognizes source file extensions", () => {
    expect(isInternalChatError("Missing gateway.ts export")).toBe(true);
    expect(isInternalChatError("Compile error in worker.mjs")).toBe(true);
  });

  it("does not flag user-facing business errors", () => {
    expect(isInternalChatError("未授权：请先登录")).toBe(false);
    expect(isInternalChatError("已达请求上限")).toBe(false);
    expect(isInternalChatError("No API key for provider: deepseek")).toBe(false);
  });
});

describe("sanitizeUserFacingChatError", () => {
  it("replaces internal errors with a generic message", () => {
    expect(sanitizeUserFacingChatError("ERR_MODULE_NOT_FOUND: /dist/chunk.js")).toBe(
      GENERIC_CHAT_ERROR_MESSAGE,
    );
  });

  it("replaces missing API key errors with a specific message", () => {
    expect(sanitizeUserFacingChatError("No API key for provider: api-proxy-deepseek")).toBe(
      MISSING_MODEL_API_KEY_MESSAGE,
    );
  });

  it("rewrites fail-closed collaboration and workspace errors", () => {
    expect(sanitizeUserFacingChatError("unknown collaboration space")).toBe(
      UNKNOWN_COLLABORATION_SPACE_MESSAGE,
    );
    expect(
      sanitizeUserFacingChatError(
        "Workspace authorization failed. Managed Enterprise does not fall back to legacy workspace paths.",
      ),
    ).toBe(WORKSPACE_AUTHORIZATION_FAILED_MESSAGE);
    expect(sanitizeUserFacingChatError("Error: workspace_authorization_failed")).toBe(
      WORKSPACE_AUTHORIZATION_FAILED_MESSAGE,
    );
    expect(sanitizeUserFacingChatError("catalog_projection_miss")).toBe(
      CATALOG_PROJECTION_MISS_MESSAGE,
    );
    expect(sanitizeUserFacingChatError("Error: missing_agent_asset")).toBe(
      MISSING_AGENT_ASSET_MESSAGE,
    );
  });

  it("turns a browser-control timeout into a calm cloud-PC line", () => {
    const raw =
      "Can't reach the OpenBot browser control service (timed out after 15000ms). Restart the OpenBot gateway (OpenBot.app menubar, or `openbot gateway`). Do NOT retry the browser tool — it will keep failing.";
    expect(sanitizeUserFacingChatError(raw)).toBe(CLOUD_PC_CONTROL_STARTING_BANNER);
    expect(
      sanitizeUserFacingChatError("云电脑还在启动，画面可以先看。Do not quote an English timeout."),
    ).toBe(CLOUD_PC_CONTROL_STARTING_BANNER);
  });

  it("preserves user-facing business errors", () => {
    const businessError = "已达请求上限，请稍后重试";
    expect(sanitizeUserFacingChatError(businessError)).toBe(businessError);
  });

  it("preserves null and undefined", () => {
    expect(sanitizeUserFacingChatError(null)).toBeNull();
    expect(sanitizeUserFacingChatError(undefined)).toBeUndefined();
  });

  it("preserves empty strings", () => {
    expect(sanitizeUserFacingChatError("")).toBe("");
  });
});
