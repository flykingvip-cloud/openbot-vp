export const WEB_URL_IMPORT_MAX_LINKS = 20;

export type WebUrlImportMode = "batch" | "sitemap" | "crawl";

export type WebUrlSyncSchedule = "once" | "daily" | "weekly";

const HTTP_URL_PATTERN = /^https?:\/\//i;

export function isValidWebImportUrl(value: string): boolean {
  return HTTP_URL_PATTERN.test(value.trim());
}

export function parseWebImportUrlLines(
  text: string,
  maxLinks = WEB_URL_IMPORT_MAX_LINKS,
): {
  urls: string[];
  invalidLines: string[];
  totalNonEmptyLines: number;
  truncated: boolean;
} {
  const lines = text.split(/\r?\n/);
  const urls: string[] = [];
  const invalidLines: string[] = [];
  let totalNonEmptyLines = 0;
  let truncated = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    totalNonEmptyLines += 1;
    if (urls.length >= maxLinks) {
      truncated = true;
      continue;
    }
    if (isValidWebImportUrl(line)) {
      urls.push(line);
    } else {
      invalidLines.push(line);
    }
  }
  return { urls, invalidLines, totalNonEmptyLines, truncated };
}

export function countWebImportUrlLines(text: string): number {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

export function webUrlSyncScheduleToIntervalMs(schedule: WebUrlSyncSchedule): number | null {
  if (schedule === "daily") {
    return 24 * 60 * 60 * 1000;
  }
  if (schedule === "weekly") {
    return 7 * 24 * 60 * 60 * 1000;
  }
  return null;
}

export function createEmptyWebUrlImportState() {
  return {
    libraryWorkspaceUrlImportMode: "batch" as WebUrlImportMode,
    libraryWorkspaceUrlImportText: "",
    libraryWorkspaceUrlImportAdvancedOpen: false,
    libraryWorkspaceUrlSyncSchedule: "once" as WebUrlSyncSchedule,
    libraryWorkspaceUrlStripNavAds: true,
    libraryWorkspaceUrlMainContentOnly: false,
  };
}
