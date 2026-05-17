#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadEnv, logJSON } = require("./utils");
const { analyzeSelection, VALID_CATEGORIES, VALID_LEVELS } = require("./llm");
const { createClient } = require("./wps-openapi");

const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, "logs");
const PORT = 21987;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const envPath = path.join(ROOT, ".env");
if (!fs.existsSync(envPath)) {
  console.error("❌ .env not found. Copy .env.example and fill in credentials.");
  process.exit(1);
}
const env = loadEnv(envPath);

const wps = createClient(
  env.WPS_APP_ID,
  env.WPS_APP_KEY,
  env.WPS_FILE_ID,
  parseInt(env.WPS_SHEET_ID, 10) || 1,
  path.join(ROOT, ".wps_auth"),
  LOG_DIR,
  REDIRECT_URI,
);

function getFriendlySaveError(message) {
  if (message.includes("E_DBSHEET_VALUE_NOT_UNIQUE_IN_FIELD")) return "单词已存在，无需重复添加";
  return message;
}

const LEVEL_RANK = Object.fromEntries(VALID_LEVELS.map((level, index) => [level, index]));
const DEFAULT_RULES = {
  hideBelow: "B1",
  collectAtOrAbove: "C1",
  mustCollectCategories: ["数学术语"],
};

function normalizeRules(input) {
  const hideBelow = VALID_LEVELS.includes(input?.hideBelow) ? input.hideBelow : DEFAULT_RULES.hideBelow;
  const collectAtOrAbove = VALID_LEVELS.includes(input?.collectAtOrAbove) ? input.collectAtOrAbove : DEFAULT_RULES.collectAtOrAbove;
  const mustCollectCategories = Array.isArray(input?.mustCollectCategories)
    ? input.mustCollectCategories.filter((item) => VALID_CATEGORIES.includes(item))
    : DEFAULT_RULES.mustCollectCategories;
  return { hideBelow, collectAtOrAbove, mustCollectCategories };
}

function shouldHideItem(item, rules) {
  if (rules.mustCollectCategories.includes(item.category)) return false;
  return LEVEL_RANK[item.level] < LEVEL_RANK[rules.hideBelow];
}

function shouldCollectItem(item, rules) {
  if (item.type !== "word") return false;
  if (rules.mustCollectCategories.includes(item.category)) return true;
  return LEVEL_RANK[item.level] >= LEVEL_RANK[rules.collectAtOrAbove];
}

async function saveSingleItem(wpsClient, token, item, logDir) {
  const fields = {
    "单词": item.word,
    "分类": item.category || "",
    "意思": item.meaning || "",
    "note": item.note || "",
    "level": item.level || "B2",
  };

  try {
    const response = await wpsClient.createRecord(token, fields);
    logJSON(logDir, "add_vocab", { fields, response, saveStatus: "created", mode: "manual" });
    return { ok: true, saveStatus: "created", saveError: "" };
  } catch (err) {
    const friendly = getFriendlySaveError(err.message);
    const saveStatus = err.message.includes("E_DBSHEET_VALUE_NOT_UNIQUE_IN_FIELD") ? "exists" : "save_failed";
    logJSON(logDir, "add_vocab", { fields, saveStatus, error: err.message, mode: "manual" });
    return { ok: saveStatus !== "save_failed", saveStatus, saveError: friendly };
  }
}

