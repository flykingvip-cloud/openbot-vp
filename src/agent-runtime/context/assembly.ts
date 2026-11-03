/** Pure system-material assembly. Source evaluation and trust selection stay with callers. */
export function selectSystemContextParts(parts: readonly (string | undefined)[]): string[] {
  return parts.filter((part): part is string => Boolean(part?.trim()));
}

/** Append already-admitted material without changing whitespace, ordering or duplicates. */
export function appendSystemContextPart(parts: readonly string[], part: string): string[] {
  return [...parts, part];
}

export function finalizeSystemContext(parts: readonly string[]): string | undefined {
  return parts.join("\n\n") || undefined;
}
