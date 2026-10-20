import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetInboundMediaGrants,
  lookupInboundMediaGrants,
  rememberInboundMediaGrants,
  resetInboundMediaGrantsForTest,
} from "./inbound-media-grants.js";
import { resolveMediaToolLocalRoots } from "./tools/media-tool-shared.js";

afterEach(() => {
  resetInboundMediaGrantsForTest();
});

describe("inbound media grants", () => {
  it("returns the registered attachment paths for a run", () => {
    rememberInboundMediaGrants("run-1", ["/state/media/webchat-uploads/a.pdf"]);
    expect(lookupInboundMediaGrants("run-1")).toEqual(["/state/media/webchat-uploads/a.pdf"]);
  });

  it("is empty for an unknown or blank run (never a wildcard)", () => {
    rememberInboundMediaGrants("run-1", ["/state/media/a.pdf"]);
    expect(lookupInboundMediaGrants("run-other")).toEqual([]);
    expect(lookupInboundMediaGrants(undefined)).toEqual([]);
    expect(lookupInboundMediaGrants("  ")).toEqual([]);
  });

  it("ignores blank entries, de-duplicates, and skips URLs", () => {
    rememberInboundMediaGrants("run-2", [
      "/state/media/a.pdf",
      "   ",
      undefined,
      "/state/media/a.pdf",
      "https://example.com/remote.pdf",
    ]);
    expect(lookupInboundMediaGrants("run-2")).toEqual([path.resolve("/state/media/a.pdf")]);
  });

  it("does not register when there are no attachments", () => {
    rememberInboundMediaGrants("run-3", []);
    rememberInboundMediaGrants("run-3", undefined);
    expect(lookupInboundMediaGrants("run-3")).toEqual([]);
  });

  it("forgets a run on request", () => {
    rememberInboundMediaGrants("run-4", ["/state/media/a.pdf"]);
    forgetInboundMediaGrants("run-4");
    expect(lookupInboundMediaGrants("run-4")).toEqual([]);
  });

  it("returns a copy so callers cannot mutate the registry", () => {
    rememberInboundMediaGrants("run-5", ["/state/media/a.pdf"]);
    const first = lookupInboundMediaGrants("run-5");
    first.push("/etc/passwd");
    expect(lookupInboundMediaGrants("run-5")).toEqual([path.resolve("/state/media/a.pdf")]);
  });
});

describe("resolveMediaToolLocalRoots granted paths", () => {
  const workspaceDir = path.resolve("/tenant/workspace");
  const upload = path.resolve("/state/media/webchat-uploads/report---uuid.pdf");

  it("adds the granted file to a workspace-only allowlist", () => {
    const roots = resolveMediaToolLocalRoots(workspaceDir, {
      workspaceOnly: true,
      grantedPaths: [upload],
    });
    expect(roots).toEqual([workspaceDir, upload]);
  });

  // The whole point of granting single files: the shared upload directory holds
  // every tenant's attachments, so it must never become a readable root.
  it("does not grant the directory containing a granted file", () => {
    const roots = resolveMediaToolLocalRoots(workspaceDir, {
      workspaceOnly: true,
      grantedPaths: [upload],
    });
    expect(roots).not.toContain(path.dirname(upload));
  });

  it("keeps workspace-only empty-safe when there is no workspace and no grant", () => {
    expect(resolveMediaToolLocalRoots(undefined, { workspaceOnly: true })).toEqual([]);
  });

  it("still returns only the workspace when nothing was granted", () => {
    expect(resolveMediaToolLocalRoots(workspaceDir, { workspaceOnly: true })).toEqual([
      workspaceDir,
    ]);
  });

  it("appends grants to the default roots when not workspace-only", () => {
    const roots = resolveMediaToolLocalRoots(workspaceDir, { grantedPaths: [upload] });
    expect(roots).toContain(workspaceDir);
    expect(roots).toContain(upload);
    expect(roots.length).toBeGreaterThan(2);
  });
});
