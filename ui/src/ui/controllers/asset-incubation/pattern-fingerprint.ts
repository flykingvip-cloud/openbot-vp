import { hashTextSync } from "../../utils/sync-hash.ts";
import {
  buildNormalizedIntentKey,
  intentKeyLabel,
  suggestedAssetTypeForIntent,
} from "./intent-key.ts";
import type { PatternFingerprint } from "./types.ts";

function hashText(value: string): string {
  return hashTextSync(value, 12);
}

export function buildOutputSchemaHash(text: string): string {
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? "");
  const numbered = [...text.matchAll(/^\s*\d+[.、)]\s+(.+)$/gm)].map(
    (match) => match[1]?.trim() ?? "",
  );
  const bullets = [...text.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? "");
  const signature = [
    `h:${headings.length}`,
    headings.slice(0, 4).join("|"),
    `n:${numbered.length}`,
    `b:${bullets.length}`,
  ].join(";");
  return hashText(signature);
}

export function buildWorkflowSignature(signalKinds: string[]): string {
  const normalized = [
    ...new Set(signalKinds.map((kind) => kind.trim()).filter(Boolean)),
  ].toSorted();
  if (normalized.length === 0) {
    return "none";
  }
  return hashText(normalized.join("+"));
}

export function buildPatternFingerprint(params: {
  text: string;
  hasArtifact: boolean;
  hasStructuredOutput: boolean;
  hasWorkflowLanguage: boolean;
  signalKinds?: string[];
}): PatternFingerprint & {
  clusterId: string;
  intentKey: string;
  label: string;
  suggestedAssetType: ReturnType<typeof suggestedAssetTypeForIntent>;
} {
  const intentKey = buildNormalizedIntentKey({
    text: params.text,
    hasArtifact: params.hasArtifact,
    hasStructuredOutput: params.hasStructuredOutput,
  });
  const outputSchemaHash = params.hasStructuredOutput
    ? buildOutputSchemaHash(params.text)
    : undefined;
  const workflowSignature = buildWorkflowSignature([
    ...(params.signalKinds ?? []),
    params.hasWorkflowLanguage ? "fixed_workflow" : "",
  ]);
  const clusterId = hashText(
    [
      intentKey,
      outputSchemaHash ?? "plain",
      workflowSignature,
      params.hasArtifact ? "artifact" : "",
    ]
      .filter(Boolean)
      .join(":"),
  );
  return {
    clusterId,
    intentKey,
    label: intentKeyLabel(intentKey),
    suggestedAssetType: suggestedAssetTypeForIntent(intentKey),
    outputSchemaHash,
    workflowSignature,
  };
}
