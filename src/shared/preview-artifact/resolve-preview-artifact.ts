import { persistDeclaredWorkspaceLocator } from "../workspace-deliverable-path.ts";
import { buildArtifactIds, legacyHashPreviewText } from "./artifact-hash.ts";
import { canonicalizePreviewText } from "./canonicalize.ts";
import {
  extractDeliverableEnvelope,
  extractLocatedDeliverableEnvelopes,
} from "./deliverable-envelope.ts";
import { classifyArtifactDepositTier } from "./deposit-tier.ts";
import { extractGeneratedWorkspaceFilename } from "./generated-workspace-filename.ts";

function extractPreviewMessageText(message: Record<string, unknown>): string | null {
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  const content = message.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const textBlocks = content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return null;
      }
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string" ? item.text.trim() : null;
    })
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (textBlocks.length === 0) {
    return null;
  }
  return textBlocks.join(textBlocks.length > 1 ? "\n\n" : "\n");
}

function buildAssistantArtifactRecord(params: {
  title: string;
  sourceMessage: string;
  mimeType: string;
  createdAt: string;
  /** Declared published/external URL — set as a top-level openUrl for "open" affordances. */
  openUrl?: string;
  /**
   * Stable identity seed used only when the body is empty (a file/url declaration may carry
   * no summary text). Keeps distinct declared files from colliding on the empty-body hash while
   * leaving the common non-empty-body hash unchanged (server-side hash matching stays valid).
   */
  identitySeed?: string;
  providerMetadata: Record<string, unknown>;
}): Record<string, unknown> {
  const body = canonicalizePreviewText(params.sourceMessage);
  const identityBody = body || params.identitySeed || body;
  const ids = buildArtifactIds({
    body: identityBody,
    legacyTitle: params.title,
    legacySourceMessage: body
      ? params.sourceMessage
      : (params.identitySeed ?? params.sourceMessage),
  });
  const record = {
    artifactId: ids.artifactId,
    artifactType: params.mimeType.toLowerCase().startsWith("image/") ? "image" : "doc",
    storageClass: "inline-media",
    title: params.title,
    mimeType: params.mimeType,
    provider: "assistant-message",
    ...(params.openUrl ? { openUrl: params.openUrl } : {}),
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
    lifecycleState: "created",
    sourceMessage: body,
    providerMetadata: {
      ...params.providerMetadata,
      previewText: body,
      sourceFormat: params.mimeType,
      inferredFrom: "assistant-message",
      legacyArtifactId: ids.legacyArtifactId,
      artifactHash: ids.artifactHash,
      legacyArtifactHash: ids.legacyArtifactHash,
      depositTier: classifyArtifactDepositTier({
        provider: "assistant-message",
        providerMetadata: params.providerMetadata,
      }),
    },
  };
  return record;
}

function timestampToIso(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  return new Date().toISOString();
}

