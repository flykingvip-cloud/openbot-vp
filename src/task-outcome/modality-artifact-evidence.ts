/**
 * Artifact-backed modality completion evidence.
 *
 * Image / music target modalities must not be marked completed from a bare
 * trusted-runner text turn. Real tool artifacts (relativePath from image_gen /
 * music_gen) are required before mark_target_modality_completed.
 */

export const ARTIFACT_BACKED_TARGET_MODALITIES = [
  "image_generation",
  "audio_music_generation",
] as const;

export type ArtifactBackedTargetModality = (typeof ARTIFACT_BACKED_TARGET_MODALITIES)[number];

export type ModalityExecutionArtifact = {
  toolName: string;
  relativePath: string;
};

export type ModalityCompletionEvidence = {
  kind: "execution_artifact" | "run_completed" | "acceptance_artifact";
  digestOrRef: string;
  detail?: string;
};

const GEN_TOOL_BY_MODALITY: Record<ArtifactBackedTargetModality, string> = {
  image_generation: "image_gen",
  audio_music_generation: "music_gen",
};

export function isArtifactBackedTargetModality(
  modality: string | null | undefined,
): modality is ArtifactBackedTargetModality {
  return modality === "image_generation" || modality === "audio_music_generation";
}

export function normalizeGenToolName(toolName: string | null | undefined): string {
  return (toolName ?? "").trim().toLowerCase();
}

export function isModalityGenToolName(toolName: string | null | undefined): boolean {
  const name = normalizeGenToolName(toolName);
  return name === "image_gen" || name === "music_gen";
}

/**
 * Pull workspace-relative path from image_gen / music_gen tool result details
 * (or a "relativePath: …" line in text content).
 */
export function extractGenToolRelativePath(
  toolName: string | null | undefined,
  result: unknown,
): string | undefined {
  if (!isModalityGenToolName(toolName)) {
    return undefined;
  }
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  const details = record.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const relativePath = (details as Record<string, unknown>).relativePath;
    if (typeof relativePath === "string" && relativePath.trim()) {
      return relativePath.trim();
    }
  }
  const content = record.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const text = (block as { text?: unknown }).text;
      if (typeof text !== "string" || !text.includes("relativePath:")) {
        continue;
      }
      const match = text.match(/relativePath:\s*(\S+)/u);
      const path = match?.[1]?.trim();
      if (path) {
        return path;
      }
    }
  }
  return undefined;
}

/** Choose execution_artifact evidence matching the target modality, if any. */
export function pickModalityCompletionEvidence(params: {
  targetModality: string;
  artifacts: readonly ModalityExecutionArtifact[];
}): ModalityCompletionEvidence | undefined {
  if (!isArtifactBackedTargetModality(params.targetModality)) {
    return undefined;
  }
  const wantedTool = GEN_TOOL_BY_MODALITY[params.targetModality];
  for (const artifact of params.artifacts) {
    if (normalizeGenToolName(artifact.toolName) !== wantedTool) {
      continue;
    }
    const relativePath = artifact.relativePath.trim();
    if (!relativePath) {
      continue;
    }
    return {
      kind: "execution_artifact",
      digestOrRef: relativePath,
      detail: `tool=${wantedTool}`,
    };
  }
  return undefined;
}

/**
 * Resolve mark_target_modality_completed evidence for a trusted runner turn.
 * Artifact-backed modalities require a real tool artifact; chat/text may use
 * run_completed. Returns undefined when the turn must leave modality incomplete.
 */
export function resolveTrustedRunModalityCompletionEvidence(params: {
  targetModality: string;
  success: boolean;
  runId: string;
  explicitEvidence?: ModalityCompletionEvidence | null;
  artifacts?: readonly ModalityExecutionArtifact[] | null;
}): ModalityCompletionEvidence | undefined {
  if (!params.success) {
    return undefined;
  }
  if (isArtifactBackedTargetModality(params.targetModality)) {
    if (
      params.explicitEvidence?.kind === "execution_artifact" &&
      params.explicitEvidence.digestOrRef.trim()
    ) {
      return {
        kind: "execution_artifact",
        digestOrRef: params.explicitEvidence.digestOrRef.trim(),
        ...(params.explicitEvidence.detail ? { detail: params.explicitEvidence.detail } : {}),
      };
    }
    return pickModalityCompletionEvidence({
      targetModality: params.targetModality,
      artifacts: params.artifacts ?? [],
    });
  }
  if (
    params.explicitEvidence?.digestOrRef.trim() &&
    (params.explicitEvidence.kind === "run_completed" ||
      params.explicitEvidence.kind === "execution_artifact" ||
      params.explicitEvidence.kind === "acceptance_artifact")
  ) {
    return {
      kind: params.explicitEvidence.kind,
      digestOrRef: params.explicitEvidence.digestOrRef.trim(),
      ...(params.explicitEvidence.detail ? { detail: params.explicitEvidence.detail } : {}),
    };
  }
  const runId = params.runId.trim();
  if (!runId) {
    return undefined;
  }
  return {
    kind: "run_completed",
    digestOrRef: `run:${runId}`,
    detail: "trusted_runner_turn_success",
  };
}
