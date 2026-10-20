import { chunkMarkdown, hashText } from "../../../memory/internal.js";

export type HierarchicalChunk = {
  text: string;
  heading: string | null;
  section: string | null;
  startLine: number;
  endLine: number;
  hash: string;
};

export type HierarchicalChunking = {
  tokens: number;
  overlap: number;
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

type ParsedLine = { lineNo: number; text: string };

type SectionDraft = {
  heading: string | null;
  section: string | null;
  lines: ParsedLine[];
};

function parseLines(content: string): ParsedLine[] {
  return content.split("\n").map((text, index) => ({ lineNo: index + 1, text }));
}

function chunkSectionBody(params: {
  section: SectionDraft;
  chunking: HierarchicalChunking;
}): HierarchicalChunk[] {
  const nonEmptyLines = params.section.lines.filter((line) => line.text.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    return [];
  }

  const bodyText = nonEmptyLines.map((line) => line.text).join("\n");
  const maxChars = Math.max(32, params.chunking.tokens * 4);
  const lineOffset = nonEmptyLines[0].lineNo - 1;

  if (bodyText.length <= maxChars) {
    const text = bodyText.trim();
    return [
      {
        text,
        heading: params.section.heading,
        section: params.section.section,
        startLine: nonEmptyLines[0].lineNo,
        endLine: nonEmptyLines[nonEmptyLines.length - 1].lineNo,
        hash: hashText(text),
      },
    ];
  }

  const subChunks = chunkMarkdown(bodyText, params.chunking).filter(
    (chunk) => chunk.text.trim().length > 0,
  );
  return subChunks.map((chunk) => ({
    text: chunk.text,
    heading: params.section.heading,
    section: params.section.section,
    startLine: chunk.startLine + lineOffset,
    endLine: chunk.endLine + lineOffset,
    hash: chunk.hash,
  }));
}

function flushSection(section: SectionDraft, chunking: HierarchicalChunking): HierarchicalChunk[] {
  return chunkSectionBody({ section, chunking });
}

export function chunkHierarchicalDocument(
  content: string,
  chunking: HierarchicalChunking,
): HierarchicalChunk[] {
  const lines = parseLines(content);
  if (lines.length === 0) {
    return [];
  }

  const hasHeading = lines.some((line) => HEADING_RE.test(line.text));
  if (!hasHeading) {
    return chunkSectionBody({
      section: { heading: null, section: null, lines },
      chunking,
    });
  }

  const headingStack: Array<{ level: number; text: string }> = [];
  const sections: SectionDraft[] = [];
  let current: SectionDraft = { heading: null, section: null, lines: [] };

  const pushCurrent = () => {
    if (current.lines.length === 0) {
      return;
    }
    sections.push(current);
    current = { heading: current.heading, section: current.section, lines: [] };
  };

  for (const line of lines) {
    const match = line.text.match(HEADING_RE);
    if (!match) {
      current.lines.push(line);
      continue;
    }

    pushCurrent();

    const level = match[1].length;
    const title = match[2].trim();
    while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
      headingStack.pop();
    }
    headingStack.push({ level, text: title });

    const top = headingStack[0]?.text ?? title;
    const leaf = headingStack[headingStack.length - 1]?.text ?? title;
    current = {
      heading: top,
      section: leaf,
      lines: [line],
    };
  }

  pushCurrent();

  const chunks: HierarchicalChunk[] = [];
  for (const section of sections) {
    chunks.push(...flushSection(section, chunking));
  }
  return chunks;
}
