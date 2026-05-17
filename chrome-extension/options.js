const FALLBACK_DEFAULT_RULES = {
  hideBelow: "B1",
  collectAtOrAbove: "C1",
  mustCollectCategories: ["数学术语"],
};

const FALLBACK_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const FALLBACK_CATEGORIES = ["数学术语", "描述词", "连接词"];

let meta = {
  categories: [...FALLBACK_CATEGORIES],
  levels: [...FALLBACK_LEVELS],
  defaultRules: { ...FALLBACK_DEFAULT_RULES },
};

async function load() {
  await Promise.all([loadMeta(), checkTokenStatus(), loadDebugInfo()]);
  await loadRules();
}

async function loadMeta() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: "proxy-meta" });
    meta = {
      categories: Array.isArray(resp?.categories) && resp.categories.length ? resp.categories : [...FALLBACK_CATEGORIES],
      levels: Array.isArray(resp?.levels) && resp.levels.length ? resp.levels : [...FALLBACK_LEVELS],
      defaultRules: resp?.defaultRules || { ...FALLBACK_DEFAULT_RULES },
    };
  } catch {
    meta = {
      categories: [...FALLBACK_CATEGORIES],
      levels: [...FALLBACK_LEVELS],
      defaultRules: { ...FALLBACK_DEFAULT_RULES },
    };
  }
  renderLevelOptions();
  renderCategoryOptions([]);
}

function renderLevelOptions() {
  renderSelectOptions("hideBelow", meta.levels);
  renderSelectOptions("collectAtOrAbove", meta.levels);
}

function renderSelectOptions(id, values) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

function renderCategoryOptions(selected) {
  const container = document.getElementById("categoryList");
  if (!container) return;
  const selectedSet = new Set(selected);
  container.innerHTML = meta.categories.map((category) => `
    <label class="checkbox-row">
      <input type="checkbox" data-category="${escapeHtml(category)}" ${selectedSet.has(category) ? "checked" : ""} />
      <span>${escapeHtml(category)}</span>
    </label>
  `).join("");
}

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

async function startAuth() {
  showStatus("正在授权...", "", "authStatus");
  try {
    const resp = await chrome.runtime.sendMessage({ type: "proxy-auth" });
    if (resp && resp.ok) {
      showStatus("授权成功", "ok", "authStatus");
      checkTokenStatus();
    } else {
      showStatus(`授权失败: ${resp?.error || "未知错误"}`, "err", "authStatus");
    }
  } catch (err) {
    showStatus(`授权失败: ${err.message}`, "err", "authStatus");
  }
}

function normalizeRules(input) {
  const defaultRules = meta.defaultRules || FALLBACK_DEFAULT_RULES;
  const levels = meta.levels || FALLBACK_LEVELS;
  const categories = meta.categories || FALLBACK_CATEGORIES;
  const hideBelow = levels.includes(input?.hideBelow) ? input.hideBelow : defaultRules.hideBelow;
  const collectAtOrAbove = levels.includes(input?.collectAtOrAbove) ? input.collectAtOrAbove : defaultRules.collectAtOrAbove;
  const mustCollectCategories = Array.isArray(input?.mustCollectCategories)
    ? input.mustCollectCategories.filter((item) => categories.includes(item))
    : defaultRules.mustCollectCategories;
  return { hideBelow, collectAtOrAbove, mustCollectCategories };
}

function getVal(id) {
  return document.getElementById(id)?.value || "";
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function showStatus(msg, cls, id) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.className = `status ${cls}`.trim();
  }
}

async function loadRules() {
  const stored = await chrome.storage.local.get(["translationRules"]);
  const rules = normalizeRules(stored.translationRules || {});
  setVal("hideBelow", rules.hideBelow);
  setVal("collectAtOrAbove", rules.collectAtOrAbove);
  renderCategoryOptions(rules.mustCollectCategories);
}

function readRulesFromForm() {
  const selectedCategories = Array.from(document.querySelectorAll("#categoryList input[type='checkbox']:checked"))
    .map((input) => input.dataset.category)
    .filter(Boolean);
  return normalizeRules({
    hideBelow: getVal("hideBelow"),
    collectAtOrAbove: getVal("collectAtOrAbove"),
    mustCollectCategories: selectedCategories,
  });
}

async function saveSettings() {
  const rules = readRulesFromForm();
  await chrome.storage.local.set({ translationRules: rules });
  showStatus("已保存", "ok", "rulesStatus");
}

async function testAdd() {
  showStatus("测试中...", "", "testStatus");
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "test-add",
      text: "For the Tower of Hanoi, this is the recurrence (1.1) that allows us, given the inclination, to compute Tn for any n.",
      rules: readRulesFromForm(),
    });
    if (resp && resp.ok) {
      showStatus("测试完成", "ok", "testStatus");
      debugLog(`✅ 已分析 ${Array.isArray(resp.items) ? resp.items.length : 0} 项`);
    } else if (resp && resp.needAuth) {
      showStatus("Token 过期，请重新授权", "err", "testStatus");
    } else {
      showStatus(`测试失败: ${resp?.error || "未知错误"}`, "err", "testStatus");
    }
  } catch (err) {
    showStatus(`错误: ${err.message}`, "err", "testStatus");
  }
}

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
  if (logs.length) document.getElementById("debugLog").textContent = logs.join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  document.getElementById("authBtn").addEventListener("click", startAuth);
  document.getElementById("testBtn").addEventListener("click", testAdd);
  document.getElementById("hideBelow").addEventListener("change", saveSettings);
  document.getElementById("collectAtOrAbove").addEventListener("change", saveSettings);
  document.getElementById("categoryList").addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
      saveSettings();
    }
  });
  document.getElementById("clearLogBtn").addEventListener("click", async () => {
    document.getElementById("debugLog").textContent = "";
    await chrome.storage.local.set({ debugLogs: [] });
  });
  document.getElementById("copyLogBtn").addEventListener("click", () => {
    const el = document.getElementById("debugLog");
    navigator.clipboard.writeText(el.textContent).then(() => showStatus("已复制", "ok", "rulesStatus"));
  });
});
