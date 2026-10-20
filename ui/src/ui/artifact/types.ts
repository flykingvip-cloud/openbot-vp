/**
 * Artifact Delivery Layer — Core Types
 *
 * Artifacts are first-class objects representing user-facing deliverables.
 * They are NOT task summaries. Each artifact is independently openable,
 * previewable, downloadable, and recoverable.
 */

export type ArtifactKind =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "report"
  | "analysis"
  | "pdf"
  | "markdown";

export type ArtifactFileType = "excel" | "ppt" | "doc" | "pdf" | "markdown";

export type ArtifactLifecycleState =
  | "generating"
  | "registered"
  | "previewing"
  | "editing"
  | "persisted"
  | "recovered";

/**
 * Core Artifact — the first-class deliverable object.
 *
 * Every generated file (xlsx, pptx, docx, pdf, md) MUST be registered
 * as an Artifact. It is forbidden to only output text like "已生成xxx.docx".
 */
export type Artifact = {
  id: string;
  task_id: string;
  title: string;
  type: ArtifactFileType;
  kind: ArtifactKind;
  subtype?: string;
  path?: string;
  url?: string;
  previewUrl?: string;
  downloadUrl?: string;
  editUrl?: string;
  openUrl?: string;
  previewable: boolean;
  editable: boolean;
  downloadable: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  summary?: string;
  source_session_id?: string;
  lifecycle_state: ArtifactLifecycleState;
  metadata?: ArtifactMetadata;
};

export type ArtifactMetadata = {
  page_count?: number;
  sheet_count?: number;
  slide_count?: number;
  word_count?: number;
  size?: number;
  sheets?: string[];
  sections?: string[];
  author?: string;
};

/**
 * Task with artifact binding.
 * A Task is an execution process. Artifacts are the user's final deliverables.
 */
export type Task = {
  id: string;
  title: string;
  status: "running" | "waiting" | "success" | "failed";
  artifacts: string[]; // artifact IDs
  progress?: number;
  started_at: string;
  completed_at?: string;
  message?: string;
};

/**
 * ArtifactEvent — emitted when an artifact is created or updated.
 * The chat layer renders this as an ArtifactCard, NOT as text.
 */
export type ArtifactEvent = {
  type: "artifact";
  artifact: Artifact;
};

/**
 * Preview state — managed per artifact_id, NOT per "current file".
 */
export type PreviewState = {
  active_artifact_id: string | null;
  opened_artifacts: string[];
};

/**
 * Artifact Ledger — persisted across sessions for recovery.
 */
export type ArtifactLedger = {
  artifacts: Artifact[];
  tasks: Task[];
  last_session_id?: string;
  updated_at: string;
};

/**
 * ArtifactCard display props for the chat UI.
 */
export type ArtifactCardProps = {
  artifact: Artifact;
  onOpen?: (artifactId: string) => void;
  onPreview?: (artifactId: string) => void;
  onDownload?: (artifactId: string) => void;
  onEdit?: (artifactId: string) => void;
};

/**
 * TaskCard display props — shows task status + linked artifact cards.
 */
export type TaskCardProps = {
  task: Task;
  artifacts: Artifact[];
  onOpenArtifact?: (artifactId: string) => void;
  onPreviewArtifact?: (artifactId: string) => void;
  onDownloadArtifact?: (artifactId: string) => void;
};
