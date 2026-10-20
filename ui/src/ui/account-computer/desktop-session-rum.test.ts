import { describe, expect, it, vi } from "vitest";
import {
  computeRumTimings,
  createDesktopRumBuffer,
  hashUserId,
  rumEventIsSafe,
  sanitizeRumValue,
} from "./desktop-session-rum.ts";

describe("desktop-session-rum", () => {
  it("sanitizes tokens and full URLs", () => {
    const withUrl =
      "https://gateway.example/sandbox/novnc?token=abc123secret&password=hunter2 path";
    const cleanedUrl = sanitizeRumValue(withUrl);
    expect(cleanedUrl).not.toContain("https://");
    expect(cleanedUrl).not.toMatch(/token=abc/i);
    expect(cleanedUrl).not.toMatch(/password=hunter/i);
    expect(cleanedUrl).toContain("[url]");

    const queryOnly = "stream path token=abc123secret&password=hunter2";
    const cleanedQuery = sanitizeRumValue(queryOnly);
    expect(cleanedQuery).toContain("REDACTED");
    expect(cleanedQuery).not.toMatch(/token=abc/i);
    expect(cleanedQuery).not.toMatch(/password=hunter/i);
  });

  it("hashes user ids stably without leaking email", () => {
    const a = hashUserId("alice@example.com");
    const b = hashUserId("alice@example.com");
    const c = hashUserId("bob@example.com");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^u[0-9a-f]{8}$/);
    expect(a).not.toContain("@");
  });

  it("emits safe shapes with TTFP/TTI/TTS fields", () => {
    const sink = vi.fn();
    const buf = createDesktopRumBuffer({ sink });
    const event = buf.emit("first_frame", {
      sessionId: "sess-1",
      userIdHash: hashUserId("u-1"),
      desktopId: "desk-1",
      agentId: "agent-1",
      connectionAttempt: 1,
      ttfpMs: 1200,
      ttiMs: 1800,
      ttsMs: 2400,
    });
    expect(rumEventIsSafe(event)).toBe(true);
    expect(event.fields.ttfpMs).toBe(1200);
    expect(event.fields.ttiMs).toBe(1800);
    expect(event.fields.ttsMs).toBe(2400);
    expect(sink).toHaveBeenCalledOnce();
    expect(buf.events).toHaveLength(1);
  });

  it("drops unsafe payloads that still contain URLs after sanitize edge cases", () => {
    const buf = createDesktopRumBuffer();
    // sessionId with URL gets sanitized to [url] — still safe.
    const event = buf.emit("preview_open", {
      sessionId: "https://evil.example/path?token=leak",
      userIdHash: "u00000001",
      desktopId: "d",
      agentId: "a",
      connectionAttempt: 1,
    });
    expect(event.fields.sessionId).not.toContain("https://");
    expect(event.fields.sessionId).not.toMatch(/token=leak/);
    expect(rumEventIsSafe(event)).toBe(true);
  });

  it("computes TTFP / TTI / TTS from marks", () => {
    const timings = computeRumTimings({
      openedAt: 1000,
      firstFrameAt: 1500,
      interactiveAt: 1800,
      stableStreamAt: 2200,
    });
    expect(timings).toEqual({ ttfpMs: 500, ttiMs: 800, ttsMs: 1200 });
  });
});
