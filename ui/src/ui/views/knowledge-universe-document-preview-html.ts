const PREVIEW_STYLE_MARK = "data-openbot-doc-preview";

const DOCUMENT_PREVIEW_STYLE = `<style ${PREVIEW_STYLE_MARK}>
html,body{margin:0;padding:20px 24px;background:#fff;color:#1b1b1b;
font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Noto Sans SC",sans-serif}
p,h1,h2,h3,h4,h5,li{overflow-wrap:anywhere}
table{border-collapse:collapse;table-layout:auto;width:max-content !important;max-width:none !important;margin:0.8em 0}
td,th{word-break:normal !important;overflow-wrap:break-word;white-space:normal;vertical-align:top;
border:1px solid #d8d8d8;padding:6px 10px}
img,svg,video,canvas{max-width:100%;height:auto}
</style>`;

/** Wrap mammoth/Office HTML in an isolated document so workbench CSS cannot crush tables. */
export function wrapKnowledgeDocumentPreviewHtml(html: string): string {
  const source = html.trim();
  if (!source) {
    return "";
  }
  if (new RegExp(PREVIEW_STYLE_MARK, "i").test(source) && /<html[\s>]/i.test(source)) {
    return source;
  }
  if (/<\/head>/i.test(source)) {
    return source.replace(/<\/head>/i, `${DOCUMENT_PREVIEW_STYLE}</head>`);
  }
  if (/<html\b[^>]*>/i.test(source)) {
    return source.replace(/<html\b[^>]*>/i, (open) => `${open}${DOCUMENT_PREVIEW_STYLE}`);
  }
  if (/<body\b[^>]*>/i.test(source)) {
    return source.replace(/<body\b[^>]*>/i, (open) => `${open}${DOCUMENT_PREVIEW_STYLE}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${DOCUMENT_PREVIEW_STYLE}</head><body>${source}</body></html>`;
}

let cachedHtml = "";
let cachedUrl = "";

export function resolveKnowledgeDocumentPreviewFrame(html: string): {
  src?: string;
  srcdoc?: string;
} {
  const wrapped = wrapKnowledgeDocumentPreviewHtml(html);
  if (!wrapped) {
    return {};
  }
  if (
    typeof URL !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL.createObjectURL === "function"
  ) {
    try {
      if (cachedHtml === wrapped && cachedUrl) {
        return { src: cachedUrl };
      }
      if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl);
      }
      cachedHtml = wrapped;
      cachedUrl = URL.createObjectURL(new Blob([wrapped], { type: "text/html;charset=utf-8" }));
      return { src: cachedUrl };
    } catch {
      // Fall through to srcdoc for test / restricted environments.
    }
  }
  return { srcdoc: wrapped };
}
