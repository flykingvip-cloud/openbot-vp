import { describe, expect, it } from "vitest";
import {
  getPublicHelpDocument,
  getPublicHelpGuideDocument,
  resolveHelpGuideSlugFromPath,
  resolvePublicHelpTarget,
} from "./public-help-document.ts";
import {
  getWorkbenchHelpDocument,
  WORKBENCH_HELP_CHILD_IDS,
} from "./public-help-workbench-document.ts";

describe("public help guide routes", () => {
  it("resolves guide slugs from /help/<slug>", () => {
    expect(resolveHelpGuideSlugFromPath("/help/wecom")).toBe("wecom");
    expect(resolveHelpGuideSlugFromPath("/help/enterprise-im")).toBe("enterprise-im");
    expect(resolveHelpGuideSlugFromPath("/help/feishu")).toBe("feishu");
    expect(resolveHelpGuideSlugFromPath("/help/dingtalk")).toBe("dingtalk");
    expect(resolveHelpGuideSlugFromPath("/help")).toBeNull();
    expect(resolveHelpGuideSlugFromPath("/help/unknown")).toBeNull();
    expect(resolveHelpGuideSlugFromPath("/help/workbench")).toBeNull();
  });

  it("resolves workbench pages and leaves unknown paths on the hub", () => {
    expect(resolvePublicHelpTarget("/help")).toBeNull();
    expect(resolvePublicHelpTarget("/help/unknown")).toBeNull();
    expect(resolvePublicHelpTarget("/help/workbench/missing")).toBeNull();
    expect(resolvePublicHelpTarget("/help/wecom")).toEqual({ kind: "im", slug: "wecom" });
    expect(resolvePublicHelpTarget("/help/workbench")).toEqual({
      kind: "workbench",
      page: "index",
    });
    expect(resolvePublicHelpTarget("/help/workbench/assistant")).toEqual({
      kind: "workbench",
      page: "assistant",
    });
  });

  it("links guide cards to same-origin /help paths", () => {
    const doc = getPublicHelpDocument("zh-CN");
    expect(doc.guides.map((guide) => guide.href)).toEqual([
      "/help/enterprise-im",
      "/help/wecom",
      "/help/feishu",
      "/help/dingtalk",
    ]);
    expect(doc.workbenchGuides.map((guide) => guide.href)).toEqual([
      "/help/workbench",
      "/help/workbench/login-and-shell",
      "/help/workbench/assistant",
      "/help/workbench/collaboration",
      "/help/workbench/tasks",
      "/help/workbench/knowledge",
      "/help/workbench/settings",
      "/help/workbench/anti-hallucination",
    ]);
    for (const href of [...doc.guides, ...doc.workbenchGuides].map((guide) => guide.href)) {
      expect(href).not.toContain("docs.openbot.love");
      expect(href.startsWith("/help")).toBe(true);
    }
  });

  it("returns structured guide pages for each slug", () => {
    for (const slug of ["enterprise-im", "wecom", "feishu", "dingtalk"] as const) {
      const guide = getPublicHelpGuideDocument("zh-CN", slug);
      expect(guide.slug).toBe(slug);
      expect(guide.title.length).toBeGreaterThan(0);
      expect(guide.sections.length).toBeGreaterThan(0);
    }
  });

  it("does not recommend a private OpenBot runtime for on-prem data", () => {
    const zh = getPublicHelpDocument("zh-CN")
      .faq.map((item) => `${item.question} ${item.answer}`)
      .join("\n");
    const en = getPublicHelpDocument("en")
      .faq.map((item) => `${item.question} ${item.answer}`)
      .join("\n");
    expect(zh).toContain("客户侧私有模型");
    expect(zh).toContain("云端 SaaS");
    expect(zh).not.toContain("私有化部署");
    expect(zh).not.toContain("本地 Gateway");
    expect(en).toContain("customer-side private model");
    expect(en).not.toContain("Self-host OpenBot");
  });

  it("keeps public workbench copy free of repo paths, cutover notes, and account snapshots", () => {
    const hub = getPublicHelpDocument("zh-CN");
    const pages = [
      hub.intro.join("\n"),
      hub.workbenchGuidesIntro,
      ...(["index", ...WORKBENCH_HELP_CHILD_IDS] as const).flatMap((page) => {
        const doc = getWorkbenchHelpDocument("zh-CN", page);
        return [
          doc.subtitle,
          ...doc.sections.flatMap((section) => [
            ...(section.paragraphs ?? []),
            ...(section.bullets ?? []),
            ...((section.table?.rows ?? []).flat() ?? []),
          ]),
        ];
      }),
    ].join("\n");
    expect(pages).not.toContain("skills/");
    expect(pages).not.toContain("切流");
    expect(pages).not.toContain("docs.openbot.love");
    expect(pages).not.toContain("总任务 3");
    expect(pages).not.toContain("2 位成员");
    expect(pages).not.toContain("权变方案组");
  });
});
