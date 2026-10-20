const statusEl = document.getElementById("status");
const clipPageButton = document.getElementById("clip-page");
const clipSelectionButton = document.getElementById("clip-selection");
const openOptionsLink = document.getElementById("open-options");

function setStatus(message, busy = false) {
  statusEl.textContent = message;
  clipPageButton.disabled = busy;
  clipSelectionButton.disabled = busy;
}

async function loadLastStatus() {
  const stored = await chrome.storage.local.get("lastClipStatus");
  const last = stored.lastClipStatus;
  if (last?.message) {
    setStatus(last.message);
  }
}

async function runClip(selectionOnly) {
  setStatus(selectionOnly ? "正在剪藏选区…" : "正在剪藏页面…", true);
  const response = await chrome.runtime.sendMessage({
    type: "clip-active-tab",
    selectionOnly,
  });
  if (!response?.ok) {
    setStatus(response?.error || "剪藏失败");
    return;
  }
  const kb = response.response?.knowledgeBaseId;
  setStatus(kb ? `已保存到 ${kb}` : "已保存");
}

clipPageButton.addEventListener("click", () => void runClip(false));
clipSelectionButton.addEventListener("click", () => void runClip(true));
openOptionsLink.addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.runtime.openOptionsPage();
});

void loadLastStatus();