async function saveItems(wpsClient, token, items, rules, logDir) {
  const results = [];
  for (const item of items) {
    const hidden = shouldHideItem(item, rules);
    const autoCollect = shouldCollectItem(item, rules);
    const enriched = {
      ...item,
      hidden,
      autoCollect,
      saveStatus: autoCollect ? "pending" : "skipped",
      saveError: "",
    };

    if (!autoCollect) {
      results.push(enriched);
      continue;
    }

    const fields = {
      "单词": item.word,
      "分类": item.category,
      "意思": item.meaning || "",
      "note": item.note || "",
      "level": item.level,
    };

    try {
      const response = await wpsClient.createRecord(token, fields);
      logJSON(logDir, "add_vocab", { fields, response, saveStatus: "created" });
      results.push({ ...enriched, saveStatus: "created" });
    } catch (err) {
      const friendly = getFriendlySaveError(err.message);
      const saveStatus = err.message.includes("E_DBSHEET_VALUE_NOT_UNIQUE_IN_FIELD") ? "exists" : "save_failed";
      logJSON(logDir, "add_vocab", { fields, saveStatus, error: err.message });
      results.push({ ...enriched, saveStatus, saveError: friendly });
    }
  }
  return results;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  if (req.method === "GET" && req.url.startsWith("/callback")) {
    const code = new URL(req.url, REDIRECT_URI).searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      return res.end("<h1>授权失败</h1><p>未获取到 code</p>");
    }
    try {
      const auth = await wps.handleOAuthCallback(code, res);
      const p = wps._oauth();
      if (p) { p._resolve(auth); wps._setOauth(null); }
    } catch (err) {
      const p = wps._oauth();
      if (p) { p._reject(err); wps._setOauth(null); }
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/auth-url") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ url: wps.getAuthUrl() }));
  }

  if (req.method === "GET" && req.url === "/api/token-status") {
    const auth = await wps.getValidAuth();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ hasToken: !!auth, expiresIn: auth ? auth.expires_in : 0 }));
  }

  if (req.method === "GET" && req.url === "/api/meta") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      categories: VALID_CATEGORIES,
      levels: VALID_LEVELS,
      defaultRules: DEFAULT_RULES,
    }));
  }

  if (req.method === "POST" && req.url === "/api/auth") {
    try {
      await wps.startOAuth();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (req.method === "POST" && req.url === "/api/vocab") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", async () => {
      let rawText, normalizedText, sourceTitle, sourceUrl, rules;
      try {
        ({ rawText, normalizedText, sourceTitle, sourceUrl, rules } = JSON.parse(body));
        if (!rawText && !normalizedText) throw new Error("Missing selection");
        const effectiveText = normalizedText || rawText;
        const normalizedRules = normalizeRules(rules);
        let auth = await wps.getValidAuth();
        if (!auth) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, needAuth: true, error: "Token expired. Please authorize." }));
        }
        console.log(`🤖 ${effectiveText}`);
        const ai = await analyzeSelection({ rawText, normalizedText: effectiveText, sourceTitle, sourceUrl }, env.API_KEY, env.MODEL, LOG_DIR);
        const items = await saveItems(wps, auth.access_token, ai.items, normalizedRules, LOG_DIR);
        const summary = {
          created: items.filter((item) => item.saveStatus === "created").length,
          exists: items.filter((item) => item.saveStatus === "exists").length,
          failed: items.filter((item) => item.saveStatus === "save_failed").length,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          translation: ai.translation,
          items,
          rules: normalizedRules,
          summary,
        }));
      } catch (err) {
        console.error("❌", err.message);
        const friendly = getFriendlySaveError(err.message);
        logJSON(LOG_DIR, "add_vocab", { rawText, normalizedText, error: err.message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: friendly }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/collect-item") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", async () => {
      try {
        const { item } = JSON.parse(body);
        if (!item?.word || item.type !== "word") throw new Error("Invalid item");
        const auth = await wps.getValidAuth();
        if (!auth) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, needAuth: true, error: "Token expired. Please authorize." }));
        }
        const result = await saveSingleItem(wps, auth.access_token, item, LOG_DIR);
        res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(result));
      } catch (err) {
        const friendly = getFriendlySaveError(err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, saveStatus: "save_failed", saveError: friendly, error: friendly }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`🔌 PDF Vocab Proxy — http://localhost:${PORT}`);
  console.log(`   POST /api/vocab   POST /api/auth   GET /api/token-status`);
  wps.getValidAuth().then(async (auth) => {
    if (auth) {
      const obtained = new Date(auth.obtained_at).getTime();
      const remain = Math.round(((obtained + auth.expires_in * 1000) - Date.now()) / 60000);
      console.log(`   ✅ Token valid (${remain} min remaining)`);
    } else {
      console.log("   ⚠ No valid token. Starting OAuth...");
      try { await wps.startOAuth(); console.log("   ✅ Authorization complete."); }
      catch (err) { console.log(`   ❌ Auth failed: ${err.message}`); }
    }
  });
});