function cleanPreviewTitle(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/^#+\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/^[*_`~\s]+|[*_`~\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PREVIEW_LEAD_IN_RE =
  /^(?:以下是(?:完整)?正文|以下为(?:完整)?正文|以下是(?:文章)?全文|全文如下|正文如下|以下是完整文章|以下为完整文章|以下是完整稿件|以下为完整稿件)[:：]?$/;

function splitPreviewBlocks(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isPreviewDividerBlock(value: string) {
  const block = cleanPreviewTitle(value);
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(block);
}

function findNextPreviewContentBlock(blocks: string[], startIndex: number) {
  for (let index = startIndex + 1; index < blocks.length; index += 1) {
    const candidate = blocks[index] ?? "";
    if (!candidate || isPreviewDividerBlock(candidate)) {
      continue;
    }
    return candidate;
  }
  return "";
}

function isLikelyPlainDocumentTitle(value: string) {
  const title = cleanPreviewTitle(value);
  if (!title || title.includes("\n")) {
    return false;
  }
  if (title.length < 8 || title.length > 80) {
    return false;
  }
  if (/^(?:[-*#>]|(?:\d+[.、]))/.test(title)) {
    return false;
  }
  if (/(?:老大|我来|我先|说明|原因|可能的情况|我这边能确认|如果你觉得)/.test(title)) {
    return false;
  }
  if (/[。；]$/.test(title)) {
    return false;
  }
  return true;
}

function extractPreviewTitle(text: string) {
  const trimmed = text.trim();
  const blocks = splitPreviewBlocks(trimmed);
  const heading = /^(?:#{1,3}\s+|<h[1-3][^>]*>)(.+?)(?:<\/h[1-3]>)?\s*$/im.exec(trimmed);
  const quotedTitle = /《([^》]{4,80})》/.exec(trimmed);
  const cueIndex = blocks.findIndex((block) => PREVIEW_LEAD_IN_RE.test(cleanPreviewTitle(block)));
  const titleBlockAfterCue = cueIndex >= 0 ? findNextPreviewContentBlock(blocks, cueIndex) : "";
  const cueTitle =
    cueIndex >= 0 && isLikelyPlainDocumentTitle(titleBlockAfterCue)
      ? cleanPreviewTitle(titleBlockAfterCue)
      : "";
  const plainBlockTitle = blocks.find((block) => isLikelyPlainDocumentTitle(block)) ?? "";
  const firstLine = trimmed.split(/\r?\n/).find((line) => cleanPreviewTitle(line).length > 0);
  const title = cleanPreviewTitle(
    quotedTitle?.[1] ?? heading?.[1] ?? cueTitle ?? plainBlockTitle ?? firstLine ?? "",
  );
  return title ? title.slice(0, 80) : "对话生成文档";
}

function inferPreviewMimeType(text: string) {
  if (/```[a-z0-9_-]*\n[\s\S]+?```/i.test(text)) {
    return "text/x-code";
  }
  if (/<(?:article|section|h[1-6]|p|pre|code)\b/i.test(text)) {
    return "text/html";
  }
  if (/^#{1,6}\s+/m.test(text) || /\*\*[^*]+\*\*/.test(text) || /\|.+\|/m.test(text)) {
    return "text/markdown";
  }
  return "text/plain";
}

function inferPreviewMimeTypeFromFilename(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".doc") || lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return inferPreviewMimeType(filename);
}

function basenameFromPath(value: string) {
  return value.trim().split(/[\\/]/).filter(Boolean).at(-1);
}

function cleanDeliverableFilename(value: string) {
  return value
    .trim()
    .replace(/^📄\s*/, "")
    .replace(/^[`*_~\s]+|[`*_~\s]+$/g, "")
    .trim();
}

const DELIVERABLE_FILENAME_RE =
  /(?:^|[\s([`《])([^`\n\r<>[\]()《》]{2,120}\.(?:md|markdown|txt|docx?|pptx?|xlsx?|csv|pdf|html?|json|canvas))(?:$|[\s)\]`》.,，。:：])/gim;

function isMarkdownDividerLine(line: string) {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function isLikelyDocumentBodyStart(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /^#{1,6}\s+\S/.test(trimmed) ||
    /^\|.+\|$/.test(trimmed) ||
    /^\s*(?:\d+[.、)）]|[一二三四五六七八九十]+[、.．]|第[一二三四五六七八九十\d]+[章节篇])\s*\S/.test(
      trimmed,
    ) ||
    /^```[a-z0-9_-]*/i.test(trimmed)
  );
}

function isBoldSectionHeaderStart(line: string) {
  const trimmed = line.trim();
  return /^\*\*[^*\n]{2,48}\*\*(?:\s|$|[：:（(])/.test(trimmed);
}

function isConversationalLeadInLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 160) {
    return false;
  }
  const isNicknameStatusOpen =
    /^(?:老大|老板|亲|宝子|您好|你好|Hi|Hey|OK|好的|没问题|当然|收到)[，,：:\s]/i.test(trimmed) &&
    /(?:已经|已)(?:为|帮|给)?(?:您|你|咱)?(?:生成|完成|整理|做好|写好|输出|准备)|如下|请看|请查收|给您|帮你|弄好|搞定/.test(
      trimmed,
    );
  const isStatusNarration =
    /^(?:[\p{Extended_Pictographic}\uFE0F?\s])*(?:这是|以下为|下面是|以下是我|这是一个|这里(?:是|有))/u.test(
      trimmed,
    ) &&
    /(?:页面|文档|内容|版本|导图|报告|清单|草稿|成果|HTML|Markdown|PDF|PPT|文件)/i.test(trimmed);
  const isContentIntro =
    /内容包含[：:]?\s*$/.test(trimmed) ||
    /^(?:可交互|交互式)\s*(?:的?\s*)?(?:HTML|网页|页面)/i.test(trimmed);
  const isDoneAnnouncement =
    trimmed.length <= 96 &&
    /(?:已经|已)(?:为|帮|给)?(?:您|你|咱)?(?:生成|完成|整理|做好|写好|输出|准备)(?:好|完毕)?[！!。~]*$/.test(
      trimmed,
    );
  return isNicknameStatusOpen || isStatusNarration || isContentIntro || isDoneAnnouncement;
}

function stripLeadingConversationalLeadIn(value: string) {
  const lines = value.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim() || isMarkdownDividerLine(line)) {
      index += 1;
      continue;
    }
    if (isLikelyDocumentBodyStart(line) || isBoldSectionHeaderStart(line)) {
      break;
    }
    if (isConversationalLeadInLine(line)) {
      index += 1;
      continue;
    }
    break;
  }
  return lines.slice(index).join("\n").trim();
}

function trimDeliverablePreviewBody(value: string) {
  const lines = value.replace(/^\s*[:：,，。；;、-]*/, "").split(/\r?\n/);
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim() || isMarkdownDividerLine(line)) {
      continue;
    }
    if (isLikelyDocumentBodyStart(line)) {
      start = index;
      break;
    }
  }
  if (start < 0) {
    return "";
  }
  return stripTrailingArtifactMetaLines(
    stripTrailingConversationalBlocks(lines.slice(start).join("\n").trim()),
  );
}

