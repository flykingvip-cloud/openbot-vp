import { hashText } from "../../../memory/internal.js";

export function normalizeChunkTextForHash(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function computeChunkSemanticHash(text: string): string {
  return hashText(normalizeChunkTextForHash(text));
}
