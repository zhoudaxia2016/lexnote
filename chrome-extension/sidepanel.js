// PDF Vocab — Side Panel

// ── Load ─────────────────────────────────────────────────────
async function load() {
  checkTokenStatus();
  loadPanelToast();
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
      const text = formatResultMessage(resp, "测试成功");
      showPanelToast(text, "ok");
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
  if (msg.type === "panel-toast") showPanelToast(msg.text, msg.toastType || "");
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
  if (Date.now() - (stored.panelToast.ts || 0) > 5000) return;
  showPanelToast(stored.panelToast.text, stored.panelToast.type || "");
}

// ── Helpers ──────────────────────────────────────────────────
function getVal(id) { return document.getElementById(id)?.value || ""; }
function setVal(id, v) { const e = document.getElementById(id); if (e) e.value = v; }
function showStatus(msg, cls, id = "status") {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.className = `status ${cls}`; }
}

function formatResultMessage(result, prefix = "✅") {
  const parts = [`${prefix} ${result.word || ""}: ${result.meaning || ""}`.trim()];
  if (result.category) parts.push(`[${result.category}]`);
  if (result.note) parts.push(`- ${result.note}`);
  return parts.join(" ").trim();
}

let panelToastTimer = null;

function ensurePanelToastEl() {
  let el = document.getElementById("panelToast");
  if (el) return el;

  el = document.createElement("div");
  el.id = "panelToast";
  el.style.cssText = [
    "position:fixed",
    "top:12px",
    "left:12px",
    "right:12px",
    "padding:10px 12px",
    "border-radius:8px",
    "font-size:12px",
    "line-height:1.4",
    "color:#fff",
    "box-shadow:0 8px 24px rgba(0,0,0,0.18)",
    "z-index:9999",
    "opacity:0",
    "transform:translateY(-6px)",
    "transition:opacity 160ms ease, transform 160ms ease",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

function showPanelToast(msg, type) {
  const el = ensurePanelToastEl();
  const bg = type === "ok" ? "#2a8c4a" : type === "err" ? "#c92a2a" : "#555";
  el.textContent = msg;
  el.style.background = bg;
  el.style.opacity = "1";
  el.style.transform = "translateY(0)";
  showStatus(msg, type || "");

  if (panelToastTimer) clearTimeout(panelToastTimer);
  panelToastTimer = setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-6px)";
  }, 2600);
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
