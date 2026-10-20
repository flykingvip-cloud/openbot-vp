/**
 * Chat message types for the UI layer.
 */

/** A restorable checkpoint surfaced in the chat thread (chat-checkpoint-rollback). */
export type ChatCheckpoint = {
  checkpointId: string;
  createdAt: string;
  boundaryMessageId?: string;
  summary: string;
  restorable: { files: boolean; transcript: boolean };
  externalEffects: { present: boolean; kinds: string[] };
};

/** Union type for items in the chat thread */
export type ChatItem =
  | { kind: "message"; key: string; message: unknown }
  | {
      kind: "divider";
      key: string;
      label: string;
      timestamp: number;
      variant?: "session" | "system";
    }
  | {
      kind: "stream";
      key: string;
      text: string;
      startedAt: number;
      senderLabel?: string | null;
      agentId?: string | null;
      replyLanguage?: "zh" | "en" | null;
    }
  | { kind: "reading-indicator"; key: string; senderLabel?: string | null; agentId?: string | null }
  | { kind: "tool-progress"; key: string; texts: string[] }
  | {
      kind: "thinking-progress";
      key: string;
      progress: import("../../../../src/shared/text/thinking-progress.js").ThinkingProgressSnapshot;
      senderLabel?: string | null;
      agentId?: string | null;
    }
  | { kind: "task-card"; key: string; task: TaskCard }
  | {
      kind: "conversation-task-progress";
      key: string;
      entry: import("../chat/conversation-task-progress.ts").ConversationTaskProgressEntry;
    }
  | { kind: "artifact-entry"; key: string; artifact: ChatArtifact }
  | { kind: "checkpoint"; key: string; checkpoint: ChatCheckpoint }
  | {
      kind: "peer-exchange";
      key: string;
      labels: string[];
      count: number;
      groups: MessageGroup[];
    };

export type TaskCardStatus = "running" | "waiting" | "blocked" | "success" | "failed";

export type TaskCard = {
  id: string;
  title: string;
  step_current: number;
  step_total: number;
  step_name: string;
  status: TaskCardStatus;
  progress?: number;
  elapsed_time?: number;
  estimated_time?: string;
  message?: string;
};

export type ArtifactContext = {
  task_id: string;
  step_index: number;
  step_name: string;
  purpose: string;
  next_action: string;
};

export type ChatArtifactType = "document" | "report" | "markdown" | "ppt" | "config";

export type ChatArtifact = {
  id: string;
  artifact_type: ChatArtifactType;
  title: string;
  content: string;
  preview: boolean;
  preview_required?: boolean;
  context: ArtifactContext;
};

export type MessageEvent = {
  type: "message";
  role: "user" | "assistant";
  content: string;
};

export type TaskEvent = {
  type: "task_update";
  task: TaskCard;
};

export type ArtifactEvent = {
  type: "artifact";
  artifact: ChatArtifact;
};

export type ChatEvent = MessageEvent | TaskEvent | ArtifactEvent;

/** A group of consecutive messages from the same role (Slack-style layout) */
export type MessageGroup = {
  kind: "group";
  key: string;
  role: string;
  senderLabel?: string | null;
  agentId?: string | null;
  /** Display labels of the 1:1 counterpart. Absent for ordinary user/assistant groups. */
  peerLabels?: string[];
  /** Stable grouping key for a peer-out target set. */
  peerKey?: string;
  messages: Array<{ message: unknown; key: string }>;
  timestamp: number;
  isStreaming: boolean;
};

/** Content item types in a normalized message */
export type MessageContentItem = {
  type: "text" | "image" | "image_url" | "file" | "tool_call" | "tool_result";
  text?: string;
  name?: string;
  fileName?: string;
  mimeType?: string;
  assetId?: string;
  versionId?: string;
  contentHash?: string;
  sizeBytes?: number;
  lastModified?: number;
  status?: "reading" | "ready" | "uploading" | "sent" | "failed";
  args?: unknown;
};

/** Who an outbound 1:1 line was delivered to. */
export type PeerSentTarget = {
  agentId: string | null;
  label: string;
  sessionKey: string | null;
};

/** Normalized message structure for rendering */
export type NormalizedMessage = {
  role: string;
  content: MessageContentItem[];
  timestamp: number;
  id?: string;
  senderLabel?: string | null;
  agentId?: string | null;
  /** Set only for a durable outbound peer envelope (`peer-out`). */
  sentTo?: PeerSentTarget[];
};

/** Tool card representation for tool calls and results */
export type ToolCard = {
  kind: "call" | "result";
  name: string;
  args?: unknown;
  text?: string;
};
