import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveStewardPlacement } from "./steward-placement-policy.js";

const TENANT = "tenant-a";
const USER = "user-1";
const RESOURCE = "ws:tenant-a:user:user-1:asset:steward:builtin";

const tmpDirs: string[] = [];
function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steward-placement-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function base(overrides: Partial<Parameters<typeof resolveStewardPlacement>[0]> = {}) {
  const root = tmpRoot();
  return {
    tenantId: TENANT,
    userId: USER,
    resourceId: RESOURCE,
    allowedRoot: root,
    sourceRoot: path.join(root, "source"),
    targetRoot: path.join(root, "target"),
    ...overrides,
  };
}

describe("resolveStewardPlacement", () => {
  it("accepts source/target contained within the allowed root and records an auditable handle", () => {
    const input = base();
    const result = resolveStewardPlacement(input, 1234);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.handle.tenantId).toBe(TENANT);
    expect(result.handle.userId).toBe(USER);
    expect(result.handle.resourceId).toBe(RESOURCE);
    expect(result.handle.decidedAtMs).toBe(1234);
    // Real paths recorded for audit; source/target resolve under the (realpath) allowed root.
    expect(result.handle.sourceReal.startsWith(result.handle.allowedRoot)).toBe(true);
    expect(result.handle.targetReal.startsWith(result.handle.allowedRoot)).toBe(true);
    expect(result.handle.sourceReal).not.toBe(result.handle.targetReal);
  });

  it("fails closed when any placement input is empty", () => {
    expect(resolveStewardPlacement(base({ allowedRoot: "" }))).toMatchObject({
      ok: false,
      reason: "placement_missing",
    });
    expect(resolveStewardPlacement(base({ sourceRoot: "" }))).toMatchObject({
      ok: false,
      reason: "placement_missing",
    });
  });

  it("fails closed when the allowed root is not absolute", () => {
    expect(resolveStewardPlacement(base({ allowedRoot: "relative/root" }))).toMatchObject({
      ok: false,
      reason: "placement_root_not_absolute",
    });
  });

  it("fails closed when source/target are not absolute", () => {
    expect(resolveStewardPlacement(base({ sourceRoot: "relative/src" }))).toMatchObject({
      ok: false,
      reason: "placement_not_absolute",
    });
  });

  it("fails closed on a raw `..` traversal segment (unnormalized input)", () => {
    const root = tmpRoot();
    const result = resolveStewardPlacement({
      tenantId: TENANT,
      userId: USER,
      resourceId: RESOURCE,
      allowedRoot: root,
      // Raw (unnormalized) path so the `..` segment survives to the policy check.
      sourceRoot: `${root}/../escape`,
      targetRoot: path.join(root, "target"),
    });
    expect(result).toMatchObject({ ok: false, reason: "placement_path_escape" });
  });

  it("fails closed when the allowed root does not exist", () => {
    const missing = path.join(os.tmpdir(), "steward-placement-missing-xyz-987");
    const result = resolveStewardPlacement({
      tenantId: TENANT,
      userId: USER,
      resourceId: RESOURCE,
      allowedRoot: missing,
      sourceRoot: path.join(missing, "source"),
      targetRoot: path.join(missing, "target"),
    });
    expect(result).toMatchObject({ ok: false, reason: "placement_root_missing" });
  });

  it("fails closed when source is outside the allowed root", () => {
    const root = tmpRoot();
    const other = tmpRoot();
    const result = resolveStewardPlacement({
      tenantId: TENANT,
      userId: USER,
      resourceId: RESOURCE,
      allowedRoot: root,
      sourceRoot: path.join(other, "source"),
      targetRoot: path.join(root, "target"),
    });
    expect(result).toMatchObject({ ok: false, reason: "placement_outside_allowed_root" });
  });

  it("fails closed on a symlink that escapes the allowed root", () => {
    const root = tmpRoot();
    const outside = tmpRoot();
    // A symlink logically inside the allowed root but whose realpath escapes it.
    const link = path.join(root, "link");
    fs.symlinkSync(outside, link);
    const result = resolveStewardPlacement({
      tenantId: TENANT,
      userId: USER,
      resourceId: RESOURCE,
      allowedRoot: root,
      sourceRoot: path.join(link, "source"),
      targetRoot: path.join(root, "target"),
    });
    expect(result).toMatchObject({ ok: false, reason: "placement_symlink_escape" });
  });

  it("fails closed when source and target are the same path", () => {
    const root = tmpRoot();
    const same = path.join(root, "same");
    const result = resolveStewardPlacement({
      tenantId: TENANT,
      userId: USER,
      resourceId: RESOURCE,
      allowedRoot: root,
      sourceRoot: same,
      targetRoot: same,
    });
    expect(result).toMatchObject({ ok: false, reason: "placement_source_target_collision" });
  });

  it("fails closed when a symlink aliases target onto source (collision by realpath)", () => {
    const root = tmpRoot();
    const source = path.join(root, "source");
    fs.mkdirSync(source, { recursive: true });
    // target is a symlink that resolves to source -> same realpath.
    const target = path.join(root, "target");
    fs.symlinkSync(source, target);
    const result = resolveStewardPlacement({
      tenantId: TENANT,
      userId: USER,
      resourceId: RESOURCE,
      allowedRoot: root,
      sourceRoot: source,
      targetRoot: target,
    });
    expect(result).toMatchObject({ ok: false, reason: "placement_source_target_collision" });
  });
});
