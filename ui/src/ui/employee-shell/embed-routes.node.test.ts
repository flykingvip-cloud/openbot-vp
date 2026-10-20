import { describe, expect, it } from "vitest";
import {
  buildEmployeeEmbedPath,
  buildNativeBootstrapPath,
  DEFAULT_EMPLOYEE_EMBED_SURFACE,
  defaultEmployeeEmbedPath,
  EMPLOYEE_EMBED_SURFACES,
  isEmployeeEmbedSurface,
  isSafeEmbedTarget,
  isSafeHomepageTarget,
  isSafeNativeBootstrapTarget,
  NATIVE_BOOTSTRAP_PATH,
  parseEmployeeEmbedPath,
  parseNativeBootstrapPath,
  safeEmbedTargetOrDefault,
  safeNativeBootstrapTargetOrDefault,
} from "./embed-routes.ts";

describe("employee embed surfaces", () => {
  it("builds canonical paths for every surface and round-trips them", () => {
    for (const surface of EMPLOYEE_EMBED_SURFACES) {
      const path = buildEmployeeEmbedPath(surface);
      expect(path).toBe(`/embed/employee/${surface}`);
      expect(parseEmployeeEmbedPath(path)).toBe(surface);
    }
  });

  it("recognizes only known surfaces", () => {
    expect(isEmployeeEmbedSurface("overview")).toBe(true);
    expect(isEmployeeEmbedSurface("assistant")).toBe(false); // chat reuses overview/workspace
    expect(isEmployeeEmbedSurface("nope")).toBe(false);
    expect(isEmployeeEmbedSurface(42)).toBe(false);
  });

  it("keeps overview/workspace/growth (Phase 1 must-haves) in the contract", () => {
    for (const surface of ["overview", "workspace", "growth"] as const) {
      expect(EMPLOYEE_EMBED_SURFACES).toContain(surface);
    }
  });

  it("defaults to overview", () => {
    expect(DEFAULT_EMPLOYEE_EMBED_SURFACE).toBe("overview");
    expect(defaultEmployeeEmbedPath()).toBe("/embed/employee/overview");
  });
});

describe("deeplink grammar alignment (contracts/deeplink-grammar.md)", () => {
  // The `…://employee/<surface>` deep link host maps to buildEmployeeEmbedPath.
  // Its accepted `surface` enum (grammar v1) MUST stay byte-for-byte identical
  // to the embed-route contract, and the grammar's "unknown surface -> fallback
  // overview" rule relies on the default below. Lock both so the Swift/Kotlin
  // parsers and the web embed router can never silently drift apart.
  const GRAMMAR_EMPLOYEE_SURFACES = ["overview", "workspace", "knowledge", "growth", "me"] as const;

  it("exposes exactly the surfaces the deep link grammar accepts", () => {
    expect([...EMPLOYEE_EMBED_SURFACES].toSorted()).toEqual(
      [...GRAMMAR_EMPLOYEE_SURFACES].toSorted(),
    );
  });

  it("resolves every grammar surface to a reachable embed target", () => {
    for (const surface of GRAMMAR_EMPLOYEE_SURFACES) {
      expect(isEmployeeEmbedSurface(surface)).toBe(true);
      const target = buildEmployeeEmbedPath(surface);
      expect(isSafeEmbedTarget(target)).toBe(true);
      expect(parseEmployeeEmbedPath(target)).toBe(surface);
    }
  });

  it("falls back to overview for an unknown surface (grammar reject-to-default)", () => {
    expect(parseEmployeeEmbedPath("/embed/employee/bogus")).toBeNull();
    expect(safeEmbedTargetOrDefault("/embed/employee/bogus")).toBe("/embed/employee/overview");
    expect(DEFAULT_EMPLOYEE_EMBED_SURFACE).toBe("overview");
  });
});

describe("parseEmployeeEmbedPath", () => {
  it("tolerates trailing slash, query, and hash", () => {
    expect(parseEmployeeEmbedPath("/embed/employee/overview/")).toBe("overview");
    expect(parseEmployeeEmbedPath("/embed/employee/workspace?x=1")).toBe("workspace");
    expect(parseEmployeeEmbedPath("/embed/employee/growth#top")).toBe("growth");
    expect(parseEmployeeEmbedPath("  /embed/employee/me  ")).toBe("me");
  });

  it("rejects unknown, nested, or non-embed paths", () => {
    expect(parseEmployeeEmbedPath("/embed/employee/unknown")).toBeNull();
    expect(parseEmployeeEmbedPath("/embed/employee/overview/extra")).toBeNull();
    expect(parseEmployeeEmbedPath("/embed/employee/")).toBeNull();
    expect(parseEmployeeEmbedPath("/other/path")).toBeNull();
    expect(parseEmployeeEmbedPath("")).toBeNull();
  });
});

