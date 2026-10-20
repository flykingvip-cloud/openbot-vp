import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMPLOYEE_EMBED_TARGET,
  EMPLOYEE_EMBED_SURFACES,
  isSafeEmbedTarget,
  isSafeHomepageTarget,
  isSafeNativeBootstrapTarget,
  parseEmployeeEmbedTargetSurface,
  safeEmbedTargetOrDefault,
  safeNativeBootstrapTargetOrDefault,
} from "./embed-target.js";

describe("server-side embed target validation", () => {
  it("accepts site-internal embed paths for every known surface", () => {
    for (const surface of EMPLOYEE_EMBED_SURFACES) {
      const target = `/embed/employee/${surface}`;
      expect(isSafeEmbedTarget(target)).toBe(true);
      expect(parseEmployeeEmbedTargetSurface(target)).toBe(surface);
    }
    expect(isSafeEmbedTarget("/embed/employee/workspace?tab=tasks")).toBe(true);
  });

  it("rejects protocol-relative and absolute URLs (open-redirect guard)", () => {
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

  it("rejects unknown surfaces and non-embed/non-string paths", () => {
    expect(isSafeEmbedTarget("/embed/employee/unknown")).toBe(false);
    expect(isSafeEmbedTarget("/embed/employee/")).toBe(false);
    expect(isSafeEmbedTarget("/dashboard")).toBe(false);
    expect(isSafeEmbedTarget("")).toBe(false);
    expect(isSafeEmbedTarget(null)).toBe(false);
    expect(isSafeEmbedTarget(123)).toBe(false);
  });

  it("coerces unsafe targets to the default surface", () => {
    expect(safeEmbedTargetOrDefault("//evil.com")).toBe(DEFAULT_EMPLOYEE_EMBED_TARGET);
    expect(safeEmbedTargetOrDefault("/embed/employee/growth")).toBe("/embed/employee/growth");
    expect(DEFAULT_EMPLOYEE_EMBED_TARGET).toBe("/embed/employee/overview");
  });

  it("accepts the site homepage as a native bootstrap redirect", () => {
    expect(isSafeHomepageTarget("/")).toBe(true);
    expect(isSafeHomepageTarget("/?shell=desktop")).toBe(true);
    expect(isSafeEmbedTarget("/")).toBe(false);
    expect(isSafeNativeBootstrapTarget("/")).toBe(true);
    expect(isSafeNativeBootstrapTarget("/embed/employee/overview")).toBe(true);
    expect(safeNativeBootstrapTargetOrDefault("/")).toBe("/");
    expect(safeNativeBootstrapTargetOrDefault("//evil.com")).toBe(DEFAULT_EMPLOYEE_EMBED_TARGET);
    expect(isSafeHomepageTarget("/dashboard")).toBe(false);
    expect(isSafeHomepageTarget("//evil.com")).toBe(false);
  });
});
