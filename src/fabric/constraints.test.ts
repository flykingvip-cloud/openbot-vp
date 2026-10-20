import { describe, expect, it } from "vitest";
import { toTolControls } from "./constraints.js";

describe("Fabric constraints — toTolControls (R4)", () => {
  it("sandboxMode none → gateway host, no sandbox, no fs override", () => {
    const c = toTolControls({ sandboxMode: "none" });
    expect(c.execHost).toBe("gateway");
    expect(c.sandbox).toBeUndefined();
    expect(c.fs.workspaceOnly).toBeUndefined();
  });

  it("sandboxMode restricted → ro sandbox, network follows allowNetwork", () => {
    const c = toTolControls({ sandboxMode: "restricted" });
    expect(c.execHost).toBe("sandbox");
    expect(c.sandbox).toEqual({ enabled: true, workspaceAccess: "ro", network: true });
  });

  it("restricted + allowNetwork:false → sandbox network disabled", () => {
    const c = toTolControls({ sandboxMode: "restricted", allowNetwork: false });
    expect(c.sandbox?.network).toBe(false);
  });

  it("sandboxMode strict → ro sandbox, network off, workspaceOnly true", () => {
    const c = toTolControls({ sandboxMode: "strict" });
    expect(c.sandbox).toEqual({ enabled: true, workspaceAccess: "ro", network: false });
    expect(c.fs.workspaceOnly).toBe(true);
  });

  it("allowedPaths flow through and imply workspaceOnly (tightening)", () => {
    const c = toTolControls({ allowedPaths: ["src/**"], blockedPaths: ["secrets/**"] });
    expect(c.fs.allowedPaths).toEqual(["src/**"]);
    expect(c.fs.blockedPaths).toEqual(["secrets/**"]);
    expect(c.fs.workspaceOnly).toBe(true);
  });

  it("timeout and cost limit map to TOL knobs", () => {
    const c = toTolControls({ timeoutMs: 5000, costLimit: 1.25 });
    expect(c.timeoutMs).toBe(5000);
    expect(c.budgetUsd).toBe(1.25);
  });

  it("empty constraints never relax defaults (R4.4): no overrides emitted", () => {
    const c = toTolControls({});
    expect(c.execHost).toBeUndefined();
    expect(c.sandbox).toBeUndefined();
    expect(c.fs.workspaceOnly).toBeUndefined();
    expect(c.fs.allowedPaths).toBeUndefined();
    expect(c.timeoutMs).toBeUndefined();
    expect(c.budgetUsd).toBeUndefined();
  });

  it("does not emit workspaceOnly:false implicitly (R4.4)", () => {
    // No constraint path should ever produce workspaceOnly === false.
    for (const mode of ["none", "restricted", "strict", undefined] as const) {
      const c = toTolControls({ sandboxMode: mode });
      expect(c.fs.workspaceOnly).not.toBe(false);
    }
  });
});