function stripTrailingConversationalBlocks(value: string) {
  const blocks = value.split(/\n\s*\n/);
  while (blocks.length > 0) {
    const tail = blocks[blocks.length - 1]?.trim() ?? "";
    const cleanTail = cleanPreviewTitle(tail.replace(/^[-_*]{3,}\s*/gm, "").trim());
    if (!isConversationalFollowUpBlock(cleanTail)) {
      break;
    }
    blocks.pop();
    while (blocks.length > 0 && isPreviewDividerBlock(blocks[blocks.length - 1] ?? "")) {
      blocks.pop();
    }
  }
  return blocks.join("\n\n").trim();
}

function isConversationalFollowUpBlock(cleanTail: string) {
  if (!cleanTail) {
    return false;
  }
  const isQuestionPrompt =
    /(?:需要我|要不要我|是否需要|你需要的话|如果需要|我可以继续|可以继续|下一步我可以|是否要|您需要我|你要我|如果您需要).*?(?:吗|？|\?|即可|告诉我|随时说)/.test(
      cleanTail,
    ) ||
    /(?:怎么样|如何|觉得).{0,32}(?:吗|？|\?)/.test(cleanTail) ||
    /(?:够详细|可以吗|行不行|满意吗|还想看|还需要).*?(?:吗|？|\?)/.test(cleanTail);
  const isShortConversationalTail =
    cleanTail.length <= 220 &&
    /(?:进一步细化|权重评分|策略建议|矩阵|生成对应PPT|PPT页面|文字内容|继续生成|帮你生成|我再|知识导图|展开讲|某一部分|够详细|随时说|这份简报|更直观)/.test(
      cleanTail,
    );
  const isQuotedCasualClose =
    /^["“「']/.test(cleanTail) && /(?:随时说|告诉我|跟我说|还需要|展开|够详细)/.test(cleanTail);
  const isArtifactDeliveryMeta =
    /(?:文件位置|保存路径|输出路径|文件路径)[：:]/i.test(cleanTail) ||
    /(?:用浏览器打开|浏览器打开查看|打开查看交互|直接打开.*\.html)/i.test(cleanTail) ||
    /(?:在当前窗口继续|继续问我|随时问我|继续问)/.test(cleanTail) ||
    /[`'"]~\/[^`'"]+[`'"]/.test(cleanTail) ||
    /[`'"][^`'"]+\.(?:html|md|pdf|pptx?)[`'"]/i.test(cleanTail);
  return (
    isQuestionPrompt || isShortConversationalTail || isQuotedCasualClose || isArtifactDeliveryMeta
  );
}

function isArtifactMetaOrConversationalLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (isPreviewDividerBlock(trimmed)) {
    return true;
  }
  return isConversationalFollowUpBlock(cleanPreviewTitle(trimmed));
}

function stripTrailingArtifactMetaLines(value: string) {
  const lines = value.split(/\r?\n/);
  while (lines.length > 0) {
    const line = lines[lines.length - 1] ?? "";
    if (!isArtifactMetaOrConversationalLine(line)) {
      break;
    }
    lines.pop();
  }
  return lines.join("\n").trim();
}

/** Strip bot follow-up chatter from deliverable preview bodies shown in the artifact sidebar. */
export function sanitizeArtifactPreviewText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const envelope = extractDeliverableEnvelope(trimmed);
  const core = envelope ? envelope.body : trimmed;
  const withoutLeadIn = stripLeadingConversationalLeadIn(core);
  return stripTrailingArtifactMetaLines(stripTrailingConversationalBlocks(withoutLeadIn));
}

function extractEnvelopeDeliverablePreview(text: string): {
  title: string;
  mimeType: string;
  sourceMessage: string;
  envelopeKind: "tag" | "quoted";
  logicalId?: string;
  file?: string;
  url?: string;
  declaredType?: string;
} | null {
  const envelope = extractDeliverableEnvelope(text);
  if (!envelope) {
    return null;
  }
  const sourceMessage = envelope.body;
  const fileTitle = envelope.file ? basenameFromPath(envelope.file) : undefined;
  const title =
    envelope.title?.trim() ||
    fileTitle ||
    (sourceMessage ? extractPreviewTitle(sourceMessage) : "") ||
    "对话生成文档";
  // A declared file drives the mime type from its extension (a Word/PDF file, not the summary text).
  const mimeType = envelope.file
    ? inferPreviewMimeTypeFromFilename(envelope.file)
    : inferPreviewMimeType(sourceMessage);
  return {
    title,
    mimeType,
    sourceMessage,
    envelopeKind: envelope.kind,
    logicalId: envelope.logicalId,
    file: envelope.file,
    url: envelope.url,
    declaredType: envelope.type,
  };
}

function extractDeliverablePreview(text: string): {
  title: string;
  mimeType: string;
  sourceMessage: string;
} | null {
  let match: RegExpExecArray | null;
  let latest: { filename: string; endIndex: number } | null = null;
  DELIVERABLE_FILENAME_RE.lastIndex = 0;
  while ((match = DELIVERABLE_FILENAME_RE.exec(text))) {
    const filename = cleanDeliverableFilename(match[1] ?? "");
    if (!filename) {
      continue;
    }
    latest = {
      filename,
      endIndex: match.index + match[0].length,
    };
  }
  if (!latest) {
    return null;
  }
  const sourceMessage = trimDeliverablePreviewBody(text.slice(latest.endIndex));
  if (!sourceMessage || sourceMessage.length < 80) {
    return null;
  }
  return {
    title: latest.filename,
    mimeType: inferPreviewMimeTypeFromFilename(latest.filename),
    sourceMessage,
  };
}

const COMPLETE_FILE_LEAD_RE =
  /(?:以下是|以下为|这是|输出|发送)(?:完整的?)?\s*`?([^`\n\r]+?\.(?:md|markdown|txt|html?|json|csv))`?\s*(?:文件)?内容(?:（\s*\d+\s*行\s*）)?[:：]/i;

function stripCompleteFileWrapper(value: string) {
  let body = value.trim();
  body = body.replace(/^(?:-{3,}|\*{3,}|_{3,})\s*/m, "").trimStart();
  body = body.replace(/^```[a-z0-9_-]*\s*\n/i, "");
  body = body
    .replace(/\n\s*(?:-{3,}|\*{3,}|_{3,})\s*\n\s*以上就是完整[\s\S]*$/u, "")
    .replace(/\n\s*以上就是完整[\s\S]*$/u, "")
    .trim();
  return body;
}

