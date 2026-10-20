function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeEmailLocalPart(value: string) {
  const localPart = value.split("@")[0] ?? "";
  return collapseWhitespace(localPart.replace(/[._-]+/g, " "));
}

export function formatWorkbenchSidebarDisplayName(value: string | null | undefined, fallback = "") {
  const normalized = collapseWhitespace(value ?? "");
  if (!normalized) {
    return fallback;
  }
  if (normalized.includes("@")) {
    const emailLabel = normalizeEmailLocalPart(normalized);
    return emailLabel || fallback || normalized;
  }
  return normalized;
}
