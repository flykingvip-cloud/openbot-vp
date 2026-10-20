/**
 * Artifact Registry — manages all artifact objects as first-class entities.
 *
 * Rules:
 * - Any generated docx/pptx/xlsx/pdf/md MUST call createArtifact()
 * - Artifacts MUST auto-associate with task_id
 * - Artifacts MUST be persisted (not just in preview state)
 * - It is FORBIDDEN to only output text like "已生成xxx.docx"
 */

import type {
  Artifact,
  ArtifactFileType,
  ArtifactKind,
  ArtifactLedger,
  ArtifactLifecycleState,
  ArtifactMetadata,
  PreviewState,
  Task,
} from "./types.ts";

let artifactIdCounter = 0;

function generateArtifactId(): string {
  artifactIdCounter += 1;
  return `artifact-${Date.now()}-${artifactIdCounter}`;
}

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Infer artifact kind from file type.
 */
function inferKind(type: ArtifactFileType): ArtifactKind {
  switch (type) {
    case "excel":
      return "spreadsheet";
    case "ppt":
      return "presentation";
    case "doc":
      return "document";
    case "pdf":
      return "report";
    case "markdown":
      return "markdown";
  }
}

/**
 * Infer previewable status from file type.
 */
function inferPreviewable(type: ArtifactFileType): boolean {
  // All supported types are previewable
  return ["excel", "ppt", "doc", "pdf", "markdown"].includes(type);
}

/**
 * Get the emoji icon for an artifact type.
 */
export function getArtifactIcon(type: ArtifactFileType): string {
  switch (type) {
    case "excel":
      return "📊";
    case "ppt":
      return "📑";
    case "doc":
      return "📝";
    case "pdf":
      return "📄";
    case "markdown":
      return "📋";
  }
}

/**
 * Get human-readable label for artifact type.
 */
export function getArtifactTypeLabel(type: ArtifactFileType): string {
  switch (type) {
    case "excel":
      return "Excel";
    case "ppt":
      return "PPT";
    case "doc":
      return "Word";
    case "pdf":
      return "PDF";
    case "markdown":
      return "Markdown";
  }
}

export type CreateArtifactInput = {
  task_id: string;
  title: string;
  type: ArtifactFileType;
  kind?: ArtifactKind;
  subtype?: string;
  path?: string;
  url?: string;
  previewUrl?: string;
  downloadUrl?: string;
  editUrl?: string;
  openUrl?: string;
  summary?: string;
  source_session_id?: string;
  metadata?: ArtifactMetadata;
};

export type CreateTaskInput = {
  title: string;
  message?: string;
};

/**
 * The Artifact Registry — singleton that manages all artifacts and tasks.
 */
export class ArtifactRegistry {
  private artifacts: Map<string, Artifact> = new Map();
  private tasks: Map<string, Task> = new Map();
  private previewState: PreviewState = {
    active_artifact_id: null,
    opened_artifacts: [],
  };
  private listeners: Set<() => void> = new Set();
  private sessionId: string | null = null;

  /**
   * Subscribe to registry changes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Set the current session ID for artifact association.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  // ─── Task Management ───────────────────────────────────────────────

  /**
   * Create a new task. Returns the task ID.
   */
  createTask(input: CreateTaskInput): string {
    const id = generateTaskId();
    const task: Task = {
      id,
      title: input.title,
      status: "running",
      artifacts: [],
      started_at: new Date().toISOString(),
      message: input.message,
    };
    this.tasks.set(id, task);
    this.notify();
    return id;
  }

