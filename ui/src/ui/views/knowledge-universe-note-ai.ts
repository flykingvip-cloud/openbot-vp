import { extractJsonObject, requestLlmAssistantText } from "../controllers/llm-assist.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  extractNoteTitleFromContent,
  normalizeNoteTag,
  suggestNoteMetadataFromContent,
  suggestNoteTagsFromContent,
} from "./knowledge-universe-note-import.ts";

export type NoteMetadataSuggestion = {
  title: string;
  tags: string[];
  source: "llm" | "rules";
};

function buildNoteMetadataPrompt(content: string): string {
  return [
    "你是 OpenBot 知识库笔记助手。根据用户提供的摘录正文，提炼标题与标签。",
    "只输出 JSON，不要 Markdown 代码块。",
    'JSON 结构：{"title":"不超过48字的中文标题","tags":["标签1","标签2","标签3"]}',
    "",
    "要求：",
    "1. title 概括核心主题，≤48 字",
    "2. tags 2-3 个中文标签，每个 2-8 字，便于检索",
    "3. 只返回 JSON",
    "",
    "摘录正文：",
    content.slice(0, 8000),
  ].join("\n");
}

export function parseNoteMetadataJson(raw: string): { title: string; tags: string[] } | null {
  const json = extractJsonObject(raw);
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as { title?: unknown; tags?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const tagsRaw = Array.isArray(parsed.tags) ? parsed.tags : [];
    const tags = tagsRaw
      .map((item) => (typeof item === "string" ? normalizeNoteTag(item) : ""))
      .filter(Boolean)
      .filter(
        (tag, index, list) =>
          list.findIndex((entry) => entry.toLowerCase() === tag.toLowerCase()) === index,
      )
      .slice(0, 3);
    if (!title && tags.length === 0) {
      return null;
    }
    return {
      title: title || extractNoteTitleFromContent(json),
      tags: tags.length > 0 ? tags : suggestNoteTagsFromContent(json),
    };
  } catch {
    return null;
  }
}

export async function suggestNoteMetadataWithAi(params: {
  client: GatewayBrowserClient | null | undefined;
  sessionKey: string;
  content: string;
  timeoutMs?: number;
}): Promise<NoteMetadataSuggestion> {
  const rulesFallback = {
    ...suggestNoteMetadataFromContent(params.content),
    source: "rules" as const,
  };
  const client = params.client;
  const sessionKey = params.sessionKey.trim();
  if (!client || !sessionKey) {
    return rulesFallback;
  }
  const assistantText = await requestLlmAssistantText({
    client,
    sessionKey,
    prompt: buildNoteMetadataPrompt(params.content),
    timeoutMs: params.timeoutMs,
  });
  if (!assistantText) {
    return rulesFallback;
  }
  const parsed = parseNoteMetadataJson(assistantText);
  if (!parsed) {
    return rulesFallback;
  }
  return {
    title: parsed.title || rulesFallback.title,
    tags: parsed.tags.length > 0 ? parsed.tags : rulesFallback.tags,
    source: "llm",
  };
}
