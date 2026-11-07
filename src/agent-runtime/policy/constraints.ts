import type { ConstraintEntry, ConstraintEntryInput } from "../contracts/task.js";

export function normalizeConstraintEntries(
  raw: ConstraintEntryInput[] | undefined,
): ConstraintEntry[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  const out: ConstraintEntry[] = [];
  for (const row of raw) {
    if (typeof row === "string") {
      const text = row.replace(/\s+/g, " ").trim();
      if (!text) {
        continue;
      }
      out.push({ text, atMs: 0, kind: "supplement" });
      continue;
    }
    if (!row || typeof row !== "object") {
      continue;
    }
    const text = String(row.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      continue;
    }
    out.push({
      text,
      atMs: typeof row.atMs === "number" ? row.atMs : 0,
      kind: row.kind === "revise" ? "revise" : "supplement",
      ...(row.superseded ? { superseded: true } : {}),
    });
  }
  return out;
}
