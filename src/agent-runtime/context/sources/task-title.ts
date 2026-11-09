import { stripInboundStamp } from "../../policy/index.js";
const DECORATIVE_TITLE_LINE = /^(?:[「」『』【】（）()[\]"'“”‘’*#\-_—…·`\s])+$/u;

function normalizeTitleLine(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^\*+\s*|\s*\*+$/g, "")
    .replace(/^[「『【]\s*|\s*[」』】]$/g, "")
    .trim();
}

export function titleFromGoal(text: string): string {
  const cleaned = stripInboundStamp(text);
  const first = cleaned
    .split(/\r?\n/)
    .map((line) => normalizeTitleLine(line))
    .find(
      (line) =>
        line &&
        !line.startsWith("[") &&
        !DECORATIVE_TITLE_LINE.test(line) &&
        !line.startsWith("任务目标"),
    );
  const compactTitle = (first ?? normalizeTitleLine(cleaned.replace(/\s+/g, " ")))
    .replace(/\s+/g, " ")
    .trim();
  return compactTitle.length > 36 ? `${compactTitle.slice(0, 36)}…` : compactTitle;
}
