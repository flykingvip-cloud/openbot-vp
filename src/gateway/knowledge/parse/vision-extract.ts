import { resolveAgentDir, resolveDefaultAgentId } from "../../../agents/agent-scope.js";
import { loadConfig, type OpenBotConfig } from "../../../config/config.js";
import { describeImageWithModel } from "../../../media-understanding/providers/image-runtime.js";
import { resolveAutoImageModel } from "../../../media-understanding/runner.js";
import { extractPdfContent } from "../../../media/pdf-extract.js";
import { assembleVisionPageTexts } from "./assemble.js";

const KNOWLEDGE_DOCUMENT_VISION_PROMPT = [
  "Extract this document page into Markdown for a knowledge base.",
  "Preserve headings, paragraphs, lists, tables (use HTML table when needed), and formulas (use LaTeX when possible).",
  "Remove page headers, footers, page numbers, and footnotes when they are layout noise.",
  "Follow human reading order. Return only the extracted content without preamble.",
].join(" ");

export async function extractPdfTextViaVision(params: {
  buffer: Buffer;
  fileName: string;
  maxPdfPages?: number;
  cfg?: OpenBotConfig;
}): Promise<string> {
  const cfg = params.cfg ?? loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const agentDir = resolveAgentDir(cfg, agentId);
  const activeModel = await resolveAutoImageModel({ cfg, agentDir });
  if (!activeModel?.provider || !activeModel.model) {
    throw new Error("未配置可用视觉模型，无法执行文档 OCR 解析");
  }

  const extracted = await extractPdfContent({
    buffer: params.buffer,
    maxPages: params.maxPdfPages ?? 200,
    maxPixels: 4_000_000,
    minTextChars: 1,
    extractPageImages: true,
  });

  if (extracted.images.length === 0) {
    return extracted.text.trim();
  }

  const pageTexts: string[] = [];
  for (let index = 0; index < extracted.images.length; index += 1) {
    const image = extracted.images[index];
    if (!image?.data) {
      continue;
    }
    const imageBuffer = Buffer.from(image.data, "base64");
    const result = await describeImageWithModel({
      buffer: imageBuffer,
      fileName: `${params.fileName.replace(/[^\w.-]+/g, "-")}-p${index + 1}.png`,
      mime: image.mimeType,
      provider: activeModel.provider,
      model: activeModel.model,
      prompt: KNOWLEDGE_DOCUMENT_VISION_PROMPT,
      maxTokens: 2000,
      timeoutMs: 90_000,
      agentDir,
      cfg,
    });
    const pageText = result.text.trim();
    if (pageText) {
      pageTexts.push(pageText);
    }
  }

  const assembled = assembleVisionPageTexts(pageTexts);
  return assembled || extracted.text.trim();
}
