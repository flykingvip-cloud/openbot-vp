import {
  fetchWebPageForKnowledge,
  htmlToPlainText,
  type WebPageFetcher,
} from "./personal-knowledge-ingest.js";

export const WEB_CLIP_MAX_BYTES = 2_000_000;

export type WebClipContentSource = "client-text" | "client-html" | "server-fetch";

export type ResolveWebClipContentInput = {
  url: string;
  title?: string;
  text?: string;
  html?: string;
  fetcher?: WebPageFetcher;
};

export type ResolveWebClipContentResult = {
  title?: string;
  text: string;
  source: WebClipContentSource;
};

function trimClipField(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveWebClipContent(
  input: ResolveWebClipContentInput,
): Promise<ResolveWebClipContentResult> {
  const explicitTitle = trimClipField(input.title);
  const clientText = trimClipField(input.text);
  if (clientText) {
    if (clientText.length > WEB_CLIP_MAX_BYTES) {
      throw new Error("web clip text exceeds size limit");
    }
    return {
      title: explicitTitle,
      text: clientText,
      source: "client-text",
    };
  }

  const clientHtml = trimClipField(input.html);
  if (clientHtml) {
    const bounded = clientHtml.slice(0, WEB_CLIP_MAX_BYTES);
    const text = htmlToPlainText(bounded);
    if (!text) {
      throw new Error("web clip html had no extractable text");
    }
    return {
      title: explicitTitle,
      text,
      source: "client-html",
    };
  }

  const fetched = await fetchWebPageForKnowledge({
    url: input.url.trim(),
    fetcher: input.fetcher,
  });
  const text = fetched.text.trim();
  if (!text) {
    throw new Error("web page had no extractable text");
  }
  return {
    title: explicitTitle || trimClipField(fetched.title),
    text,
    source: "server-fetch",
  };
}