function extractCompleteFilePreview(text: string): {
  title: string;
  mimeType: string;
  sourceMessage: string;
} | null {
  const match = COMPLETE_FILE_LEAD_RE.exec(text);
  const filename = cleanDeliverableFilename(match?.[1] ?? "");
  if (!match || !filename) {
    return null;
  }
  const sourceMessage = stripCompleteFileWrapper(text.slice(match.index + match[0].length));
  if (!sourceMessage || sourceMessage.length < 120) {
    return null;
  }
  return {
    title: basenameFromPath(filename) ?? filename,
    mimeType: inferPreviewMimeTypeFromFilename(filename),
    sourceMessage,
  };
}

function isFormalMarkdownDocumentStart(line: string) {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s+\S/.test(trimmed) || /^\|.+\|$/.test(trimmed) || /^```[a-z0-9_-]*/i.test(trimmed)
  );
}

function looksLikeConversationalPreviewPreamble(value: string) {
  return /(?:收到|找到文件|让我|我来|已完整解析|现在为您|帮你|完成啦|文件保存|文件保存在|PPT内容|这份PPT|这份文件)/.test(
    value,
  );
}

function extractInferredDocumentBodyPreview(text: string): {
  sourceMessage: string;
  inferredDocumentBody: boolean;
} | null {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!isFormalMarkdownDocumentStart(line)) {
      continue;
    }
    const prefix = lines.slice(0, index).join("\n").trim();
    if (!prefix || !looksLikeConversationalPreviewPreamble(prefix)) {
      continue;
    }
    const body = stripTrailingConversationalBlocks(lines.slice(index).join("\n").trim());
    if (body.length < 80 || !looksLikePreviewableText(body)) {
      continue;
    }
    return {
      sourceMessage: body,
      inferredDocumentBody: true,
    };
  }
  return null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function markdownSlidePreviews(value: string): Array<Record<string, unknown>> {
  const previews: Array<Record<string, unknown>> = [];
  const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(value))) {
    const imageUrl = match[2]?.trim();
    if (!imageUrl) {
      continue;
    }
    previews.push({
      slideNumber: previews.length + 1,
      title: match[1]?.trim() || `Slide ${previews.length + 1}`,
      imageUrl,
      alt: match[1]?.trim() || `Slide ${previews.length + 1}`,
    });
  }
  return previews;
}

function normalizeExplicitArtifactEvent(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  if (record.type !== "artifact") {
    return null;
  }
  const artifact =
    record.artifact && typeof record.artifact === "object" && !Array.isArray(record.artifact)
      ? (record.artifact as Record<string, unknown>)
      : null;
  if (!artifact) {
    return null;
  }
  const id = typeof artifact.id === "string" ? artifact.id.trim() : "";
  const artifactType =
    typeof artifact.artifact_type === "string" ? artifact.artifact_type.trim() : "";
  const title = typeof artifact.title === "string" ? artifact.title.trim() : "";
  const content = typeof artifact.content === "string" ? artifact.content.trim() : "";
  if (!id || !artifactType || !title) {
    return null;
  }
  const parsedContent = content ? parseJsonRecord(content) : null;
  const slidePreviews =
    artifactType === "ppt"
      ? (Array.isArray(parsedContent?.slidePreviews) && parsedContent.slidePreviews) ||
        (Array.isArray(parsedContent?.slides) && parsedContent.slides) ||
        (Array.isArray(parsedContent?.slideImages) && parsedContent.slideImages) ||
        (Array.isArray(parsedContent?.pptPreviewImages) && parsedContent.pptPreviewImages) ||
        markdownSlidePreviews(content)
      : [];
  const pptxPath =
    typeof parsedContent?.pptxPath === "string"
      ? parsedContent.pptxPath.trim()
      : typeof parsedContent?.filePath === "string"
        ? parsedContent.filePath.trim()
        : "";
  const previewUrl =
    typeof parsedContent?.previewUrl === "string" ? parsedContent.previewUrl.trim() : "";
  const sourceMessage =
    typeof parsedContent?.markdownPreview === "string"
      ? parsedContent.markdownPreview.trim()
      : typeof parsedContent?.previewText === "string"
        ? parsedContent.previewText.trim()
        : content;
  const createdAt = new Date().toISOString();
  return {
    artifactId: id,
    artifactType:
      artifactType === "ppt" ? "slide" : artifactType === "markdown" ? "doc" : artifactType,
    storageClass: "inline-media",
    title,
    mimeType:
      artifactType === "ppt"
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : artifactType === "markdown"
          ? "text/markdown"
          : "text/plain",
    provider: "artifact-event",
    ...(previewUrl ? { previewUrl } : {}),
    createdAt,
    updatedAt: createdAt,
    lifecycleState: "created",
    sourceMessage,
    providerMetadata: {
      previewText: sourceMessage,
      sourceFormat: artifactType,
      inferredFrom: "artifact-event",
      ...(slidePreviews.length > 0 ? { slidePreviews } : {}),
      ...(pptxPath
        ? {
            pptxPath,
            ...(() => {
              const locator = persistDeclaredWorkspaceLocator(pptxPath);
              return locator
                ? {
                    workspaceFilename: locator,
                    previewKind: "file" as const,
                    deliverableTarget: {
                      kind: "file" as const,
                      workspaceFilename: locator,
                      mimeType:
                        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                      title,
                    },
                  }
                : { previewKind: "file" as const };
            })(),
          }
        : {}),
    },
  };
}

function normalizeWriteToolArtifact(
  record: Record<string, unknown>,
): Record<string, unknown> | null {
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
  if (role !== "assistant" || !Array.isArray(record.content)) {
    return null;
  }
  for (const item of [...record.content].toReversed()) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const part = item as Record<string, unknown>;
    const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
    const name = typeof part.name === "string" ? part.name.toLowerCase() : "";
    if (type !== "toolcall" || name !== "write") {
      continue;
    }
    const args =
      part.arguments && typeof part.arguments === "object" && !Array.isArray(part.arguments)
        ? (part.arguments as Record<string, unknown>)
        : null;
    const path = typeof args?.path === "string" ? args.path.trim() : "";
    const content = typeof args?.content === "string" ? args.content.trim() : "";
    const title = basenameFromPath(path) ?? path;
    if (!path || !title || content.length < 120) {
      continue;
    }
    const createdAt = timestampToIso(record.timestamp);
    const mimeType = inferPreviewMimeTypeFromFilename(title);
    return {
      artifactId: `tool-write:${legacyHashPreviewText(`${path}\n${content}`)}`,
      artifactType: "doc",
      storageClass: "inline-media",
      title,
      mimeType,
      provider: "tool-write",
      providerResourceId: path,
      createdAt,
      updatedAt: createdAt,
      lifecycleState: "created",
      sourceMessage: content,
      providerMetadata: {
        previewText: content,
        sourceFormat: mimeType,
        filePath: path,
        inferredFrom: "write-tool",
      },
    };
  }
  return null;
}

function looksLikePreviewableText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 120) {
    return false;
  }
  const deliverySummaryPattern =
    /(?:任务完成总结|完整交付物|配图生成完毕|草稿箱已更新|去草稿箱看看效果吧|已成功插入|后台["“”][^"“”]+["“”]|封面图\s*[+＋]\s*配图)/;
  const isLikelyDeliverySummary =
    deliverySummaryPattern.test(trimmed) &&
    !/(?:以下是(?:完整)?正文|以下为(?:完整)?正文|以下是(?:文章)?全文|全文如下|正文如下)/.test(
      trimmed,
    );
  const isFileMismatchDiagnostic =
    /(?:您实际看到的是|你实际看到的是).{0,40}(?:附件文件|短附件|摘要)|(?:不是真正的|而不是(?:真正的)?).{0,40}(?:ASSET\.md|文件)|系统显示错了版本/.test(
      trimmed,
    );
  if (isLikelyDeliverySummary || isFileMismatchDiagnostic) {
    return false;
  }
  const blocks = splitPreviewBlocks(trimmed);
  const markdownHeadingCount = (trimmed.match(/^#{1,6}\s+\S+/gm) ?? []).length;
  const numberedListCount = (trimmed.match(/^\s*\d+[.、]\s+\S/gm) ?? []).length;
  const bulletListCount = (trimmed.match(/^\s*[-*]\s+\S/gm) ?? []).length;
  const htmlBlockCount = (trimmed.match(/<(?:article|section|h[1-6]|p|pre|code)\b/gi) ?? []).length;
  const hasCodeBlock = /```[a-z0-9_-]*\n[\s\S]{80,}?```/i.test(trimmed);
  const hasDocumentTitle = /^#{1,3}\s+.+/m.test(trimmed) || /《[^》]{4,80}》/.test(trimmed);
  const leadingText = trimmed.slice(0, 160);
  const leadingWindow = trimmed.slice(0, 400);
  const longBlockCount = blocks.filter((block) => block.length >= 40).length;
  const hasDocumentCue =
    /(?:报告|周报|方案|纪要|总结|文档|草稿|文章|稿件|白皮书|手册|指南|PPT|幻灯片|演示稿)/.test(
      leadingText,
    );
  const hasArticleDraftCue =
    /(?:完整正文|完整文章|全文如下|以下是.+全文|以下是.+正文|文章如下|正文如下|为你起草|起草完整文章|全稿如下|公众号文章)/.test(
      leadingWindow,
    );
  const hasExplicitFileEnvelope = /(?:文件位置|文件路径|保存为|输出为|文件名)/.test(trimmed);
  const mentionsSupportedFileExtension =
    /(?:\.md\b|\.txt\b|\.html?\b|\.docx?\b|\.pptx?\b|\.xlsx?\b|\.csv\b|```(?:ts|tsx|js|jsx|json|py|java|go|rs|sh|sql|html|css|md)\b)/i.test(
      trimmed,
    );
  const paragraphBreakCount = (trimmed.match(/\n\s*\n/g) ?? []).length;
  const cueIndex = blocks.findIndex((block) => PREVIEW_LEAD_IN_RE.test(cleanPreviewTitle(block)));
  const hasLeadInCue = cueIndex >= 0;
  const titleBlockAfterCue = hasLeadInCue ? findNextPreviewContentBlock(blocks, cueIndex) : "";
  const hasPlainTitleAfterCue = hasLeadInCue && isLikelyPlainDocumentTitle(titleBlockAfterCue);
  const hasStrongDocumentStructure =
    (hasDocumentTitle && markdownHeadingCount >= 2 && paragraphBreakCount >= 2) ||
    (hasDocumentTitle && hasArticleDraftCue && longBlockCount >= 3 && trimmed.length >= 280) ||
    (hasLeadInCue && hasPlainTitleAfterCue && longBlockCount >= 3 && paragraphBreakCount >= 3) ||
    (hasDocumentCue && markdownHeadingCount >= 1 && paragraphBreakCount >= 3) ||
    (hasDocumentCue &&
      (numberedListCount >= 4 || bulletListCount >= 5) &&
      paragraphBreakCount >= 2);
  const hasStructuredFileOutput =
    (hasExplicitFileEnvelope ||
      hasCodeBlock ||
      (hasDocumentTitle && mentionsSupportedFileExtension)) &&
    (hasCodeBlock ||
      markdownHeadingCount >= 1 ||
      numberedListCount >= 3 ||
      bulletListCount >= 4 ||
      paragraphBreakCount >= 2);
  return (
    htmlBlockCount >= 3 || hasCodeBlock || hasStrongDocumentStructure || hasStructuredFileOutput
  );
}

