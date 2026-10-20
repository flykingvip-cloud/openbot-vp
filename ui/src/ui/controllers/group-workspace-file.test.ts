import { describe, expect, it, vi } from "vitest";
import {
  buildGroupWorkspaceReadCandidates,
  isGroupHtmlPreviewFilename,
  isGroupPdfPreviewFilename,
  readGroupWorkspaceFile,
  resolveGroupWorkspaceReadPath,
  workspaceFileReadCandidates,
} from "./group-workspace-file.ts";

describe("resolveGroupWorkspaceReadPath", () => {
  it("keeps bare basenames at workspace root instead of forcing deliverables/", () => {
    expect(resolveGroupWorkspaceReadPath("weekly-brief.md")).toBe("weekly-brief.md");
    expect(resolveGroupWorkspaceReadPath("营销副总文化考量的测试维度.pptx")).toBe(
      "营销副总文化考量的测试维度.pptx",
    );
  });

  it("preserves already-qualified relative paths outside deliverables/", () => {
    expect(resolveGroupWorkspaceReadPath("report/ai-org-report.html")).toBe(
      "report/ai-org-report.html",
    );
    expect(resolveGroupWorkspaceReadPath("reports/ai-org-report.pdf")).toBe(
      "reports/ai-org-report.pdf",
    );
    expect(resolveGroupWorkspaceReadPath("output/deck.pptx")).toBe("output/deck.pptx");
  });

  it("preserves deliverables/ and drafts/ paths", () => {
    expect(resolveGroupWorkspaceReadPath("deliverables/final.md")).toBe("deliverables/final.md");
    expect(resolveGroupWorkspaceReadPath("drafts/scratch.md")).toBe("drafts/scratch.md");
  });

  it("rejects absolute and traversing paths", () => {
    expect(resolveGroupWorkspaceReadPath("/tmp/x.pdf")).toBeNull();
    expect(resolveGroupWorkspaceReadPath("../secret.md")).toBeNull();
  });
});

describe("buildGroupWorkspaceReadCandidates", () => {
  it("tries report/ when reports/ is requested for a missing PDF", () => {
    expect(buildGroupWorkspaceReadCandidates("reports/ai-org-report.pdf")).toEqual([
      "reports/ai-org-report.pdf",
      "report/ai-org-report.pdf",
      "reports/ai-org-report.html",
      "report/ai-org-report.html",
    ]);
  });

  it("does not fan a bare basename out across other directories", () => {
    expect(buildGroupWorkspaceReadCandidates("ai-org-report.pdf")).toEqual([
      "ai-org-report.pdf",
      "ai-org-report.html",
    ]);
    expect(buildGroupWorkspaceReadCandidates("know-how-to-be-what-pub.html")).toEqual([
      "know-how-to-be-what-pub.html",
    ]);
    expect(buildGroupWorkspaceReadCandidates("营销副总文化考量的测试维度.pptx")).toEqual([
      "营销副总文化考量的测试维度.pptx",
    ]);
  });

  it("keeps a nested relative path exact", () => {
    expect(buildGroupWorkspaceReadCandidates("campaigns/october/article.html")).toEqual([
      "campaigns/october/article.html",
    ]);
    expect(buildGroupWorkspaceReadCandidates("output/pdf/OpenBot创业项目申报材料.pdf")).toEqual([
      "output/pdf/OpenBot创业项目申报材料.pdf",
      "output/pdf/OpenBot创业项目申报材料.html",
    ]);
  });
});

describe("workspaceFileReadCandidates", () => {
  it("sends an absolute path through for gateway mapping instead of its basename", () => {
    expect(workspaceFileReadCandidates("/state/ws/campaigns/october/article.html")).toEqual([
      "/state/ws/campaigns/october/article.html",
    ]);
  });

  it("does not turn traversal into another filename", () => {
    expect(workspaceFileReadCandidates("campaigns/../../secret.html")).toEqual([]);
  });
});

describe("readGroupWorkspaceFile", () => {
  it("falls back from claimed PDF path to existing HTML under report/", async () => {
    const request = vi.fn(async (_method: string, payload: { filename: string }) => {
      if (payload.filename === "report/ai-org-report.html") {
        return {
          groupId: "grp-alpha",
          relativePath: "report/ai-org-report.html",
          filename: "ai-org-report.html",
          mimeType: "text/html",
          byteLength: 12,
          textLike: true,
          base64: btoa("<html></html>"),
        };
      }
      throw new Error("not found");
    });
    const file = await readGroupWorkspaceFile(
      { request } as never,
      "grp-alpha",
      "reports/ai-org-report.pdf",
      { render: true },
    );
    expect(file?.relativePath).toBe("report/ai-org-report.html");
    expect(request).toHaveBeenCalled();
  });
});

describe("preview helpers", () => {
  it("detects html and pdf preview targets", () => {
    expect(isGroupHtmlPreviewFilename("a.html")).toBe(true);
    expect(isGroupPdfPreviewFilename("a.pdf", "application/pdf")).toBe(true);
    expect(isGroupPdfPreviewFilename("a.docx")).toBe(false);
  });
});
