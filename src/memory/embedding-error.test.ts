import { describe, expect, it } from "vitest";
import {
  classifyMemoryEmbeddingError,
  extractEmbeddingRetryAfterMs,
  isRetryableMemoryEmbeddingError,
  sanitizeEmbeddingErrorMessage,
} from "./embedding-error.js";

describe("classifyMemoryEmbeddingError", () => {
  it("classifies bare 429 Too Many Requests as rate_limit (not billing)", () => {
    const result = classifyMemoryEmbeddingError("429 Too Many Requests");
    expect(result).toMatchObject({ reason: "rate_limit", retryable: true });
  });

  it("classifies 429 insufficient_quota as billing", () => {
    const result = classifyMemoryEmbeddingError("openai embeddings failed: 429 insufficient_quota");
    expect(result).toMatchObject({ reason: "billing", retryable: false });
  });

  it("classifies 401/403 as auth", () => {
    expect(classifyMemoryEmbeddingError("401 Unauthorized").reason).toBe("auth");
    expect(classifyMemoryEmbeddingError("403 Forbidden").reason).toBe("auth");
    expect(classifyMemoryEmbeddingError(new Error("invalid_api_key")).reason).toBe("auth");
  });

  it("classifies timeout and 5xx as retryable transient", () => {
    expect(classifyMemoryEmbeddingError("embedding provider timeout")).toMatchObject({
      reason: "timeout",
      retryable: true,
    });
    expect(classifyMemoryEmbeddingError("502 Bad Gateway")).toMatchObject({
      reason: "timeout",
      retryable: true,
    });
    expect(classifyMemoryEmbeddingError("overloaded_error: high demand")).toMatchObject({
      reason: "overloaded",
      retryable: true,
    });
  });

  it("treats resource_exhausted / TPM as rate_limit unless billing signal present", () => {
    expect(classifyMemoryEmbeddingError("resource_exhausted: TPM").reason).toBe("rate_limit");
    expect(classifyMemoryEmbeddingError("429 resource_exhausted insufficient_quota").reason).toBe(
      "billing",
    );
  });

  it("does not mark billing or auth as retryable", () => {
    expect(isRetryableMemoryEmbeddingError("429 insufficient_quota")).toBe(false);
    expect(isRetryableMemoryEmbeddingError("401 Unauthorized")).toBe(false);
    expect(isRetryableMemoryEmbeddingError("model_not_found")).toBe(false);
  });

  it("redacts secrets from classification message", () => {
    const result = classifyMemoryEmbeddingError(
      "auth failed api_key=sk-secretvalue123 Authorization: Bearer abcdefghijklmnop",
    );
    expect(result.message).not.toContain("sk-secretvalue123");
    expect(result.message).not.toContain("abcdefghijklmnop");
    expect(result.message.toLowerCase()).toContain("[redacted]");
  });
});

describe("sanitizeEmbeddingErrorMessage", () => {
  it("strips bearer tokens and sk- keys", () => {
    const cleaned = sanitizeEmbeddingErrorMessage(
      "failed Bearer sk-abcdefghijklmnopqrstuvwxyz password=hunter2",
    );
    expect(cleaned).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz/);
    expect(cleaned).not.toContain("hunter2");
  });
});

describe("extractEmbeddingRetryAfterMs", () => {
  it("reads Retry-After header seconds", () => {
    expect(
      extractEmbeddingRetryAfterMs({
        message: "429",
        headers: { "retry-after": "2" },
      }),
    ).toBe(2000);
  });

  it("parses retry-after from message text", () => {
    expect(extractEmbeddingRetryAfterMs("rate limited retry-after: 1.5")).toBe(1500);
  });
});
