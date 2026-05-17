const PROXY = "http://localhost:21987";
const DEFAULT_RULES = {
  hideBelow: "B1",
  collectAtOrAbove: "C1",
  mustCollectCategories: ["数学术语"],
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "add-vocab", title: "翻译", contexts: ["selection"] });
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

function isPdfPageUrl(rawUrl) {
  if (!rawUrl) return false;
  const text = String(rawUrl).toLowerCase();
  return text.endsWith(".pdf") || text.includes(".pdf?") || text.includes(".pdf#");
}

function shouldUsePanelToast(info, tab) {
  const urls = [info?.pageUrl, info?.frameUrl, tab?.url].filter(Boolean);
  return urls.some((url) => url.startsWith("chrome-extension://") || isPdfPageUrl(url));
}

function normalizeText(value, maxLen = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function buildSelectionPayload(selectionText) {
  const rawText = String(selectionText || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  const normalizedText = rawText
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return {
    rawText,
    normalizedText: normalizeText(normalizedText, 1200),
  };
}

function buildRecord(result, fallbackText) {
  return {
    selection: fallbackText || "",
    translation: result.translation || "",
    items: Array.isArray(result.items) ? result.items : [],
    summary: result.summary || { created: 0, exists: 0, failed: 0 },
    rules: result.rules || DEFAULT_RULES,
  };
}

function buildErrorRecord(selection, errorText) {
  return {
    selection: selection || "",
    translation: "",
    items: [],
    summary: { created: 0, exists: 0, failed: 1 },
    error: errorText || "",
  };
}

function recalcSummary(items) {
  return {
    created: items.filter((item) => item.saveStatus === "created").length,
    exists: items.filter((item) => item.saveStatus === "exists").length,
    failed: items.filter((item) => item.saveStatus === "save_failed").length,
  };
}

function formatSuccessMessage(record) {
  const parts = [];
  if (record.summary?.created) parts.push(`已新增 ${record.summary.created}`);
  if (record.summary?.exists) parts.push(`已存在 ${record.summary.exists}`);
  if (record.summary?.failed) parts.push(`失败 ${record.summary.failed}`);
  if (!parts.length) parts.push("已分析");
  return normalizeText(parts.join(" "), 500);
}

async function getRules() {
  const stored = await chrome.storage.local.get(["translationRules"]);
  return { ...DEFAULT_RULES, ...(stored.translationRules || {}) };
}

function getSourceLabel(tab, info) {
  const title = normalizeText(tab?.title || "", 120);
  if (title) return title;

  const url = info?.pageUrl || info?.frameUrl || tab?.url || "";
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const rawName = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return normalizeText(decodeURIComponent(rawName), 120);
  } catch {
    return normalizeText(url, 120);
  }
}

function buildSourcePayload(info, tab) {
  const source = getSourceLabel(tab, info);
  const sourceUrl = normalizeText(info?.pageUrl || info?.frameUrl || tab?.url || "", 500);

  return {
    sourceTitle: source,
    sourceUrl,
  };
}

async function showPanelToast(text, type, record = null) {
  await chrome.storage.local.set({
    panelToast: {
      text,
      type,
      record,
      ts: Date.now(),
    },
  });
  chrome.runtime.sendMessage({ type: "panel-toast", text, toastType: type, record }).catch(() => {});
}

async function showToast(tabId, text, type) {
  const color = type === "ok" ? "#2a8c4a" : type === "err" ? "#c92a2a" : "#555";
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
  } catch (err) {
    debug(`ℹ️ 页面 Toast 注入失败: ${err.message}`);
    await showPanelToast(text, type);
  }
}

async function proxyPost(endpoint, body) {
  const resp = await fetch(`${PROXY}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (resp.status === 404 && endpoint === "/api/collect-item") {
      throw new Error("代理未重启，收录接口不可用");
    }
    throw new Error(text || `HTTP ${resp.status}`);
  }
  if (!resp.ok && data?.error) throw new Error(data.error);
  return data;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "add-vocab" || !info.selectionText) return;
  const selectionPayload = buildSelectionPayload(info.selectionText);
  if (!selectionPayload.rawText) return;
  const usePanelToast = shouldUsePanelToast(info, tab);
  const sourcePayload = buildSourcePayload(info, tab);
  const rules = await getRules();
  debug(`📖 "${selectionPayload.rawText}"`);
  try {
    const result = await proxyPost("/api/vocab", { ...selectionPayload, ...sourcePayload, rules });
    if (result.needAuth) {
      const authErrorRecord = buildErrorRecord(selectionPayload.rawText, "Token 过期，请重新授权");
      if (usePanelToast) await showPanelToast(
        "❌ Token 过期，请在侧边栏重新授权",
        "err",
        authErrorRecord
      );
      else {
        await showPanelToast("❌ Token 过期，请在侧边栏重新授权", "err", authErrorRecord);
        await showToast(tab.id, "❌ Token 过期，请在侧边栏重新授权", "err");
      }
      return;
    }
    if (!result.ok) throw new Error(result.error);
    const record = buildRecord(result, selectionPayload.rawText);
    const toastType = record.summary?.failed ? "err" : "ok";
    const text = formatSuccessMessage(record);
    if (usePanelToast) await showPanelToast(text, toastType, record);
    else {
      await showPanelToast(text, toastType, record);
      await showToast(tab.id, text, "ok");
    }
    debug(`✅ ${text} · ${record.items.length} 项`);
  } catch (err) {
    debug(`❌ ${err.message}`);
    const text = `❌ ${err.message.substring(0, 40)}`;
    const errorRecord = buildErrorRecord(selectionPayload.rawText, err.message);
    if (usePanelToast) await showPanelToast(text, "err", errorRecord);
    else {
      await showPanelToast(text, "err", errorRecord);
      await showToast(tab.id, text, "err");
    }
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
  if (msg.type === "proxy-meta") {
    fetch(`${PROXY}/api/meta`).then(r => r.json()).then(sendResponse).catch((e) => sendResponse({
      categories: ["数学术语", "描述词", "连接词"],
      levels: ["A1", "A2", "B1", "B2", "C1", "C2"],
      defaultRules: DEFAULT_RULES,
      error: e.message,
    }));
    return true;
  }
  if (msg.type === "test-add") {
    const rules = { ...DEFAULT_RULES, ...(msg.rules || {}) };
    proxyPost("/api/vocab", {
      rawText: msg.text || "recurrence",
      normalizedText: msg.text || "recurrence",
      sourceTitle: "Concrete Mathematics",
      sourceUrl: "test://concrete-mathematics",
      rules,
    })
      .then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "collect-item") {
    proxyPost("/api/collect-item", { item: msg.item, context: msg.context || "" })
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, saveStatus: "save_failed", saveError: e.message, error: e.message }));
    return true;
  }
  if (msg.type === "update-panel-record") {
    const items = Array.isArray(msg.record?.items) ? msg.record.items : [];
    const record = {
      ...(msg.record || {}),
      summary: recalcSummary(items),
    };
    showPanelToast(formatSuccessMessage(record), record.summary?.failed ? "err" : "ok", record)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
