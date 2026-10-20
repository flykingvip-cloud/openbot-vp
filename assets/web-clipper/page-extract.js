const MAX_CLIP_CHARS = 500_000;

export function extractPageClip(tab) {
  const title = tab.title?.trim() || tab.url || "Untitled";
  const url = tab.url?.trim() || "";
  return {
    title,
    url,
    text: "",
    usedSelection: false,
  };
}

export function buildClipPayloadFromTabCapture(capture, settings) {
  const text = capture.text?.trim() || "";
  if (!text) {
    throw new Error("No text to clip on this page");
  }
  if (text.length > MAX_CLIP_CHARS) {
    throw new Error("Selection is too large to clip");
  }
  const payload = {
    url: capture.url,
    title: capture.title,
    text,
    tags: Array.isArray(settings.tags)
      ? settings.tags.filter((entry) => typeof entry === "string" && entry.trim())
      : [],
  };
  const kbId = settings.knowledgeBaseId?.trim();
  if (kbId) {
    payload.knowledgeBaseId = kbId;
  }
  return payload;
}
