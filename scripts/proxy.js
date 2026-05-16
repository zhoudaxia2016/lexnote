#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadEnv, logJSON } = require("./utils");
const { analyzeWord } = require("./llm");
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
      let rawWord, candidateWord, sourceTitle, sourceUrl;
      try {
        ({ rawWord, candidateWord, sourceTitle, sourceUrl } = JSON.parse(body));
        if (!rawWord && !candidateWord) throw new Error("Missing word");
        const lookupWord = candidateWord || rawWord;
        let auth = await wps.getValidAuth();
        if (!auth) {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: false, needAuth: true, error: "Token expired. Please authorize." }));
        }
        console.log(`🤖 ${lookupWord}`);
        const ai = await analyzeWord({ rawWord, candidateWord: lookupWord, sourceTitle, sourceUrl }, env.API_KEY, env.MODEL, LOG_DIR);
        const fields = {
          "单词": ai.word || lookupWord,
          "分类": ai.category,
          "意思": ai.meaning || "",
          "note": ai.note || "",
        };
        console.log(`📝 ${JSON.stringify(fields)}`);
        const result = await wps.createRecord(auth.access_token, fields);
        logJSON(LOG_DIR, "add_vocab", { fields, response: result });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...ai, fields }));
      } catch (err) {
        console.error("❌", err.message);
        let friendly = err.message;
        if (err.message.includes("E_DBSHEET_VALUE_NOT_UNIQUE_IN_FIELD")) friendly = "单词已存在，无需重复添加";
        logJSON(LOG_DIR, "add_vocab", { rawWord, candidateWord, error: err.message });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: friendly }));
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
