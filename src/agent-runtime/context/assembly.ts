import { INDIVIDUAL_CONTEXT_ORDER, type IndividualContextMaterial } from "./catalog/individual.js";

/** Consume already-rendered trusted material. Unknown material fails closed, even when empty. */
export function assembleIndividual(
  material: Partial<Record<IndividualContextMaterial, string | undefined>>,
): string[] {
  const allowed = new Set<string>(INDIVIDUAL_CONTEXT_ORDER);
  for (const key of Object.keys(material)) {
    if (!allowed.has(key)) {
      throw new Error(`Material is not allowed in individual context: ${key}`);
    }
  }
  return selectSystemContextParts(INDIVIDUAL_CONTEXT_ORDER.map((key) => material[key]));
}

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
