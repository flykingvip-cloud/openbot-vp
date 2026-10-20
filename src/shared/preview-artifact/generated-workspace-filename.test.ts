import { describe, expect, it } from "vitest";
import {
  extractGeneratedWorkspaceFilename,
  normalizeGeneratedWorkspacePath,
} from "./generated-workspace-filename.ts";

describe("extractGeneratedWorkspaceFilename", () => {
  it("keeps an articles/ prefix from a generated-file announcement", () => {
    expect(
      extractGeneratedWorkspaceFilename(
        "已生成 articles/know-how-to-be-what-pub.html，可在右侧打开。",
      ),
    ).toBe("articles/know-how-to-be-what-pub.html");
  });

  it("keeps backtick-quoted spaced Chinese publication names", () => {
    expect(
      extractGeneratedWorkspaceFilename(
        "已生成 `从 Know How 到 Be What（V7 · 出版版）.pdf`，在工作区根目录。",
      ),
    ).toBe("从 Know How 到 Be What（V7 · 出版版）.pdf");
  });

  it("does not collapse a spaced Chinese name to the suffix after the last space", () => {
    expect(
      extractGeneratedWorkspaceFilename(
        "已生成 从 Know How 到 Be What（V7 · 出版版）.pdf，可在工作区打开。",
      ),
    ).toBe("从 Know How 到 Be What（V7 · 出版版）.pdf");
  });

  it("does not keep the generation verb as part of a spaced Chinese name", () => {
    expect(
      extractGeneratedWorkspaceFilename("已生成 从 Know How 到 Be What（V7 · 出版版）.pdf"),
    ).not.toMatch(/^已生成/);
  });

  it("keeps output/html from 路径 / 已写入 announcements", () => {
    expect(
      extractGeneratedWorkspaceFilename(
        "本份文案已写入工作区，可在右侧预览区打开（路径：`output/html/全球热点简报-2026-10-14.html`）。",
      ),
    ).toBe("output/html/全球热点简报-2026-10-14.html");
    expect(
      extractGeneratedWorkspaceFilename("文件路径：output/html/全球热点简报-2026-10-14.html"),
    ).toBe("output/html/全球热点简报-2026-10-14.html");
  });

  it("still accepts a labeled no-space basename", () => {
    expect(extractGeneratedWorkspaceFilename("文件：output/report.html")).toBe(
      "output/report.html",
    );
  });

  it("returns null without a generated-file cue", () => {
    expect(
      extractGeneratedWorkspaceFilename("see articles/know-how-to-be-what-pub.html"),
    ).toBeNull();
  });
});

describe("normalizeGeneratedWorkspacePath", () => {
  it("rejects absolute and traversing paths", () => {
    expect(normalizeGeneratedWorkspacePath("/tmp/x.pdf")).toBeNull();
    expect(normalizeGeneratedWorkspacePath("../secret.md")).toBeNull();
  });
});
