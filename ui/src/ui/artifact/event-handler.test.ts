import { describe, it, expect, beforeEach } from "vitest";
import {
  detectArtifactFileType,
  detectArtifactKind,
  detectArtifactsInMessage,
  parseArtifactEvent,
} from "./event-handler.ts";
import { artifactRegistry } from "./registry.ts";

describe("Artifact Event Handler", () => {
  beforeEach(() => {
    artifactRegistry.clear();
  });

  describe("detectArtifactFileType", () => {
    it("detects Excel files", () => {
      expect(detectArtifactFileType("report.xlsx")).toBe("excel");
      expect(detectArtifactFileType("data.xls")).toBe("excel");
      expect(detectArtifactFileType("export.csv")).toBe("excel");
    });

    it("detects PowerPoint files", () => {
      expect(detectArtifactFileType("slides.pptx")).toBe("ppt");
      expect(detectArtifactFileType("deck.ppt")).toBe("ppt");
    });

    it("detects Word files", () => {
      expect(detectArtifactFileType("report.docx")).toBe("doc");
      expect(detectArtifactFileType("letter.doc")).toBe("doc");
    });

    it("detects PDF files", () => {
      expect(detectArtifactFileType("manual.pdf")).toBe("pdf");
    });

    it("detects Markdown files", () => {
      expect(detectArtifactFileType("README.md")).toBe("markdown");
      expect(detectArtifactFileType("notes.markdown")).toBe("markdown");
    });

    it("returns null for unknown types", () => {
      expect(detectArtifactFileType("image.png")).toBeNull();
      expect(detectArtifactFileType("script.js")).toBeNull();
    });

    it("falls back to mime type", () => {
      expect(detectArtifactFileType(undefined, "application/pdf")).toBe("pdf");
      expect(
        detectArtifactFileType(
          undefined,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
      ).toBe("excel");
    });
  });

  describe("detectArtifactKind", () => {
    it("detects analysis from title", () => {
      expect(detectArtifactKind("doc", "ESG分析报告.docx")).toBe("analysis");
    });

    it("detects report from title", () => {
      expect(detectArtifactKind("doc", "年度报告.docx")).toBe("report");
    });

    it("defaults by type", () => {
      expect(detectArtifactKind("excel", "data.xlsx")).toBe("spreadsheet");
      expect(detectArtifactKind("ppt", "slides.pptx")).toBe("presentation");
    });
  });

  describe("detectArtifactsInMessage", () => {
    it("detects file generation patterns in Chinese", () => {
      const taskId = artifactRegistry.createTask({ title: "Test" });
      const text = "已生成 `腾讯2025年度财务模型.xlsx`，包含4个工作表。";
      const artifacts = detectArtifactsInMessage(text, taskId);

      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].title).toBe("腾讯2025年度财务模型.xlsx");
      expect(artifacts[0].type).toBe("excel");
    });

    it("detects multiple files in one message", () => {
      const taskId = artifactRegistry.createTask({ title: "Test" });
      const text = `已创建以下文件：
        - 腾讯2025年度财务模型.xlsx
        - 已保存 腾讯2025年度业绩PPT.pptx
        - 生成了 腾讯2025年度分析报告.docx`;
      const artifacts = detectArtifactsInMessage(text, taskId);

      expect(artifacts).toHaveLength(3);
    });

    it("deduplicates same filename", () => {
      const taskId = artifactRegistry.createTask({ title: "Test" });
      const text = "已生成 report.xlsx。report.xlsx 包含数据。";
      const artifacts = detectArtifactsInMessage(text, taskId);

      expect(artifacts).toHaveLength(1);
    });

    it("auto-binds to task", () => {
      const taskId = artifactRegistry.createTask({ title: "Test" });
      detectArtifactsInMessage("已生成 data.xlsx", taskId);

      const task = artifactRegistry.getTask(taskId);
      expect(task!.artifacts).toHaveLength(1);
    });
  });

  describe("parseArtifactEvent", () => {
    it("parses explicit artifact event", () => {
      const event = parseArtifactEvent({
        type: "artifact",
        artifact: {
          id: "art-1",
          task_id: "task-1",
          title: "report.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });

      expect(event).not.toBeNull();
      expect(event!.artifact.type).toBe("excel");
      expect(event!.artifact.title).toBe("report.xlsx");
    });

    it("returns null for non-artifact messages", () => {
      expect(parseArtifactEvent({ type: "message", content: "hello" })).toBeNull();
      expect(parseArtifactEvent(null)).toBeNull();
      expect(parseArtifactEvent("string")).toBeNull();
    });

    it("returns null for unknown file types", () => {
      const event = parseArtifactEvent({
        type: "artifact",
        artifact: {
          id: "art-1",
          task_id: "task-1",
          title: "image.png",
        },
      });
      expect(event).toBeNull();
    });
  });
});
