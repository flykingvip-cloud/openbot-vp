import { describe, expect, it } from "vitest";
import { DevicePlatformError } from "./types.js";
import { assertSafeServiceBaseUrl } from "./url-safety.js";

describe("device platform URL safety", () => {
  it("accepts a public https origin", () => {
    expect(assertSafeServiceBaseUrl("https://platform.example/control", "production")).toBe(
      "https://platform.example/control",
    );
  });

  it("rejects credentials, private hosts, metadata, and cleartext outside development", () => {
    expect(() =>
      assertSafeServiceBaseUrl("https://user:secret@platform.example", "production"),
    ).toThrow(DevicePlatformError);
    expect(() => assertSafeServiceBaseUrl("http://platform.example", "production")).toThrow(
      /https/i,
    );
    expect(() => assertSafeServiceBaseUrl("https://127.0.0.1:8791", "production")).toThrow(
      /not allowed/i,
    );
    expect(() => assertSafeServiceBaseUrl("https://10.1.1.1", "staging")).toThrow(/not allowed/i);
    expect(() => assertSafeServiceBaseUrl("https://169.254.169.254", "production")).toThrow(
      /not allowed/i,
    );
    expect(() =>
      assertSafeServiceBaseUrl("https://metadata.google.internal", "production"),
    ).toThrow(/not allowed/i);
    expect(() => assertSafeServiceBaseUrl("http://127.0.0.1:8791", "development")).not.toThrow();
  });
});
