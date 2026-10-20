const form = document.getElementById("options-form");
const gatewayWsInput = document.getElementById("gateway-ws");
const gatewayTokenInput = document.getElementById("gateway-token");
const knowledgeBaseSelect = document.getElementById("knowledge-base");
const tagsInput = document.getElementById("tags");
const refreshButton = document.getElementById("refresh-kbs");
const statusEl = document.getElementById("status");

function setStatus(message, ok = true) {
  statusEl.textContent = message;
  statusEl.className = `status ${ok ? "ok" : "err"}`;
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get([
    "gatewayWsUrl",
    "gatewayToken",
    "knowledgeBaseId",
    "tags",
  ]);
  gatewayWsInput.value = stored.gatewayWsUrl || "ws://127.0.0.1:18789";
  gatewayTokenInput.value = stored.gatewayToken || "";
  tagsInput.value = Array.isArray(stored.tags) ? stored.tags.join(", ") : "";
  await refreshKnowledgeBases(stored.knowledgeBaseId || "");
}

function parseTags(raw) {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function refreshKnowledgeBases(selectedId = "") {
  const response = await chrome.runtime.sendMessage({ type: "list-knowledge-bases" });
  if (!response?.ok) {
    setStatus(response?.error || "无法加载知识空间列表", false);
    return;
  }
  const current = knowledgeBaseSelect.value || selectedId;
  knowledgeBaseSelect.innerHTML = '<option value="">（自动 / 个人收件箱）</option>';
  for (const kb of response.knowledgeBases) {
    const option = document.createElement("option");
    option.value = kb.id;
    option.textContent = kb.title?.trim() || kb.id;
    knowledgeBaseSelect.appendChild(option);
  }
  if (current) {
    knowledgeBaseSelect.value = current;
  }
  setStatus(`已加载 ${response.knowledgeBases.length} 个知识空间`);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await chrome.storage.sync.set({
    gatewayWsUrl: gatewayWsInput.value.trim() || "ws://127.0.0.1:18789",
    gatewayToken: gatewayTokenInput.value.trim(),
    knowledgeBaseId: knowledgeBaseSelect.value.trim(),
    tags: parseTags(tagsInput.value),
  });
  setStatus("设置已保存");
});

refreshButton.addEventListener("click", () => {
  void refreshKnowledgeBases(knowledgeBaseSelect.value);
});

void loadSettings();
