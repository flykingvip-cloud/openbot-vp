import { describe, expect, it } from "vitest";
import {
  ASSET_CONTENT_REQUIREMENTS,
  AssetAdmissionError,
  assertAssetAdmissible,
  evaluateAssetContentReadiness,
  INCUBATION_ELIGIBLE_ASSET_TYPES,
  isPlaceholderContent,
  RECOGNIZED_ASSET_TYPES,
} from "./asset-admission.js";

describe("asset-admission", () => {
  it("recognizes first-class asset types as incubation-eligible", () => {
    expect(RECOGNIZED_ASSET_TYPES.toSorted()).toEqual(
      [
        "agent",
        "capability",
        "knowledge",
        "mcp",
        "prompt",
        "template",
        "tool",
        "workflow",
      ].toSorted(),
    );
    expect(INCUBATION_ELIGIBLE_ASSET_TYPES).toEqual(RECOGNIZED_ASSET_TYPES);
    for (const type of RECOGNIZED_ASSET_TYPES) {
      expect(ASSET_CONTENT_REQUIREMENTS[type].some((r) => r.field === "summary")).toBe(true);
    }
  });

  it("detects auto-generated placeholder / fallback content", () => {
    expect(isPlaceholderContent("上传文档 顾氏医案.pdf")).toBe(true);
    expect(
      isPlaceholderContent(
        "文档：顾氏医案.pdf (application/pdf, 1.2 MB)\n\n已登记附件，Office/PDF 全文解析将在后续版本提供。",
      ),
    ).toBe(true);
    expect(isPlaceholderContent("知识宇宙文档上传: 顾氏医案.pdf")).toBe(true);
    expect(isPlaceholderContent("顾氏医案整理的辨证要点与用药规律")).toBe(false);
    expect(isPlaceholderContent("")).toBe(false);
  });

  it("blocks an unfilled uploaded document from admission (the 顾氏医案 case)", () => {
    const readiness = evaluateAssetContentReadiness({
      assetType: "knowledge",
      name: "顾氏医案",
      summary: "上传文档 顾氏医案.pdf",
      outputDescription:
        "文档：顾氏医案.pdf (application/pdf, 1.2 MB)\n\n已登记附件，Office/PDF 全文解析将在后续版本提供。",
      inputDescription: "知识宇宙文档上传: 顾氏医案.pdf",
      usageExamples: [],
      tags: ["上传文档", "pdf"],
      category: "上传文档",
    });
    expect(readiness.admissible).toBe(false);
    expect(readiness.ready).toBe(false);
    const blockingFields = readiness.gaps.filter((g) => g.severity === "block").map((g) => g.field);
    expect(blockingFields).toContain("summary");
    expect(blockingFields).toContain("outputDescription");
    expect(() => assertAssetAdmissible(readiness2Input(), "共享到协作小组")).toThrow(
      AssetAdmissionError,
    );
  });

  it("admits a knowledge asset with real value + content, flags scenario as still-recommended", () => {
    const readiness = evaluateAssetContentReadiness({
      assetType: "knowledge",
      name: "顾氏医案",
      summary: "顾氏内科辨证与用药规律速查，用于中医问诊初筛",
      outputDescription: "第一章 辨证纲要……（真实正文）",
      inputDescription: "来源：顾氏家传手抄本，2024 整理版",
      usageExamples: [],
    });
    expect(readiness.admissible).toBe(true); // 硬门槛通过，可进入孵化通道
    expect(readiness.ready).toBe(false); // 但适用范围（场景）尚未补齐
    expect(readiness.gaps.map((g) => g.field)).toContain("usageExamples");
    expect(readiness.gaps.every((g) => g.severity === "recommend")).toBe(true);
  });

  it("marks a fully-filled capability as ready and admissible, and does not throw", () => {
    const input = {
      assetType: "capability" as const,
      name: "客户跟进摘要",
      summary: "自动生成客户跟进摘要，节省销售整理时间",
      usageExamples: ["销售周会前整理客户进展"],
      inputDescription: "客户对话记录",
      outputDescription: "结构化跟进摘要",
    };
    const readiness = evaluateAssetContentReadiness(input);
    expect(readiness.admissible).toBe(true);
    expect(readiness.ready).toBe(true);
    expect(readiness.gaps).toHaveLength(0);
    expect(() => assertAssetAdmissible(input, "提交企业")).not.toThrow();
  });
});

function readiness2Input() {
  return {
    assetType: "knowledge" as const,
    name: "顾氏医案",
    summary: "上传文档 顾氏医案.pdf",
    outputDescription: "已登记附件，Office/PDF 全文解析将在后续版本提供。",
    usageExamples: [] as string[],
  };
}
