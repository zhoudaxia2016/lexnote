// PDF Vocab — Side Panel

// ── Load ─────────────────────────────────────────────────────
async function load() {
  checkTokenStatus();
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
      showStatus(`测试成功! ${resp.word}: ${resp.meaning}`, "ok");
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
});

async function loadDebugInfo() {
  const stored = await chrome.storage.local.get(["debugLogs"]);
  const logs = stored.debugLogs || [];
  if (logs.length) {
    document.getElementById("debugLog").textContent = logs.join("\n");
  }
}

// ── Helpers ──────────────────────────────────────────────────
function getVal(id) { return document.getElementById(id)?.value || ""; }
function setVal(id, v) { const e = document.getElementById(id); if (e) e.value = v; }
function showStatus(msg, cls, id = "status") {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.className = `status ${cls}`; }
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
