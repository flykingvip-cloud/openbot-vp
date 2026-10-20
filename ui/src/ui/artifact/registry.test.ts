import { describe, it, expect, beforeEach } from "vitest";
import { ArtifactRegistry, getArtifactIcon, getArtifactTypeLabel } from "./registry.ts";

describe("ArtifactRegistry", () => {
  let registry: ArtifactRegistry;

  beforeEach(() => {
    registry = new ArtifactRegistry();
  });

  describe("Task Management", () => {
    it("creates a task with running status", () => {
      const taskId = registry.createTask({ title: "下载腾讯财报" });
      const task = registry.getTask(taskId);

      expect(task).not.toBeNull();
      expect(task!.title).toBe("下载腾讯财报");
      expect(task!.status).toBe("running");
      expect(task!.artifacts).toEqual([]);
    });

    it("updates task status", () => {
      const taskId = registry.createTask({ title: "生成Excel" });
      registry.updateTask(taskId, { status: "success" });

      const task = registry.getTask(taskId);
      expect(task!.status).toBe("success");
      expect(task!.completed_at).toBeDefined();
    });

    it("returns all tasks", () => {
      registry.createTask({ title: "Task 1" });
      registry.createTask({ title: "Task 2" });

      expect(registry.getAllTasks()).toHaveLength(2);
    });
  });

  describe("Artifact Management", () => {
    it("creates an artifact and auto-binds to task", () => {
      const taskId = registry.createTask({ title: "财务分析" });
      const artifact = registry.createArtifact({
        task_id: taskId,
        title: "腾讯2025年度财务模型.xlsx",
        type: "excel",
        summary: "包含4个工作表",
        metadata: { sheet_count: 4, size: 12288 },
      });

      expect(artifact.id).toBeDefined();
      expect(artifact.title).toBe("腾讯2025年度财务模型.xlsx");
      expect(artifact.type).toBe("excel");
      expect(artifact.kind).toBe("spreadsheet");
      expect(artifact.previewable).toBe(true);
      expect(artifact.downloadable).toBe(true);
      expect(artifact.lifecycle_state).toBe("registered");

      // Check task binding
      const task = registry.getTask(taskId);
      expect(task!.artifacts).toContain(artifact.id);
    });

    it("infers kind from type", () => {
      const taskId = registry.createTask({ title: "Test" });

      const excel = registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      expect(excel.kind).toBe("spreadsheet");

      const ppt = registry.createArtifact({ task_id: taskId, title: "b.pptx", type: "ppt" });
      expect(ppt.kind).toBe("presentation");

      const doc = registry.createArtifact({ task_id: taskId, title: "c.docx", type: "doc" });
      expect(doc.kind).toBe("document");

      const pdf = registry.createArtifact({ task_id: taskId, title: "d.pdf", type: "pdf" });
      expect(pdf.kind).toBe("report");
    });

    it("gets artifacts by task", () => {
      const taskId = registry.createTask({ title: "Multi-output" });
      registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      registry.createArtifact({ task_id: taskId, title: "b.pptx", type: "ppt" });
      registry.createArtifact({ task_id: taskId, title: "c.docx", type: "doc" });

      const artifacts = registry.getArtifactsByTask(taskId);
      expect(artifacts).toHaveLength(3);
    });

    it("updates artifact lifecycle state", () => {
      const taskId = registry.createTask({ title: "Test" });
      const artifact = registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });

      registry.updateArtifactState(artifact.id, "previewing");
      const updated = registry.getArtifact(artifact.id);
      expect(updated!.lifecycle_state).toBe("previewing");
    });

    it("increments artifact version", () => {
      const taskId = registry.createTask({ title: "Test" });
      const artifact = registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      expect(artifact.version).toBe(1);

      registry.updateArtifactVersion(artifact.id);
      const updated = registry.getArtifact(artifact.id);
      expect(updated!.version).toBe(2);
    });
  });

  describe("Preview Management", () => {
    it("opens preview for an artifact", () => {
      const taskId = registry.createTask({ title: "Test" });
      const artifact = registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });

      registry.openPreview(artifact.id);
      const state = registry.getPreviewState();

      expect(state.active_artifact_id).toBe(artifact.id);
      expect(state.opened_artifacts).toContain(artifact.id);
    });

    it("supports multiple open previews", () => {
      const taskId = registry.createTask({ title: "Test" });
      const a1 = registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      const a2 = registry.createArtifact({ task_id: taskId, title: "b.pptx", type: "ppt" });

      registry.openPreview(a1.id);
      registry.openPreview(a2.id);

      const state = registry.getPreviewState();
      expect(state.opened_artifacts).toHaveLength(2);
      expect(state.active_artifact_id).toBe(a2.id); // Last opened is active
    });

    it("closes preview and switches to previous", () => {
      const taskId = registry.createTask({ title: "Test" });
      const a1 = registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      const a2 = registry.createArtifact({ task_id: taskId, title: "b.pptx", type: "ppt" });

      registry.openPreview(a1.id);
      registry.openPreview(a2.id);
      registry.closePreview(a2.id);

      const state = registry.getPreviewState();
      expect(state.opened_artifacts).toHaveLength(1);
      expect(state.active_artifact_id).toBe(a1.id);
    });

    it("switches between preview tabs", () => {
      const taskId = registry.createTask({ title: "Test" });
      const a1 = registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      const a2 = registry.createArtifact({ task_id: taskId, title: "b.pptx", type: "ppt" });

      registry.openPreview(a1.id);
      registry.openPreview(a2.id);
      registry.switchPreview(a1.id);

      expect(registry.getPreviewState().active_artifact_id).toBe(a1.id);
    });
  });

  describe("Persistence", () => {
    it("exports ledger with all artifacts and tasks", () => {
      const taskId = registry.createTask({ title: "财务分析" });
      registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      registry.createArtifact({ task_id: taskId, title: "b.pptx", type: "ppt" });

      const ledger = registry.exportLedger();
      expect(ledger.artifacts).toHaveLength(2);
      expect(ledger.tasks).toHaveLength(1);
      expect(ledger.updated_at).toBeDefined();
    });

    it("imports ledger and marks artifacts as recovered", () => {
      const taskId = registry.createTask({ title: "Original" });
      registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      const ledger = registry.exportLedger();

      // Create new registry and import
      const newRegistry = new ArtifactRegistry();
      newRegistry.importLedger(ledger);

      const artifacts = newRegistry.getAllArtifacts();
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].lifecycle_state).toBe("recovered");
    });

    it("gets recent artifacts sorted by update time", () => {
      const taskId = registry.createTask({ title: "Test" });
      registry.createArtifact({ task_id: taskId, title: "old.xlsx", type: "excel" });

      // Small delay to ensure different timestamps
      const newer = registry.createArtifact({ task_id: taskId, title: "new.pptx", type: "ppt" });

      const recent = registry.getRecentArtifacts(1);
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe(newer.id);
    });
  });

  describe("Subscription", () => {
    it("notifies listeners on changes", () => {
      let callCount = 0;
      registry.subscribe(() => {
        callCount += 1;
      });

      registry.createTask({ title: "Test" });
      expect(callCount).toBe(1);

      const taskId = registry.getAllTasks()[0].id;
      registry.createArtifact({ task_id: taskId, title: "a.xlsx", type: "excel" });
      expect(callCount).toBe(2);
    });

    it("unsubscribes correctly", () => {
      let callCount = 0;
      const unsubscribe = registry.subscribe(() => {
        callCount += 1;
      });

      registry.createTask({ title: "Test" });
      expect(callCount).toBe(1);

      unsubscribe();
      registry.createTask({ title: "Test 2" });
      expect(callCount).toBe(1); // No additional call
    });
  });

  describe("Helpers", () => {
    it("returns correct icons", () => {
      expect(getArtifactIcon("excel")).toBe("📊");
      expect(getArtifactIcon("ppt")).toBe("📑");
      expect(getArtifactIcon("doc")).toBe("📝");
      expect(getArtifactIcon("pdf")).toBe("📄");
      expect(getArtifactIcon("markdown")).toBe("📋");
    });

    it("returns correct type labels", () => {
      expect(getArtifactTypeLabel("excel")).toBe("Excel");
      expect(getArtifactTypeLabel("ppt")).toBe("PPT");
      expect(getArtifactTypeLabel("doc")).toBe("Word");
      expect(getArtifactTypeLabel("pdf")).toBe("PDF");
      expect(getArtifactTypeLabel("markdown")).toBe("Markdown");
    });
  });
});
