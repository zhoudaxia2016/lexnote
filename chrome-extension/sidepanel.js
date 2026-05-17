let currentRecord = null;
let currentSpokenText = "";

async function load() {
  await loadPanelRecord();
  updateTopSpeakButton("");
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "panel-toast" && msg.record) applyPanelUpdate(msg.record);
});

async function loadPanelRecord() {
  const stored = await chrome.storage.local.get(["panelToast"]);
  if (stored.panelToast?.record) applyPanelUpdate(stored.panelToast.record);
}

function applyPanelUpdate(record) {
  currentRecord = record || null;
  renderOverview(record);
  renderCandidates(record);
}

function renderOverview(record) {
  const el = document.getElementById("wordRecord");
  if (!el) return;

  if (!record) {
    el.className = "word-record";
    el.innerHTML = "";
    updateTopSpeakButton("");
    return;
  }

  updateTopSpeakButton(record.selection || "");

  if (record.error && !record.translation) {
    el.className = "word-record word-record-error";
    el.innerHTML = `
      <div class="record-title">
        <span class="record-title-text">翻译</span>
        <div class="record-title-meta">
          <button id="speakTopBtn" class="speak-btn" type="button">朗读</button>
        </div>
      </div>
      ${buildRecordRow("原文", record.selection || "", "")}
      ${buildRecordRow("状态", "分析失败", "record-value-error")}
      ${buildRecordRow("原因", record.error, "record-value-error")}
    `;
    bindTopButtons();
    return;
  }

  el.className = "word-record";
  el.innerHTML = `
    <div class="record-title">
      <span class="record-title-text">翻译</span>
      <div class="record-title-meta">
        <button id="speakTopBtn" class="speak-btn" type="button">朗读</button>
      </div>
    </div>
    ${buildRecordRow("原文", record.selection || "", "record-value-source")}
    ${buildRecordRow("翻译", record.translation || "", "record-value-note")}
  `;
  bindTopButtons();
}

function renderCandidates(record) {
  const el = document.getElementById("candidateList");
  if (!el) return;

  if (!record || record.error) {
    el.innerHTML = "";
    return;
  }

  const visibleItems = (record.items || []).filter((item) => !item.hidden);
  if (!visibleItems.length) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = visibleItems.map((item, index) => {
    return `
      <article class="candidate-card ${item.saveStatus === "save_failed" ? "candidate-card-error" : ""}">
        <div class="candidate-card-head">
          <div class="candidate-word-wrap">
            <div class="candidate-word-line">
              <div class="candidate-word">${escapeHtml(item.word || "")}</div>
              <span class="level-badge">${escapeHtml(item.level || "")}</span>
              ${buildInlineSaveBadge(item)}
            </div>
          </div>
          <div class="candidate-actions">
            <button class="mini-btn" type="button" data-action="speak-item" data-index="${index}">朗读</button>
            ${buildCollectButton(item, index)}
          </div>
        </div>
        ${buildCandidateDetailRow(item)}
        ${item.saveStatus === "save_failed" && item.saveError ? buildCandidateRow(item.saveError, "candidate-value-error") : ""}
      </article>
    `;
  }).join("");

  bindCandidateButtons();
}

function buildRecordRow(label, value, valueClass) {
  return `
    <div class="record-row">
      <span class="record-label">${label}</span>
      <span class="record-value ${valueClass || ""}">${escapeHtml(value || "")}</span>
    </div>
  `;
}

function buildCandidateRow(value, className = "") {
  return `<div class="candidate-row"><span class="candidate-value ${className}">${escapeHtml(value)}</span></div>`;
}

function buildCandidateDetailRow(item) {
  const hasCategory = !!item.category;
  const hasMeaning = !!item.meaning;
  const hasNote = !!item.note;
  if (!hasCategory && !hasMeaning && !hasNote) return "";
  return `
    <div class="candidate-row candidate-row-detail">
      ${hasCategory ? `<span class="category-badge">${escapeHtml(item.category)}</span>` : ""}
      ${hasMeaning ? `<span class="candidate-meaning">${escapeHtml(item.meaning)}</span>` : ""}
      ${hasNote ? `<span class="candidate-note">${escapeHtml(item.note)}</span>` : ""}
    </div>
  `;
}

function buildInlineSaveBadge(item) {
  if (item.saveStatus === "created") return `<span class="save-badge save-badge-created">已新增</span>`;
  if (item.saveStatus === "exists") return `<span class="save-badge save-badge-exists">已存在</span>`;
  if (item.saveStatus === "save_failed") return `<span class="save-badge save-badge-failed">写入失败</span>`;
  if (item.autoCollect) return `<span class="save-badge save-badge-pending">待写入</span>`;
  return "";
}

function buildCollectButton(item, index) {
  if (item.type !== "word") return "";
  if (item.saveStatus === "created" || item.saveStatus === "exists") return "";
  return `<button class="mini-btn mini-btn-primary" type="button" data-action="collect-item" data-index="${index}">收录</button>`;
}

function updateTopSpeakButton(text) {
  currentSpokenText = String(text || "").trim();
  const btn = document.getElementById("speakTopBtn");
  if (btn) btn.disabled = !currentSpokenText;
}

function bindTopButtons() {
  const speakBtn = document.getElementById("speakTopBtn");
  if (speakBtn) {
    speakBtn.disabled = !currentSpokenText;
    speakBtn.onclick = () => speakText(currentSpokenText);
  }
}

function bindCandidateButtons() {
  document.querySelectorAll('[data-action="speak-item"]').forEach((btn) => {
    btn.onclick = () => {
      const index = Number(btn.dataset.index);
      const item = currentRecord?.items?.filter((entry) => !entry.hidden)[index];
      if (item?.word) speakText(item.word);
    };
  });

  document.querySelectorAll('[data-action="collect-item"]').forEach((btn) => {
    btn.onclick = async () => {
      const index = Number(btn.dataset.index);
      await collectItem(index);
    };
  });
}

async function collectItem(visibleIndex) {
  if (!currentRecord) return;
  const visibleItems = currentRecord.items.filter((item) => !item.hidden);
  const target = visibleItems[visibleIndex];
  if (!target || target.type !== "word") return;

  const response = await chrome.runtime.sendMessage({
    type: "collect-item",
    item: target,
    context: currentRecord.selection || "",
  });
  const updatedItems = currentRecord.items.map((item) => {
    if (item !== target) return item;
    return {
      ...item,
      autoCollect: true,
      saveStatus: response?.saveStatus || "save_failed",
      saveError: response?.saveError || response?.error || "",
    };
  });

  const updatedRecord = {
    ...currentRecord,
    items: updatedItems,
  };
  applyPanelUpdate(updatedRecord);
  await chrome.runtime.sendMessage({ type: "update-panel-record", record: updatedRecord });
}

function speakText(text) {
  const value = String(text || "").trim();
  if (!value || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.setTimeout(() => {
    const cleaned = looksLikeSingleWord(value)
      ? value.replace(/[^\p{L}\p{N}'\s-]+/gu, " ").trim()
      : value.replace(/[^\p{L}\p{N}\s'".,;:!?()\-]+/gu, " ").replace(/\s+/g, " ").trim();
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) => item.lang === "en-US") || voices.find((item) => item.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }, 120);
}

function looksLikeSingleWord(value) {
  return !/\s/.test(value.trim());
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
  const settingsBtn = document.getElementById("openSettingsBtn");
  if (settingsBtn) {
    settingsBtn.onclick = () => {
      window.open(chrome.runtime.getURL("options.html"), "_blank", "noopener,noreferrer");
    };
  }
});
