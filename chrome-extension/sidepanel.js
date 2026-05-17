// PDF Vocab — Side Panel

// ── Load ─────────────────────────────────────────────────────
async function load() {
  checkTokenStatus();
  loadPanelToast();
  updateSpeakButton("");
}

// ── Token status ─────────────────────────────────────────────
async function checkTokenStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "proxy-token-status" });
    const badge = document.getElementById("tokenBadge");
    if (resp && resp.hasToken) {
      badge.textContent = `已授权 (${Math.round((resp.expiresIn || 0) / 60)}min)`;
      badge.className = "token-badge ok";
    } else {
      badge.textContent = "未授权";
      badge.className = "token-badge err";
    }
  } catch {
    document.getElementById("tokenBadge").textContent = "代理未启动";
    document.getElementById("tokenBadge").className = "token-badge err";
  }
}

// ── Auth ─────────────────────────────────────────────────────
async function startAuth() {
  showStatus("正在授权...", "", "authStatus");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "proxy-auth" });
    if (resp && resp.ok) {
      showStatus("授权成功 ✅", "ok", "authStatus");
      checkTokenStatus();
    } else {
      showStatus(`授权失败: ${resp?.error || "未知错误"}`, "err", "authStatus");
    }
  } catch (err) {
    showStatus(`授权失败: ${err.message}`, "err", "authStatus");
  }
}

// ── Save ─────────────────────────────────────────────────────
async function saveSettings() {
  // No config to save currently; placeholder for future settings
  showStatus("已保存 ✓", "ok");
}

// ── Test ─────────────────────────────────────────────────────
async function testAdd() {
  showStatus("测试中...", "");
  // No config to save currently
  try {
    const resp = await chrome.runtime.sendMessage({ type: "test-add", word: "recurrence" });
    if (resp && resp.ok) {
      const record = buildRecord(resp);
      const text = formatResultMessage(record, "测试成功");
      applyPanelUpdate(text, "ok", record);
      debugLog(text);
    } else if (resp && resp.needAuth) {
      showStatus("Token 过期，请点击 WPS 授权登录", "err");
    } else {
      showStatus(`测试失败: ${resp?.error || "未知错误"}`, "err");
    }
  } catch (err) {
    showStatus(`错误: ${err.message}`, "err");
  }
}

// ── Debug ────────────────────────────────────────────────────
function debugLog(msg) {
  const el = document.getElementById("debugLog");
  if (!el) return;
  el.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
  el.scrollTop = el.scrollHeight;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "debug") debugLog(msg.text);
  if (msg.type === "panel-toast") applyPanelUpdate(msg.text, msg.toastType || "", msg.record || null);
});

async function loadDebugInfo() {
  const stored = await chrome.storage.local.get(["debugLogs"]);
  const logs = stored.debugLogs || [];
  if (logs.length) {
    document.getElementById("debugLog").textContent = logs.join("\n");
  }
}

async function loadPanelToast() {
  const stored = await chrome.storage.local.get(["panelToast"]);
  if (!stored.panelToast?.text) return;
  if (stored.panelToast.record) renderWordRecord(stored.panelToast.record);
  if ((stored.panelToast.type || "") === "err") {
    showStatus(stored.panelToast.text, stored.panelToast.type || "");
  } else {
    showStatus("", "");
  }
}

// ── Helpers ──────────────────────────────────────────────────
function getVal(id) { return document.getElementById(id)?.value || ""; }
function setVal(id, v) { const e = document.getElementById(id); if (e) e.value = v; }
function showStatus(msg, cls, id = "status") {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.className = `status ${cls}`; }
}

function buildRecord(result) {
  return {
    word: result.word || "",
    meaning: result.meaning || "",
    category: result.category || "",
    note: result.note || "",
    saveStatus: result.saveStatus || "",
    saveError: result.saveError || "",
  };
}

let currentSpokenWord = "";

function formatResultMessage(record, prefix = "✅") {
  const parts = [`${prefix} ${record.word || ""}: ${record.meaning || ""}`.trim()];
  if (record.category) parts.push(`[${record.category}]`);
  if (record.note) parts.push(`- ${record.note}`);
  return parts.join(" ").trim();
}

function renderWordRecord(record) {
  const el = document.getElementById("wordRecord");
  if (!el) return;
  if (!record || (!record.word && !record.meaning && !record.category && !record.note && !record.saveError)) {
    el.textContent = "";
    el.className = "word-record";
    updateSpeakButton("");
    return;
  }
  currentRecord = record;

  const isSaveFailed = record.saveStatus === "save_failed";
  el.className = isSaveFailed ? "word-record word-record-error" : "word-record";
  updateSpeakButton(record.word || "");

  const rows = [
    record.word ? { label: "单词", value: record.word, valueClass: "" } : null,
    record.meaning ? { label: "意思", value: record.meaning, valueClass: "" } : null,
    record.category ? { label: "分类", value: record.category, valueClass: "" } : null,
    record.note ? { label: "note", value: record.note, valueClass: "record-value-note" } : null,
    isSaveFailed && record.saveError ? { label: "原因", value: record.saveError, valueClass: "record-value-error" } : null,
  ].filter(Boolean);

  el.innerHTML = buildRecordTitle() + rows.map((row) => `
    <div class="record-row">
      <span class="record-label">${row.label}</span>
      <span class="record-value ${row.valueClass}">${escapeHtml(row.value)}</span>
    </div>
  `).join("");
  bindSpeakButton();
}

function buildRecordTitle() {
  const badge = getSaveBadge(currentRecord);
  return `
    <div class="record-title">
      <span class="record-title-text">翻译</span>
      <div class="record-title-meta">
        ${badge}
        <button id="speakWordBtn" class="speak-btn" type="button">朗读</button>
      </div>
    </div>
  `;
}

let currentRecord = null;

function getSaveBadge(record) {
  if (!record?.saveStatus) return "";
  if (record.saveStatus === "created") return `<span class="save-badge save-badge-created">已新增</span>`;
  if (record.saveStatus === "exists") return `<span class="save-badge save-badge-exists">已存在</span>`;
  if (record.saveStatus === "save_failed") return `<span class="save-badge save-badge-failed">写入失败</span>`;
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function applyPanelUpdate(msg, type, record = null) {
  if ((type || "") === "err") showStatus(msg, type || "");
  else showStatus("", "");
  if (record) {
    currentRecord = record;
    renderWordRecord(record);
  }
}

function updateSpeakButton(word) {
  currentSpokenWord = String(word || "").trim();
  const btn = document.getElementById("speakWordBtn");
  if (!btn) return;
  btn.disabled = !currentSpokenWord;
}

function bindSpeakButton() {
  const btn = document.getElementById("speakWordBtn");
  if (!btn) return;
  btn.disabled = !currentSpokenWord;
  btn.onclick = () => speakCurrentWord();
}

function speakCurrentWord() {
  if (!currentSpokenWord || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(currentSpokenWord);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  load();
  loadDebugInfo();
  document.getElementById("saveBtn").addEventListener("click", saveSettings);
  document.getElementById("testBtn").addEventListener("click", testAdd);
  document.getElementById("authBtn").addEventListener("click", startAuth);
  document.getElementById("clearLogBtn").addEventListener("click", () => {
    document.getElementById("debugLog").textContent = "";
  });
  document.getElementById("copyLogBtn").addEventListener("click", () => {
    const el = document.getElementById("debugLog");
    navigator.clipboard.writeText(el.textContent).then(() => showStatus("已复制 ✓", "ok"));
  });
});