function extractPreviewSourceText(message: Record<string, unknown>) {
  const content = message.content;
  if (Array.isArray(content)) {
    const textBlocks = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return null;
        }
        const item = part as Record<string, unknown>;
        return item.type === "text" && typeof item.text === "string" ? item.text.trim() : null;
      })
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (textBlocks.length > 1) {
      return textBlocks.join("\n\n");
    }
  }
  return extractPreviewMessageText(message);
}

function isDeclaredStructuredArtifact(artifact: Record<string, unknown>): boolean {
  const meta = artifact.providerMetadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const record = meta as Record<string, unknown>;
    if (record.declared === true || record.deliverableEnvelope === true) {
      return true;
    }
  }
  return false;
}

function collectExplicitArtifacts(record: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (Array.isArray(record.artifacts)) {
    for (const entry of record.artifacts) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        out.push(entry as Record<string, unknown>);
      }
    }
  }
  if (
    out.length === 0 &&
    record.artifact &&
    typeof record.artifact === "object" &&
    !Array.isArray(record.artifact)
  ) {
    out.push(record.artifact as Record<string, unknown>);
  }
  return out;
}

function buildEnvelopeArtifactFromPreview(
  record: Record<string, unknown>,
  envelopePreview: NonNullable<ReturnType<typeof extractEnvelopeDeliverablePreview>>,
): Record<string, unknown> {
  const createdAt = timestampToIso(record.timestamp);
  const previewKind = envelopePreview.file ? "file" : envelopePreview.url ? "published" : "text";
  return buildAssistantArtifactRecord({
    title: envelopePreview.title,
    sourceMessage: envelopePreview.sourceMessage,
    mimeType: envelopePreview.mimeType,
    createdAt,
    openUrl: envelopePreview.url,
    identitySeed: envelopePreview.logicalId
      ? `logical:${envelopePreview.logicalId}`
      : envelopePreview.file
        ? `file:${envelopePreview.file}`
        : envelopePreview.url
          ? `url:${envelopePreview.url}`
          : undefined,
    providerMetadata: {
      deliverableEnvelope: true,
      declared: true,
      envelopeKind: envelopePreview.envelopeKind,
      previewKind,
      ...(envelopePreview.logicalId ? { logicalId: envelopePreview.logicalId } : {}),
      ...(envelopePreview.declaredType ? { declaredType: envelopePreview.declaredType } : {}),
      ...(envelopePreview.file ? { workspaceFilename: envelopePreview.file } : {}),
      ...(envelopePreview.url ? { openUrl: envelopePreview.url } : {}),
    },
  });
}

