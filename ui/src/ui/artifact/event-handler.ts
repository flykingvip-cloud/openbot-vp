/**
 * Artifact Event Handler
 *
 * Processes incoming artifact events from the agent/gateway and
 * registers them in the Artifact Registry.
 *
 * Rules:
 * - ArtifactEvent MUST result in ArtifactCard rendering (not chat text)
 * - Every file generation MUST emit an ArtifactEvent
 * - tool_result, exec, poll, stdout, raw json are FORBIDDEN in user view
 */

import { artifactRegistry } from "./registry.ts";
import type { Artifact, ArtifactEvent, ArtifactFileType, ArtifactKind } from "./types.ts";

/**
 * Detect artifact file type from filename or mime type.
 */
export function detectArtifactFileType(
  filename?: string,
  mimeType?: string,
): ArtifactFileType | null {
  const lower = (filename ?? "").toLowerCase();

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")) {
    return "excel";
  }
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) {
    return "ppt";
  }
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
    return "doc";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "markdown";
  }

  // Fallback to mime type
  if (mimeType) {
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
      return "excel";
    }
    if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) {
      return "ppt";
    }
    if (mimeType.includes("wordprocessing") || mimeType.includes("msword")) {
      return "doc";
    }
    if (mimeType.includes("pdf")) {
      return "pdf";
    }
    if (mimeType.includes("markdown")) {
      return "markdown";
    }
  }

  return null;
}

/**
 * Detect artifact kind from type and context.
 */
export function detectArtifactKind(type: ArtifactFileType, title?: string): ArtifactKind {
  const lowerTitle = (title ?? "").toLowerCase();

  // Check title for specific kinds
  if (lowerTitle.includes("分析") || lowerTitle.includes("analysis")) {
    return "analysis";
  }
  if (lowerTitle.includes("报告") || lowerTitle.includes("report")) {
    return "report";
  }

  // Default by type
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
 * Process an incoming ArtifactEvent from the agent.
 * Registers the artifact and returns it for rendering.
 */
export function handleArtifactEvent(event: ArtifactEvent): Artifact {
  const { artifact: eventArtifact } = event;

  // Check if already registered (idempotent)
  const existing = artifactRegistry.getArtifact(eventArtifact.id);
  if (existing) {
    return existing;
  }

  // Register in the registry
  const artifact = artifactRegistry.createArtifact({
    task_id: eventArtifact.task_id,
    title: eventArtifact.title,
    type: eventArtifact.type,
    kind: eventArtifact.kind,
    subtype: eventArtifact.subtype,
    path: eventArtifact.path,
    url: eventArtifact.url,
    previewUrl: eventArtifact.previewUrl,
    downloadUrl: eventArtifact.downloadUrl,
    editUrl: eventArtifact.editUrl,
    openUrl: eventArtifact.openUrl,
    summary: eventArtifact.summary,
    source_session_id: eventArtifact.source_session_id,
    metadata: eventArtifact.metadata,
  });

  return artifact;
}

/**
 * Parse a raw message/event and determine if it contains an artifact event.
 * Returns the ArtifactEvent if detected, null otherwise.
 */
export function parseArtifactEvent(message: unknown): ArtifactEvent | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }

  const record = message as Record<string, unknown>;

  // Explicit artifact event
  if (record.type === "artifact" && record.artifact) {
    const artifactData = record.artifact as Record<string, unknown>;
    const type = detectArtifactFileType(
      artifactData.title as string | undefined,
      artifactData.mimeType as string | undefined,
    );

    if (!type) {
      return null;
    }

    return {
      type: "artifact",
      artifact: {
        id: (artifactData.id as string) ?? `auto-${Date.now()}`,
        task_id: (artifactData.task_id as string) ?? "",
        title: (artifactData.title as string) ?? "Untitled",
        type,
        kind: detectArtifactKind(type, artifactData.title as string),
        path: artifactData.path as string | undefined,
        url: artifactData.url as string | undefined,
        previewUrl: artifactData.previewUrl as string | undefined,
        downloadUrl: artifactData.downloadUrl as string | undefined,
        editUrl: artifactData.editUrl as string | undefined,
        openUrl: artifactData.openUrl as string | undefined,
        previewable: true,
        editable: type !== "pdf",
        downloadable: true,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        summary: artifactData.summary as string | undefined,
        source_session_id: artifactData.source_session_id as string | undefined,
        lifecycle_state: "registered",
        metadata: artifactData.metadata as Record<string, unknown> | undefined,
      } as Artifact,
    };
  }

  return null;
}

/**
 * Detect if a chat message text contains file generation patterns
 * and extract artifact information from it.
 *
 * This is a fallback for agents that don't emit proper ArtifactEvents.
 * The proper path is always to emit ArtifactEvent directly.
 */
export function detectArtifactsInMessage(text: string, taskId: string): Artifact[] {
  const artifacts: Artifact[] = [];
  // Verb-led patterns ("已生成 a.xlsx") plus bare list filenames ("- a.xlsx").
  const filePattern =
    /(?:已[生创]成|已保存|输出|生成了?|创建了?|保存[为到在])\s*[：:]*\s*[`"'《]?([^`"'》\n]{2,80}\.(?:xlsx?|pptx?|docx?|pdf|md|csv))[`"'》]?|(?:^|\n)\s*[-•*、]\s+[ `"'《]?((?!已|生成|输出|创建|保存)[^`"'》\n]{2,80}\.(?:xlsx?|pptx?|docx?|pdf|md|csv))[`"'》]?/gi;

  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = filePattern.exec(text))) {
    const filename = (match[1] ?? match[2])?.trim();
    if (!filename || seen.has(filename)) {
      continue;
    }
    seen.add(filename);

    const type = detectArtifactFileType(filename);
    if (!type) {
      continue;
    }

    const artifact = artifactRegistry.createArtifact({
      task_id: taskId,
      title: filename,
      type,
      kind: detectArtifactKind(type, filename),
    });
    artifacts.push(artifact);
  }

  return artifacts;
}
