import { describe, expect, it } from "vitest";
import {
  classifyWorkspacePathFailure,
  declareWorkspaceRelativePath,
  persistDeclaredWorkspaceLocator,
  previewTrustedRoots,
  WORKSPACE_PATH_REJECTED_MESSAGE,
  WORKSPACE_PATH_UNMAPPABLE_MESSAGE,
} from "./workspace-deliverable-path.ts";

const GATEWAY_ROOT = "/state/tenants/001/users/elle/OpenBot/agents/market/workspace";
const OTHER_TENANT = "/state/tenants/002/users/other/OpenBot/agents/market/workspace";

describe("declareWorkspaceRelativePath", () => {
  it("keeps a nested workspace-relative path", () => {
    expect(declareWorkspaceRelativePath("campaigns/october/article.html")).toEqual({
      ok: true,
      relativePath: "campaigns/october/article.html",
      kind: "relative",
    });
    expect(declareWorkspaceRelativePath("output/pptx/客户演示版.pptx")).toEqual({
      ok: true,
      relativePath: "output/pptx/客户演示版.pptx",
      kind: "relative",
    });
  });

  it("keeps a bare basename as legacy compat, without inventing directories", () => {
    expect(declareWorkspaceRelativePath("article.html")).toEqual({
      ok: true,
      relativePath: "article.html",
      kind: "basename",
    });
  });

  it("maps an absolute path under the trusted gateway root and keeps subdirectories", () => {
    const abs = `${GATEWAY_ROOT}/campaigns/october/article.html`;
    expect(declareWorkspaceRelativePath(abs, { trustedRoots: [GATEWAY_ROOT] })).toEqual({
      ok: true,
      relativePath: "campaigns/october/article.html",
      kind: "mapped",
    });
  });

  it("maps a container mount onto the same relative path as the gateway root", () => {
    const roots = previewTrustedRoots(GATEWAY_ROOT, { containerWorkdir: "/sandbox/work" });
    expect(
      declareWorkspaceRelativePath("/account/workspace/campaigns/october/article.html", {
        trustedRoots: roots,
      }),
    ).toEqual({
      ok: true,
      relativePath: "campaigns/october/article.html",
      kind: "mapped",
    });
    expect(
      declareWorkspaceRelativePath("/workspace/campaigns/october/article.html", {
        trustedRoots: roots,
      }),
    ).toEqual({
      ok: true,
      relativePath: "campaigns/october/article.html",
      kind: "mapped",
    });
    expect(
      declareWorkspaceRelativePath("/sandbox/work/campaigns/october/article.html", {
        trustedRoots: roots,
      }),
    ).toEqual({
      ok: true,
      relativePath: "campaigns/october/article.html",
      kind: "mapped",
    });
    expect(
      declareWorkspaceRelativePath(`${GATEWAY_ROOT}/campaigns/october/article.html`, {
        trustedRoots: roots,
      })?.relativePath,
    ).toBe("campaigns/october/article.html");
  });

  it("does not reduce an unmappable absolute path to its basename", () => {
    const located = declareWorkspaceRelativePath("/tmp/campaigns/october/article.html");
    expect(located.ok).toBe(false);
    if (!located.ok) {
      expect(located.code).toBe("unmappable");
      expect(located.message).toBe(WORKSPACE_PATH_UNMAPPABLE_MESSAGE);
    }
    expect(persistDeclaredWorkspaceLocator("/tmp/campaigns/october/article.html")).toBe(
      "/tmp/campaigns/october/article.html",
    );
    expect(persistDeclaredWorkspaceLocator("/tmp/campaigns/october/article.html")).not.toBe(
      "article.html",
    );
  });

  it("refuses prefix siblings, other tenants, and paths outside the workspace", () => {
    const roots = previewTrustedRoots(GATEWAY_ROOT);
    expect(
      declareWorkspaceRelativePath("/workspace-evil/article.html", { trustedRoots: roots }).ok,
    ).toBe(false);
    expect(
      declareWorkspaceRelativePath(`${GATEWAY_ROOT}-evil/article.html`, { trustedRoots: roots }).ok,
    ).toBe(false);
    const other = declareWorkspaceRelativePath(`${OTHER_TENANT}/campaigns/october/article.html`, {
      trustedRoots: roots,
    });
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.code).toBe("unmappable");
    }
  });

  it("rejects traversal instead of stripping .. into another file", () => {
    const located = declareWorkspaceRelativePath("campaigns/october/../../secret.html");
    expect(located.ok).toBe(false);
    if (!located.ok) {
      expect(located.code).toBe("rejected");
      expect(located.message).toBe(WORKSPACE_PATH_REJECTED_MESSAGE);
    }
    expect(persistDeclaredWorkspaceLocator("campaigns/october/../../secret.html")).toBeNull();
    expect(
      declareWorkspaceRelativePath("/workspace/../secret.html", {
        trustedRoots: ["/workspace"],
      }).ok,
    ).toBe(false);
  });

  it("rejects empty, NUL, and dot segments", () => {
    expect(declareWorkspaceRelativePath("  ").ok).toBe(false);
    expect(declareWorkspaceRelativePath("campaigns/\0/article.html").ok).toBe(false);
    expect(declareWorkspaceRelativePath("campaigns/./article.html").ok).toBe(false);
    expect(declareWorkspaceRelativePath("campaigns//article.html").ok).toBe(false);
  });

  it("classifies unmappable separately from a missing file", () => {
    expect(classifyWorkspacePathFailure(WORKSPACE_PATH_UNMAPPABLE_MESSAGE)).toBe("unmappable");
    expect(classifyWorkspacePathFailure(WORKSPACE_PATH_REJECTED_MESSAGE)).toBe("rejected");
    expect(classifyWorkspacePathFailure("invalid filename")).toBe("rejected");
    expect(classifyWorkspacePathFailure("workspace file not synced for preview")).toBe("missing");
  });
});
