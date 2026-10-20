import { describe, expect, it } from "vitest";
import {
  chatCanResolveRunError,
  classifyChatRunFailureReason,
  isChatScopedRunFailure,
  shouldEscalateChatRunError,
} from "./chat-run-error-policy.js";

describe("chat run error policy", () => {
  it("treats a length crash as a transcript failure the chat cannot resolve", () => {
    const error = "Cannot read properties of undefined (reading 'length')";
    expect(isChatScopedRunFailure(error)).toBe(true);
    expect(chatCanResolveRunError(error)).toBe(false);
    expect(shouldEscalateChatRunError(error)).toBe(true);
    expect(classifyChatRunFailureReason(error)).toBe("undefined_property");
  });

  it("keeps a missing model key in chat and out of the evolution loop", () => {
    const error = "No API key for provider: api-proxy-deepseek";
    expect(isChatScopedRunFailure(error)).toBe(true);
    expect(chatCanResolveRunError(error)).toBe(true);
    expect(shouldEscalateChatRunError(error)).toBe(false);
  });

  it("does not treat gateway auth or attachment limits as run failures", () => {
    expect(isChatScopedRunFailure("unauthorized: gateway token missing")).toBe(false);
    expect(isChatScopedRunFailure("附件“report.pdf”过大，当前可读取上限为 25 MB")).toBe(false);
    expect(shouldEscalateChatRunError("")).toBe(false);
    expect(shouldEscalateChatRunError("chat error")).toBe(false);
  });

  it("classifies internal module failures for the capsule reason", () => {
    expect(classifyChatRunFailureReason("Error [ERR_MODULE_NOT_FOUND]: missing chunk")).toBe(
      "err_module_not_found",
    );
    expect(shouldEscalateChatRunError("Error [ERR_MODULE_NOT_FOUND]: missing chunk")).toBe(true);
  });
});
