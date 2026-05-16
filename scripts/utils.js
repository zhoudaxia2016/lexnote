const fs = require("fs");
const https = require("https");
const path = require("path");
const { exec } = require("child_process");

function loadEnv(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function httpsPost(urlStr, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: "POST", headers,
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? `open "${url}"`
    : process.platform === "win32" ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => { if (err) console.log(`   Please open manually:\n   ${url}`); });
}

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d;
}

function logJSON(dir, type, data) {
  const d = nowLocal();
  const p = path.join(dir, `${d.toISOString().slice(0, 10)}.json`);
  fs.appendFileSync(p, JSON.stringify({ ts: d.toISOString().replace("Z", "+08:00"), type, ...data }) + "\n");
}

module.exports = { loadEnv, httpsPost, openBrowser, nowLocal, logJSON };
