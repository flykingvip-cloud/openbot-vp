import type { OpenBotConfig } from "../../config/config.js";
import { extractOfficeOpenXmlText } from "../../media/input-files.js";
import { extractPdfContent } from "../../media/pdf-extract.js";
import { cleanKnowledgeDocumentText } from "./content-clean.js";
import {
  computeRawContentHash,
  computeSemanticContentHash,
  type ContentVersionDelta,
  classifyContentVersionDelta,
} from "./document-fingerprint.js";
import {
  extractObsidianExplicitMetadata,
  type ObsidianExplicitMetadata,
} from "./document-obsidian-extract.js";
import { pdfNeedsVisionOcr } from "./parse/detect.js";
import { extractPdfTextViaVision } from "./parse/vision-extract.js";

export type KnowledgeDocumentFormat =
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "markdown"
  | "text"
  | "unsupported";

export type KnowledgeDocumentParserEngine = "local" | "platform_vlm";

export type ExtractedKnowledgeDocument = {
  fileName: string;
  mimeType: string;
  format: KnowledgeDocumentFormat;
  text: string;
  cleanedText: string;
  rawHash: string;
  semanticHash: string;
  /** PDF 解析路径：local pdfjs 或 platform_vlm 视觉 OCR。 */
  parserEngine?: KnowledgeDocumentParserEngine;
  /** P2: Obsidian-style explicit signals (markdown/text only). */
  explicit?: ObsidianExplicitMetadata;
};

export type ExtractKnowledgeDocumentParams = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  maxPdfPages?: number;
  ocrEnabled?: boolean;
  cfg?: OpenBotConfig;
};

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".csv"]);

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function looksLikeZipContainer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function detectFormat(fileName: string, mimeType: string, buffer: Buffer): KnowledgeDocumentFormat {
  const extension = extensionOf(fileName);
  if (extension === ".pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx";
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return "xlsx";
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return "pptx";
  }
  if (looksLikeZipContainer(buffer)) {
    if (extension === ".docx") {
      return "docx";
    }
    if (extension === ".xlsx") {
      return "xlsx";
    }
    if (extension === ".pptx") {
      return "pptx";
    }
  }
  if (
    TEXT_EXTENSIONS.has(extension) ||
    mimeType.startsWith("text/") ||
    mimeType === "text/markdown"
  ) {
    return extension === ".md" || extension === ".markdown" || mimeType.includes("markdown")
      ? "markdown"
      : "text";
  }
  return "unsupported";
}

export async function extractKnowledgeDocument(
  params: ExtractKnowledgeDocumentParams,
): Promise<ExtractedKnowledgeDocument> {
  const format = detectFormat(params.fileName, params.mimeType, params.buffer);
  const rawHash = computeRawContentHash(params.buffer);

  if (format === "unsupported") {
    const empty = "";
    return {
      fileName: params.fileName,
      mimeType: params.mimeType,
      format,
      text: empty,
      cleanedText: empty,
      rawHash,
      semanticHash: computeSemanticContentHash(empty),
    };
  }

  let text = "";
  let parserEngine: KnowledgeDocumentParserEngine | undefined;
  if (format === "pdf") {
    const extracted = await extractPdfContent({
      buffer: params.buffer,
      maxPages: params.maxPdfPages ?? 200,
      maxPixels: 4_000_000,
      minTextChars: 1,
      extractPageImages: false,
    });
    text = extracted.text;
    parserEngine = "local";
    if (pdfNeedsVisionOcr(text, params.ocrEnabled)) {
      text = await extractPdfTextViaVision({
        buffer: params.buffer,
        fileName: params.fileName,
        maxPdfPages: params.maxPdfPages,
        cfg: params.cfg,
      });
      parserEngine = "platform_vlm";
    }
  } else if (format === "docx") {
    text = await extractOfficeOpenXmlText(
      params.buffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  } else if (format === "xlsx") {
    text = await extractOfficeOpenXmlText(
      params.buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  } else if (format === "pptx") {
    text = await extractOfficeOpenXmlText(
      params.buffer,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  } else {
    text = params.buffer.toString("utf8");
  }

  const cleanedText = cleanKnowledgeDocumentText(text);
  const explicit =
    format === "markdown" || format === "text" ? extractObsidianExplicitMetadata(text) : undefined;
  return {
    fileName: params.fileName,
    mimeType: params.mimeType,
    format,
    text,
    cleanedText,
    rawHash,
    semanticHash: computeSemanticContentHash(text),
    ...(parserEngine ? { parserEngine } : {}),
    ...(explicit &&
    (explicit.wikilinks.length > 0 ||
      explicit.tags.length > 0 ||
      Object.keys(explicit.frontmatter).length > 0)
      ? { explicit }
      : {}),
  };
}

export function planKnowledgeDocumentVersionDelta(params: {
  existingRawHash: string | null;
  existingSemanticHash: string | null;
  extracted: ExtractedKnowledgeDocument;
}): ContentVersionDelta {
  return classifyContentVersionDelta({
    existingRawHash: params.existingRawHash,
    existingSemanticHash: params.existingSemanticHash,
    nextRawHash: params.extracted.rawHash,
    nextSemanticHash: params.extracted.semanticHash,
  });
}

export { classifyContentVersionDelta, cleanKnowledgeDocumentText };
