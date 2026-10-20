import { describe, expect, it } from "vitest";
import { redactText, sanitizePayloadForStorage } from "./redact.js";

describe("media-monitor redact", () => {
  it("redacts cookie and bearer tokens", () => {
    const text = redactText(
      "cookie=abc123; Authorization: Bearer super-secret https://x.test/?token=zzz",
    );
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("zzz");
    expect(text).toContain("[REDACTED]");
  });

  it("redacts sensitive payload keys", () => {
    const payload = sanitizePayloadForStorage({
      title: "ok",
      cookie: "should-hide",
      nested: { api_key: "k", text: "visible" },
    });
    expect(payload.cookie).toBe("[REDACTED]");
    expect((payload.nested as { api_key: string }).api_key).toBe("[REDACTED]");
    expect((payload.nested as { text: string }).text).toBe("visible");
  });
});
