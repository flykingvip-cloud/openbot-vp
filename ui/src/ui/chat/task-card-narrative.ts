export type TaskNarrativeSection = {
  type: string;
  lines: string[];
};

export type TaskNarrativeSummaryInput = {
  sections: TaskNarrativeSection[];
};

function firstNonEmptyLine(section: TaskNarrativeSection | undefined): string | null {
  if (!section) {
    return null;
  }
  for (const line of section.lines) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

export function resolveTaskNarrativeSummary(input: TaskNarrativeSummaryInput): string {
  const next = firstNonEmptyLine(input.sections.find((section) => section.type === "next"));
  if (next) {
    return next;
  }
  const understanding = firstNonEmptyLine(
    input.sections.find((section) => section.type === "understanding"),
  );
  if (understanding) {
    return understanding;
  }
  for (const section of input.sections) {
    const line = firstNonEmptyLine(section);
    if (line) {
      return line;
    }
  }
  return "";
}