describe("isSafeEmbedTarget (open-redirect guard)", () => {
  it("accepts site-internal embed paths", () => {
    expect(isSafeEmbedTarget("/embed/employee/overview")).toBe(true);
    expect(isSafeEmbedTarget("/embed/employee/workspace?tab=tasks")).toBe(true);
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(isSafeEmbedTarget("//evil.com")).toBe(false);
    expect(isSafeEmbedTarget("//evil.com/embed/employee/overview")).toBe(false);
    expect(isSafeEmbedTarget("https://evil.com/embed/employee/overview")).toBe(false);
    expect(isSafeEmbedTarget("http://evil.com")).toBe(false);
  });

  it("rejects scheme, control chars, backslashes, and traversal", () => {
    expect(isSafeEmbedTarget("javascript:alert(1)")).toBe(false);
    expect(isSafeEmbedTarget("data:text/html,<script>")).toBe(false);
    expect(isSafeEmbedTarget("/embed/employee/overview\\@evil")).toBe(false);
    expect(isSafeEmbedTarget("/embed/employee/overview\n")).toBe(false);
    expect(isSafeEmbedTarget("/embed/employee/../../etc/passwd")).toBe(false);
    expect(isSafeEmbedTarget("/embed/employee/overview\u0000")).toBe(false);
  });

  it("rejects non-embed and non-string targets", () => {
    expect(isSafeEmbedTarget("/dashboard")).toBe(false);
    expect(isSafeEmbedTarget("")).toBe(false);
    expect(isSafeEmbedTarget(null)).toBe(false);
    expect(isSafeEmbedTarget(undefined)).toBe(false);
    expect(isSafeEmbedTarget(123)).toBe(false);
  });

  it("coerces unsafe targets to the default", () => {
    expect(safeEmbedTargetOrDefault("//evil.com")).toBe("/embed/employee/overview");
    expect(safeEmbedTargetOrDefault("/embed/employee/growth")).toBe("/embed/employee/growth");
  });

  it("accepts the site homepage as a native bootstrap redirect", () => {
    expect(isSafeHomepageTarget("/")).toBe(true);
    expect(isSafeEmbedTarget("/")).toBe(false);
    expect(isSafeNativeBootstrapTarget("/")).toBe(true);
    expect(safeNativeBootstrapTargetOrDefault("/")).toBe("/");
    expect(safeNativeBootstrapTargetOrDefault("//evil.com")).toBe("/embed/employee/overview");
  });
});

describe("native bootstrap path", () => {
  it("builds a bootstrap path with token + safe target", () => {
    const path = buildNativeBootstrapPath({
      token: "one-time-abc",
      target: "/embed/employee/workspace",
    });
    expect(path.startsWith(`${NATIVE_BOOTSTRAP_PATH}?`)).toBe(true);
    const parsed = parseNativeBootstrapPath(path);
    expect(parsed).not.toBeNull();
    expect(parsed?.token).toBe("one-time-abc");
    expect(parsed?.target).toBe("/embed/employee/workspace");
    expect(parsed?.surface).toBe("workspace");
    expect(parsed?.targetWasRejected).toBe(false);
  });

  it("keeps the site homepage as a bootstrap target", () => {
    const path = buildNativeBootstrapPath({ token: "one-time-abc", target: "/" });
    const parsed = parseNativeBootstrapPath(path);
    expect(parsed?.target).toBe("/");
    expect(parsed?.targetWasRejected).toBe(false);
  });

  it("downgrades an unsafe target to the default when building", () => {
    const path = buildNativeBootstrapPath({ token: "tok", target: "https://evil.com" });
    const parsed = parseNativeBootstrapPath(path);
    expect(parsed?.target).toBe("/embed/employee/overview");
    expect(parsed?.surface).toBe("overview");
  });

  it("flags a rejected target when parsing a hand-crafted hostile path", () => {
    const hostile = `${NATIVE_BOOTSTRAP_PATH}?token=tok&target=${encodeURIComponent("//evil.com")}`;
    const parsed = parseNativeBootstrapPath(hostile);
    expect(parsed?.targetWasRejected).toBe(true);
    expect(parsed?.target).toBe("/embed/employee/overview");
  });

  it("throws on an empty/invalid token when building", () => {
    expect(() =>
      buildNativeBootstrapPath({ token: "", target: "/embed/employee/overview" }),
    ).toThrow(TypeError);
    expect(() =>
      buildNativeBootstrapPath({ token: "  ", target: "/embed/employee/overview" }),
    ).toThrow(TypeError);
  });

  it("returns null for non-bootstrap paths or missing token", () => {
    expect(parseNativeBootstrapPath("/embed/employee/overview")).toBeNull();
    expect(
      parseNativeBootstrapPath(`${NATIVE_BOOTSTRAP_PATH}?target=/embed/employee/overview`),
    ).toBeNull();
    expect(parseNativeBootstrapPath("/native/other?token=tok")).toBeNull();
  });
});
