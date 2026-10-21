import { describe, expect, it } from "vitest";
import {
  getDefaultRedactPatterns,
  redactLogLineInAllMode,
  redactLogPayloadInAllMode,
  redactSensitiveText,
} from "./redact.js";

const defaults = getDefaultRedactPatterns();

describe("redactSensitiveText", () => {
  it("masks env assignments while keeping the key", () => {
    const input = "OPENAI_API_KEY=sk-1234567890abcdef";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("OPENAI_API_KEY=sk-123…cdef");
  });

  it("masks CLI flags", () => {
    const input = "curl --token abcdef1234567890ghij https://api.test";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("curl --token abcdef…ghij https://api.test");
  });

  it("fully redacts confirmationToken JSON fields", () => {
    const token = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const input = `{"confirmationToken":"${token}"}`;
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe('{"confirmationToken":"***"}');
    expect(output).not.toContain(token);
    expect(output).not.toContain("aaaaaaaa");
  });

  it("masks JSON fields", () => {
    const input = '{"token":"abcdef1234567890ghij"}';
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe('{"token":"abcdef…ghij"}');
  });

  it("masks bearer tokens", () => {
    const input = "Authorization: Bearer abcdef1234567890ghij";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("Authorization: Bearer abcdef…ghij");
  });

  it("masks Telegram-style tokens", () => {
    const input = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("123456…cdef");
  });

  it("masks Telegram Bot API URL tokens", () => {
    const input =
      "GET https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef/getMe HTTP/1.1";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("GET https://api.telegram.org/bot123456…cdef/getMe HTTP/1.1");
  });

  it("redacts short tokens fully", () => {
    const input = "TOKEN=shortvalue";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe("TOKEN=***");
  });

  it("redacts private key blocks", () => {
    const input = [
      "-----BEGIN PRIVATE KEY-----",
      "ABCDEF1234567890",
      "ZYXWVUT987654321",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toBe(
      ["-----BEGIN PRIVATE KEY-----", "…redacted…", "-----END PRIVATE KEY-----"].join("\n"),
    );
  });

  it("honors custom patterns with flags", () => {
    const input = "token=abcdef1234567890ghij";
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: ["/token=([A-Za-z0-9]+)/i"],
    });
    expect(output).toBe("token=abcdef…ghij");
  });

  it("ignores unsafe nested-repetition custom patterns", () => {
    const input = `${"a".repeat(28)}!`;
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: ["(a+)+$"],
    });
    expect(output).toBe(input);
  });

  it("redacts large payloads with bounded regex passes", () => {
    const input = `${"x".repeat(40_000)} OPENAI_API_KEY=sk-1234567890abcdef ${"y".repeat(40_000)}`;
    const output = redactSensitiveText(input, {
      mode: "tools",
      patterns: defaults,
    });
    expect(output).toContain("OPENAI_API_KEY=sk-123…cdef");
  });

  it("skips redaction when mode is off", () => {
    const input = "OPENAI_API_KEY=sk-1234567890abcdef";
    const output = redactSensitiveText(input, {
      mode: "off",
      patterns: defaults,
    });
    expect(output).toBe(input);
  });

  it("redacts in all mode with the same pattern engine", () => {
    const input = "Authorization: Bearer abcdef1234567890ghij";
    const output = redactSensitiveText(input, {
      mode: "all",
      patterns: defaults,
    });
    expect(output).toBe("Authorization: Bearer abcdef…ghij");
  });
});

describe("redactLogLineInAllMode", () => {
  it('redacts bearer tokens when mode is "all"', () => {
    const line = "gateway request Authorization: Bearer abcdef1234567890ghij";
    const output = redactLogLineInAllMode(line, { mode: "all", patterns: defaults });
    expect(output).toBe("gateway request Authorization: Bearer abcdef…ghij");
  });

  it('redacts PEM blocks when mode is "all"', () => {
    const line = [
      "-----BEGIN PRIVATE KEY-----",
      "ABCDEF1234567890",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const output = redactLogLineInAllMode(line, { mode: "all", patterns: defaults });
    expect(output).toBe(
      ["-----BEGIN PRIVATE KEY-----", "…redacted…", "-----END PRIVATE KEY-----"].join("\n"),
    );
  });

  it('keeps lines untouched in default "tools" mode', () => {
    const line = "gateway request Authorization: Bearer abcdef1234567890ghij";
    expect(redactLogLineInAllMode(line, { mode: "tools", patterns: defaults })).toBe(line);
  });

  it('keeps lines untouched when mode is "off"', () => {
    const line = "OPENAI_API_KEY=sk-1234567890abcdef";
    expect(redactLogLineInAllMode(line, { mode: "off", patterns: defaults })).toBe(line);
  });
});

describe("redactLogPayloadInAllMode", () => {
  it('deep-redacts nested string fields when mode is "all"', () => {
    const payload = {
      msg: "Authorization: Bearer abcdef1234567890ghij",
      meta: {
        nested: ["OPENAI_API_KEY=sk-1234567890abcdef"],
        count: 3,
      },
    };
    const output = redactLogPayloadInAllMode(payload, { mode: "all", patterns: defaults }) as {
      msg: string;
      meta: { nested: string[]; count: number };
    };
    expect(output.msg).toBe("Authorization: Bearer abcdef…ghij");
    expect(output.meta.nested[0]).toBe("OPENAI_API_KEY=sk-123…cdef");
    expect(output.meta.count).toBe(3);
  });

  it("passes class instances through untouched", () => {
    const date = new Date();
    const payload = { msg: "hello", date };
    const output = redactLogPayloadInAllMode(payload, { mode: "all", patterns: defaults }) as {
      msg: string;
      date: Date;
    };
    expect(output.date).toBe(date);
  });

  it('returns the payload unchanged in default "tools" mode', () => {
    const payload = { msg: "Bearer abcdef1234567890ghij" };
    expect(redactLogPayloadInAllMode(payload, { mode: "tools", patterns: defaults })).toBe(payload);
  });

  it('returns the payload unchanged when mode is "off"', () => {
    const payload = { msg: "Bearer abcdef1234567890ghij" };
    expect(redactLogPayloadInAllMode(payload, { mode: "off", patterns: defaults })).toBe(payload);
  });
});
