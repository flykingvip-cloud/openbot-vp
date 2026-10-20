/**
 * Parses steward meeting-tool minute inputs into the shape `validateMinutesDraft`
 * accepts. The model may pass a JSON array or one action item per line
 * (`title @ assigneeUserId @ ISO-due`). Assignee ids are not authorized here —
 * fan-out drops anyone outside the meeting roster.
 */

export type ParsedActionItem = {
  title: string;
  assigneeUserId?: string;
  dueAt?: string;
};

export function parseDecisionList(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  return raw
    .split(/\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseActionItemLine(line: string): ParsedActionItem {
  const parts = line.split(/\s+@\s+/).map((part) => part.trim());
  const title = parts[0] ?? "";
  const assigneeUserId = parts[1];
  const dueAt = parts[2];
  return {
    title,
    ...(assigneeUserId ? { assigneeUserId } : {}),
    ...(dueAt ? { dueAt } : {}),
  };
}

/** Accepts a JSON array/object or newline-separated `title @ user @ due` lines. */
export function parseActionItemsParam(raw: string | undefined): {
  items: ParsedActionItem[];
  error?: string;
} {
  if (!raw?.trim()) {
    return { items: [] };
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const items: ParsedActionItem[] = [];
      for (const entry of list) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return { items: [], error: "actionItems JSON entries must be objects" };
        }
        const record = entry as Record<string, unknown>;
        const title = typeof record.title === "string" ? record.title.trim() : "";
        const assigneeUserId =
          typeof record.assigneeUserId === "string" ? record.assigneeUserId.trim() : "";
        const dueAt = typeof record.dueAt === "string" ? record.dueAt.trim() : "";
        items.push({
          title,
          ...(assigneeUserId ? { assigneeUserId } : {}),
          ...(dueAt ? { dueAt } : {}),
        });
      }
      return { items };
    } catch {
      return { items: [], error: "actionItems JSON was not valid" };
    }
  }
  const items = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseActionItemLine);
  return { items };
}
