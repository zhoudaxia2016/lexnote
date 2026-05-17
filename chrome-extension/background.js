const PROXY = "http://localhost:21987";

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

function buildWordPayload(selectionText) {
  const rawWord = normalizeText(selectionText, 200);
  let candidateWord = rawWord
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, "$1$2")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const hasLetters = /[A-Za-z]/.test(candidateWord);
  const isAllUpper = hasLetters && candidateWord === candidateWord.toUpperCase() && candidateWord !== candidateWord.toLowerCase();
  const isLikelyAcronym = isAllUpper && /^[A-Z0-9-]{2,8}$/.test(candidateWord);
  const isTitleCase = /^[A-Z][a-z]+(?:[-'][A-Za-z]+)?$/.test(candidateWord);

  if (!isLikelyAcronym && (isTitleCase || isAllUpper)) {
    candidateWord = candidateWord.toLowerCase();
  }

  return {
    rawWord,
    candidateWord: normalizeText(candidateWord, 200),
  };
}

function buildRecord(result, fallbackWord) {
  return {
    word: result.word || fallbackWord || "",
    meaning: result.meaning || "",
    category: result.category || "",
    note: result.note || "",
    saveStatus: result.saveStatus || "",
    saveError: result.saveError || "",
  };
}

function buildErrorRecord(word, errorText) {
  return {
    word: word || "",
    meaning: "",
    category: "错误",
    note: errorText || "",
  };
}

function formatSuccessMessage(record) {
  const parts = [`✅ ${record.word || ""}: ${record.meaning || ""}`];
  if (record.category) parts.push(`[${record.category}]`);
  if (record.note) parts.push(`- ${record.note}`);
  return normalizeText(parts.join(" "), 500);
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
  } catch (err) {
    debug(`ℹ️ 页面 Toast 注入失败: ${err.message}`);
    await showPanelToast(text, type);
  }
}

async function proxyPost(endpoint, body) {
  const resp = await fetch(`${PROXY}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return resp.json();
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "add-vocab" || !info.selectionText) return;
  const wordPayload = buildWordPayload(info.selectionText);
  if (!wordPayload.rawWord) return;
  const usePanelToast = shouldUsePanelToast(info, tab);
  const sourcePayload = buildSourcePayload(info, tab);
  debug(`📖 "${wordPayload.rawWord}" → "${wordPayload.candidateWord}"`);
  try {
    const result = await proxyPost("/api/vocab", { ...wordPayload, ...sourcePayload });
    if (result.needAuth) {
      const authErrorRecord = buildErrorRecord(wordPayload.rawWord, "Token 过期，请重新授权");
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
    const record = buildRecord(result, wordPayload.rawWord);
    const toastType = record.saveStatus === "save_failed" ? "err" : "ok";
    const text = formatSuccessMessage(record);
    if (usePanelToast) await showPanelToast(text, toastType, record);
    else {
      await showPanelToast(text, toastType, record);
      await showToast(tab.id, text, "ok");
    }
    debug(`✅ ${text}`);
  } catch (err) {
    debug(`❌ ${err.message}`);
    const text = `❌ ${err.message.substring(0, 40)}`;
    const errorRecord = buildErrorRecord(wordPayload.rawWord, err.message);
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
  if (msg.type === "test-add") {
    proxyPost("/api/vocab", {
      rawWord: msg.word || "recurrence",
      candidateWord: msg.word || "recurrence",
      sourceTitle: "Concrete Mathematics",
      sourceUrl: "test://concrete-mathematics",
    })
      .then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