  /**
   * Update task status.
   */
  updateTask(
    taskId: string,
    update: Partial<Pick<Task, "status" | "progress" | "message" | "completed_at">>,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }
    Object.assign(task, update);
    if (update.status === "success" || update.status === "failed") {
      task.completed_at = task.completed_at ?? new Date().toISOString();
    }
    this.notify();
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): Task | null {
    return this.tasks.get(taskId) ?? null;
  }

  /**
   * Get all tasks.
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  // ─── Artifact Management ───────────────────────────────────────────

  /**
   * Create and register a new artifact.
   * This is the ONLY way to create artifacts — direct text output is forbidden.
   */
  createArtifact(input: CreateArtifactInput): Artifact {
    const id = generateArtifactId();
    const now = new Date().toISOString();

    const artifact: Artifact = {
      id,
      task_id: input.task_id,
      title: input.title,
      type: input.type,
      kind: input.kind ?? inferKind(input.type),
      subtype: input.subtype,
      path: input.path,
      url: input.url,
      previewUrl: input.previewUrl,
      downloadUrl: input.downloadUrl,
      editUrl: input.editUrl,
      openUrl: input.openUrl,
      previewable: inferPreviewable(input.type),
      editable: input.type !== "pdf",
      downloadable: true,
      version: 1,
      created_at: now,
      updated_at: now,
      summary: input.summary,
      source_session_id: input.source_session_id ?? this.sessionId ?? undefined,
      lifecycle_state: "registered",
      metadata: input.metadata,
    };

    this.artifacts.set(id, artifact);

    // Auto-bind to task
    const task = this.tasks.get(input.task_id);
    if (task) {
      task.artifacts.push(id);
    }

    this.notify();
    return artifact;
  }

  /**
   * Get an artifact by ID.
   */
  getArtifact(artifactId: string): Artifact | null {
    return this.artifacts.get(artifactId) ?? null;
  }

  /**
   * Get all artifacts.
   */
  getAllArtifacts(): Artifact[] {
    return Array.from(this.artifacts.values());
  }

  /**
   * Get all artifacts for a specific task.
   */
  getArtifactsByTask(taskId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter((a) => a.task_id === taskId);
  }

  /**
   * Update artifact lifecycle state.
   */
  updateArtifactState(artifactId: string, state: ArtifactLifecycleState): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return;
    }
    artifact.lifecycle_state = state;
    artifact.updated_at = new Date().toISOString();
    this.notify();
  }

  /**
   * Update artifact version (e.g., after edit).
   */
  updateArtifactVersion(artifactId: string, updates?: Partial<ArtifactMetadata>): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return;
    }
    artifact.version += 1;
    artifact.updated_at = new Date().toISOString();
    if (updates && artifact.metadata) {
      Object.assign(artifact.metadata, updates);
    }
    this.notify();
  }

  // ─── Preview Management ────────────────────────────────────────────

  /**
   * Open an artifact for preview.
   * Preview is per artifact_id, NOT per "current file".
   */
  openPreview(artifactId: string): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || !artifact.previewable) {
      return;
    }
    this.previewState.active_artifact_id = artifactId;
    if (!this.previewState.opened_artifacts.includes(artifactId)) {
      this.previewState.opened_artifacts.push(artifactId);
    }
    artifact.lifecycle_state = "previewing";
    artifact.updated_at = new Date().toISOString();
    this.notify();
  }

  /**
   * Close a preview tab for an artifact.
   */
  closePreview(artifactId: string): void {
    this.previewState.opened_artifacts = this.previewState.opened_artifacts.filter(
      (id) => id !== artifactId,
    );
    if (this.previewState.active_artifact_id === artifactId) {
      this.previewState.active_artifact_id =
        this.previewState.opened_artifacts[this.previewState.opened_artifacts.length - 1] ?? null;
    }
    this.notify();
  }

  /**
   * Switch active preview to a different artifact.
   */
  switchPreview(artifactId: string): void {
    if (!this.previewState.opened_artifacts.includes(artifactId)) {
      this.openPreview(artifactId);
      return;
    }
    this.previewState.active_artifact_id = artifactId;
    this.notify();
  }

  /**
   * Get current preview state.
   */
  getPreviewState(): PreviewState {
    return { ...this.previewState };
  }

  /**
   * Get the currently active preview artifact.
   */
  getActivePreviewArtifact(): Artifact | null {
    if (!this.previewState.active_artifact_id) {
      return null;
    }
    return this.artifacts.get(this.previewState.active_artifact_id) ?? null;
  }

  // ─── Persistence / Recovery ────────────────────────────────────────

  /**
   * Export the full ledger for persistence.
   */
  exportLedger(): ArtifactLedger {
    return {
      artifacts: Array.from(this.artifacts.values()),
      tasks: Array.from(this.tasks.values()),
      last_session_id: this.sessionId ?? undefined,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Import a ledger (e.g., on session recovery).
   */
  importLedger(ledger: ArtifactLedger): void {
    this.artifacts.clear();
    this.tasks.clear();

    for (const artifact of ledger.artifacts) {
      this.artifacts.set(artifact.id, { ...artifact, lifecycle_state: "recovered" });
    }
    for (const task of ledger.tasks) {
      this.tasks.set(task.id, task);
    }
    if (ledger.last_session_id) {
      this.sessionId = ledger.last_session_id;
    }
    this.notify();
  }

  /**
   * Get recent artifacts for session recovery prompt.
   */
  getRecentArtifacts(limit = 10): Artifact[] {
    return Array.from(this.artifacts.values())
      .toSorted((a, b) => {
        const byTime = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        if (byTime !== 0) {
          return byTime;
        }
        // Stable preference for later-created ids when timestamps collide (same ms).
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      })
      .slice(0, limit);
  }

  /**
   * Clear all state (for testing or full reset).
   */
  clear(): void {
    this.artifacts.clear();
    this.tasks.clear();
    this.previewState = { active_artifact_id: null, opened_artifacts: [] };
    this.sessionId = null;
    artifactIdCounter = 0;
    this.notify();
  }
}

/**
 * Singleton registry instance.
 */
export const artifactRegistry = new ArtifactRegistry();
