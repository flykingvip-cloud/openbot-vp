import { OpenBotGatewayClient, collectWebClip, listKnowledgeBases } from "./gateway-client.js";
import { buildClipPayloadFromTabCapture } from "./page-extract.js";

const DEFAULT_GATEWAY_WS = "ws://127.0.0.1:18789";
const MENU_PAGE_ID = "openbot-clip-page";
const MENU_SELECTION_ID = "openbot-clip-selection";
const MAX_CLIP_CHARS = 500_000;

/** Injected into the active tab — must stay self-contained (no imports). */
function extractClipInPage() {
  const selection = String(window.getSelection?.()?.toString() ?? "").trim();
  const title = document.title?.trim() || location.href;
  const url = location.href;
  let text = selection;
  let usedSelection = Boolean(text);
  if (!text) {
    const article = document.querySelector("article");
    const root = article ?? document.body;
    text = root?.innerText?.trim() ?? "";
    usedSelection = false;
  }
  if (text.length > MAX_CLIP_CHARS) {
    text = `${text.slice(0, MAX_CLIP_CHARS)}…`;
  }
  return { title, url, text, usedSelection };
}

async function readSettings() {
  const stored = await chrome.storage.sync.get([
    "gatewayWsUrl",
    "gatewayToken",
    "knowledgeBaseId",
    "tags",
  ]);
  return {
    gatewayWsUrl: stored.gatewayWsUrl?.trim() || DEFAULT_GATEWAY_WS,
    gatewayToken: stored.gatewayToken?.trim() || "",
    knowledgeBaseId: stored.knowledgeBaseId?.trim() || "",
    tags: Array.isArray(stored.tags)
      ? stored.tags.filter((entry) => typeof entry === "string")
      : [],
  };
}

async function writeStatus(message, level = "info") {
  await chrome.storage.local.set({
    lastClipStatus: { message, level, at: Date.now() },
  });
}

function notify(title, message) {
  chrome.notifications.create(`openbot-clip-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

async function captureActiveTab(clipSelectionOnly = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error("Open an http(s) page before clipping");
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractClipInPage,
  });
  if (!result?.text?.trim()) {
    throw new Error("No extractable text on this page");
  }
  if (clipSelectionOnly && !result.usedSelection) {
    throw new Error("Select text on the page first");
  }
  return result;
}

async function clipActiveTab(options = {}) {
  const settings = await readSettings();
  if (!settings.gatewayToken) {
    throw new Error("Set your Gateway token in extension options");
  }
  const capture = await captureActiveTab(Boolean(options.selectionOnly));
  const payload = buildClipPayloadFromTabCapture(capture, settings);
  const client = new OpenBotGatewayClient({
    url: settings.gatewayWsUrl,
    token: settings.gatewayToken,
  });
  try {
    const response = await collectWebClip(client, payload);
    const kbLabel = response?.knowledgeBaseId ? ` → ${response.knowledgeBaseId}` : "";
    const message = `Saved${kbLabel}`;
    await writeStatus(message, "success");
    notify("Clipped to OpenBot", message);
    return response;
  } finally {
    client.close();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PAGE_ID,
      title: "Clip page to OpenBot",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_SELECTION_ID,
      title: "Clip selection to OpenBot",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  try {
    await clipActiveTab({ selectionOnly: info.menuItemId === MENU_SELECTION_ID });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStatus(message, "error");
    notify("OpenBot clip failed", message);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "clip-active-tab") {
    clipActiveTab({ selectionOnly: Boolean(message.selectionOnly) })
      .then((response) => sendResponse({ ok: true, response }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  }
  if (message?.type === "list-knowledge-bases") {
    (async () => {
      const settings = await readSettings();
      if (!settings.gatewayToken) {
        sendResponse({ ok: false, error: "Gateway token not configured" });
        return;
      }
      const client = new OpenBotGatewayClient({
        url: settings.gatewayWsUrl,
        token: settings.gatewayToken,
      });
      try {
        const knowledgeBases = await listKnowledgeBases(client);
        sendResponse({ ok: true, knowledgeBases });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        client.close();
      }
    })();
    return true;
  }
  return false;
});
