const PROXY = "http://localhost:21987";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "add-vocab", title: "添加到生词表", contexts: ["selection"] });
});

function debug(msg) {
  console.log("[Vocab]", msg);
  chrome.storage.local.get(["debugLogs"], (s) => {
    const logs = s.debugLogs || [];
    logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (logs.length > 50) logs.shift();
    chrome.storage.local.set({ debugLogs: logs });
  });
  chrome.runtime.sendMessage({ type: "debug", text: msg }).catch(() => {});
}

async function showToast(tabId, text, type) {
  const color = type === "ok" ? "#2a8c4a" : "err" ? "#c92a2a" : "#555";
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, bg) => {
        const el = document.createElement("div");
        el.textContent = msg;
        el.style.cssText = `position:fixed;top:16px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:10px 20px;border-radius:6px;font-size:14px;z-index:2147483647;pointer-events:none;transition:opacity 0.5s;box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
        document.body.appendChild(el);
        setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 500); }, 2500);
      },
      args: [text, color],
    });
  } catch (_) {}
}

async function proxyPost(endpoint, body) {
  const resp = await fetch(`${PROXY}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return resp.json();
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "add-vocab" || !info.selectionText) return;
  const word = info.selectionText.trim();
  if (!word) return;
  debug(`📖 "${word}"`);
  try {
    const result = await proxyPost("/api/vocab", { word, chapter: "", page: "" });
    if (result.needAuth) {
      showToast(tab.id, "❌ Token 过期，请在侧边栏重新授权", "err");
      return;
    }
    if (!result.ok) throw new Error(result.error);
    const text = `✅ ${result.word || word}: ${result.meaning} [${result.category}]`;
    showToast(tab.id, text, "ok");
    debug(`✅ ${text}`);
  } catch (err) {
    debug(`❌ ${err.message}`);
    showToast(tab.id, `❌ ${err.message.substring(0, 40)}`, "err");
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "proxy-auth") {
    fetch(`${PROXY}/api/auth-url`).then(r => r.json()).then(({ url }) => {
      if (url) { chrome.tabs.create({ url }); sendResponse({ ok: true }); }
      else sendResponse({ ok: false, error: "No URL" });
    }).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "proxy-token-status") {
    fetch(`${PROXY}/api/token-status`).then(r => r.json()).then(sendResponse).catch(() => sendResponse({ hasToken: false }));
    return true;
  }
  if (msg.type === "test-add") {
    proxyPost("/api/vocab", { word: msg.word || "recurrence", chapter: "", page: "" })
      .then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
