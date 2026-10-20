import { createHash } from "node:crypto";

/**
 * Structural fingerprints for pattern clustering.
 * Prefer outline/schema signals over content words so similar templates cluster
 * without treating every reworded sentence as unique.
 */

export type StructureShape = {
  hasHeading: boolean;
  hasList: boolean;
  hasCodeFence: boolean;
  hasJsonLike: boolean;
  sectionCount: number;
  listItemCount: number;
  lengthBucket: number;
  /** Ordered structural outline tokens (content-words collapsed). */
  outline: string[];
};

/** Extract structural features from free text (user input or assistant output). */
export function extractStructureShape(text: string): StructureShape {
  const raw = text ?? "";
  const lines = raw.split(/\r?\n/);
  const outline: string[] = [];
  let listItemCount = 0;
  let sectionCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+\S/);
    if (heading) {
      sectionCount += 1;
      outline.push(`h${heading[1].length}`);
      continue;
    }
    if (/^\d+[.、)]\s+\S/.test(trimmed)) {
      sectionCount += 1;
      outline.push("ol");
      continue;
    }
    if (/^[-*•]\s+\S/.test(trimmed)) {
      listItemCount += 1;
      outline.push("ul");
      continue;
    }
  }
  const hasHeading = sectionCount > 0 || /(^|\n)\s*#{1,6}\s+\S/.test(raw);
  const hasList = listItemCount > 0 || /(^|\n)\s*[-*•]\s+\S/.test(raw);
  const hasCodeFence = /```/.test(raw);
  const hasJsonLike = /[{[][\s\S]*[}\]]/.test(raw) && /"\w+"\s*:/.test(raw);
  const lengthBucket = Math.min(20, Math.floor(raw.trim().length / 100));
  return {
    hasHeading,
    hasList,
    hasCodeFence,
    hasJsonLike,
    sectionCount: Math.min(sectionCount, 20),
    listItemCount: Math.min(listItemCount, 50),
    lengthBucket,
    outline: outline.slice(0, 24),
  };
}

/**
 * Hash free text by structure first.
 * Content words are collapsed so "Alice sold 12" ≈ "Bob sold 99" under the same outline.
 */
export function structureHashFromText(text: string): string {
  const shape = extractStructureShape(text);
  // Structural body: collapse letters to W, keep only punctuation class markers.
  const bodySkeleton = (text ?? "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " @code ")
    .replace(/https?:\/\/\S+/g, " @url ")
    .replace(/[0-9]+/g, "#")
    .replace(/[a-f0-9]{8,}/g, "@id")
    .replace(/[\p{L}]{2,}/gu, "W")
    .replace(/[^\w#@\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const shapeKey = [
    `h${shape.hasHeading ? 1 : 0}`,
    `l${shape.hasList ? 1 : 0}`,
    `c${shape.hasCodeFence ? 1 : 0}`,
    `j${shape.hasJsonLike ? 1 : 0}`,
    `s${shape.sectionCount}`,
    `li${shape.listItemCount}`,
    `b${shape.lengthBucket}`,
    `o:${shape.outline.join("/")}`,
  ].join("|");
  // Strong outline → outline dominates; freeform still uses skeleton.
  const payload = shape.outline.length >= 2 ? shapeKey : `${shapeKey}||${bodySkeleton}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Tool-trace fingerprint: ordered unique tool names (lowercased), not free text.
 */
export function structureHashFromToolTrace(toolNames: string[]): string {
  const normalized = [
    ...new Set(
      toolNames
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .map((t) => t.replace(/[0-9]+/g, "#")),
    ),
  ].toSorted();
  if (normalized.length === 0) {
    return createHash("sha256").update("tools:none").digest("hex").slice(0, 16);
  }
  return createHash("sha256")
    .update(`tools:${normalized.join(">")}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * IO-role aware hash (input vs output).
 */
export function structureHashFromIo(text: string, role: "input" | "output"): string {
  return createHash("sha256")
    .update(`${role}|${structureHashFromText(text)}`)
    .digest("hex")
    .slice(0, 16);
}