/** All first-class deliverable targets in a message (one chip per located envelope). */
export function resolvePreviewArtifactRecords(message: unknown): Record<string, unknown>[] {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return [];
  }
  const record = message as Record<string, unknown>;
  // Cron task results should stay in the chat lane, not open as generated doc previews.
  if (record.openclawCronResult && typeof record.openclawCronResult === "object") {
    return [];
  }
  const explicitEventArtifact = normalizeExplicitArtifactEvent(record);
  if (explicitEventArtifact) {
    return [explicitEventArtifact];
  }
  const writeToolArtifact = normalizeWriteToolArtifact(record);
  if (writeToolArtifact) {
    return [writeToolArtifact];
  }

  // Prefer structured declared artifacts already materialized before display strip.
  const explicitArtifacts = collectExplicitArtifacts(record);
  const declaredExplicit = explicitArtifacts.filter(isDeclaredStructuredArtifact);
  if (declaredExplicit.length > 0) {
    return declaredExplicit;
  }
  const explicitArtifact = explicitArtifacts[0] ?? null;
  const explicitProvider =
    explicitArtifact && typeof explicitArtifact.provider === "string"
      ? explicitArtifact.provider.trim()
      : "";
  const shouldRevalidateExplicitArtifact = explicitProvider === "assistant-message";
  if (explicitArtifact && !shouldRevalidateExplicitArtifact) {
    return [explicitArtifact];
  }

  const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
  if (role !== "assistant") {
    return explicitArtifact && !shouldRevalidateExplicitArtifact ? [explicitArtifact] : [];
  }
  const extractedText = extractPreviewSourceText(record);
  if (typeof extractedText !== "string") {
    return [];
  }
  const text = extractedText.trim();
  const located = extractLocatedDeliverableEnvelopes(text);
  if (located.length > 0) {
    const built: Record<string, unknown>[] = [];
    for (const envelope of located) {
      const sourceMessage = envelope.body;
      const fileTitle = envelope.file ? basenameFromPath(envelope.file) : undefined;
      const title =
        envelope.title?.trim() ||
        fileTitle ||
        (sourceMessage ? extractPreviewTitle(sourceMessage) : "") ||
        "对话生成文档";
      const mimeType = envelope.file
        ? inferPreviewMimeTypeFromFilename(envelope.file)
        : inferPreviewMimeType(sourceMessage);
      const previewKind = envelope.file ? "file" : envelope.url ? "published" : "text";
      built.push(
        buildAssistantArtifactRecord({
          title,
          sourceMessage,
          mimeType,
          createdAt: timestampToIso(record.timestamp),
          openUrl: envelope.url,
          identitySeed: envelope.logicalId
            ? `logical:${envelope.logicalId}`
            : envelope.file
              ? `file:${envelope.file}`
              : envelope.url
                ? `url:${envelope.url}`
                : undefined,
          providerMetadata: {
            deliverableEnvelope: true,
            declared: true,
            envelopeKind: envelope.kind,
            previewKind,
            ...(envelope.logicalId ? { logicalId: envelope.logicalId } : {}),
            ...(envelope.type ? { declaredType: envelope.type } : {}),
            ...(envelope.file ? { workspaceFilename: envelope.file } : {}),
            ...(envelope.url ? { openUrl: envelope.url } : {}),
          },
        }),
      );
    }
    return built;
  }
  const envelopePreview = extractEnvelopeDeliverablePreview(text);
  if (envelopePreview) {
    return [buildEnvelopeArtifactFromPreview(record, envelopePreview)];
  }
  const completeFilePreview = extractCompleteFilePreview(text);
  const workspaceFilename = extractGeneratedWorkspaceFilename(text);
  // A concise, explicit generated-file announcement is itself a preview signal. Requiring a
  // 120-character document body here hid real file deliverables such as `output/report.html`.
  if (!completeFilePreview && !workspaceFilename && !looksLikePreviewableText(text)) {
    return [];
  }
  const createdAt = timestampToIso(record.timestamp);
  const deliverablePreview = completeFilePreview ?? extractDeliverablePreview(text);
  const inferredDocumentBody = deliverablePreview ? null : extractInferredDocumentBodyPreview(text);
  const rawSource =
    deliverablePreview?.sourceMessage ?? inferredDocumentBody?.sourceMessage ?? text;
  const sourceMessage = sanitizeArtifactPreviewText(rawSource);
  const title =
    deliverablePreview?.title ??
    (workspaceFilename ? basenameFromPath(workspaceFilename) : undefined) ??
    extractPreviewTitle(sourceMessage);
  const mimeType =
    deliverablePreview?.mimeType ??
    (workspaceFilename
      ? inferPreviewMimeTypeFromFilename(workspaceFilename)
      : inferPreviewMimeType(sourceMessage));
  return [
    buildAssistantArtifactRecord({
      title,
      sourceMessage,
      mimeType,
      createdAt,
      providerMetadata: {
        ...(deliverablePreview ? { inferredDeliverable: true } : {}),
        ...(inferredDocumentBody?.inferredDocumentBody ? { inferredDocumentBody: true } : {}),
        // Prose-announced file (no declaration envelope): carry the filename so preview can still
        // open the real workspace file, but keep it flagged as an inferred (low-tier) signal.
        ...(workspaceFilename
          ? { workspaceFilename, previewKind: "file", inferredFile: true }
          : {}),
      },
    }),
  ];
}

export function resolvePreviewArtifactRecord(message: unknown): Record<string, unknown> | null {
  return resolvePreviewArtifactRecords(message)[0] ?? null;
}

export function withGeneratedPreviewArtifact(message: Record<string, unknown>) {
  const artifacts = resolvePreviewArtifactRecords(message);
  const artifact = artifacts[0];
  if (!artifact || message.artifact === artifact) {
    return message;
  }
  if (
    message.artifact &&
    typeof message.artifact === "object" &&
    isDeclaredStructuredArtifact(message.artifact as Record<string, unknown>)
  ) {
    return message;
  }
  if (message.artifact && typeof message.artifact === "object" && artifacts.length === 0) {
    return message;
  }
  return {
    ...message,
    artifact,
    ...(artifacts.length > 1 ? { artifacts } : {}),
  };
}
