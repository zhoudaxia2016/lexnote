const crypto = require("crypto");
const fs = require("fs");
const querystring = require("querystring");
const { httpsPost, logJSON, openBrowser } = require("./utils");

function createClient(appId, appKey, fileId, sheetId, authPath, logDir, redirectUri) {
  function loadAuth() {
    if (!fs.existsSync(authPath)) return null;
    try { return JSON.parse(fs.readFileSync(authPath, "utf-8")); } catch { return null; }
  }

  function saveAuth(data) {
    fs.writeFileSync(authPath, JSON.stringify(data, null, 2));
  }

  function kso1Sign(method, uri, bodyStr) {
    const ksoDate = new Date().toUTCString();
    const sha256Body = crypto.createHash("sha256").update(bodyStr).digest("hex");
    const signString = `KSO-1${method}${uri}application/json${ksoDate}${sha256Body}`;
    const signature = crypto.createHmac("sha256", appKey).update(signString).digest("hex");
    return {
      "Content-Type": "application/json",
      "X-Kso-Date": ksoDate,
      "X-Kso-Authorization": `KSO-1 ${appId}:${signature}`,
    };
  }

  async function refreshAccessToken(refreshToken) {
    const body = querystring.stringify({
      grant_type: "refresh_token",
      client_id: appId, client_secret: appKey, refresh_token: refreshToken,
    });
    const { status, body: respBody } = await httpsPost(
      "https://openapi.wps.cn/oauth2/token",
      { "Content-Type": "application/x-www-form-urlencoded" }, body
    );
    const data = JSON.parse(respBody);
    if (status === 200 && data.access_token) {
      const auth = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in || 7200,
        obtained_at: new Date().toISOString(),
      };
      saveAuth(auth);
      console.log("✅ Token refreshed");
      logJSON(logDir, "auth_refresh", { response: { expires_in: data.expires_in } });
      return auth;
    }
    logJSON(logDir, "auth_refresh", { error: respBody });
    throw new Error(`Token refresh failed: ${respBody}`);
  }

  async function getValidAuth() {
    let auth = loadAuth();
    if (!auth) return null;
    const obtained = new Date(auth.obtained_at).getTime();
    const expiresAt = obtained + (auth.expires_in || 7200) * 1000;
    if (Date.now() < expiresAt - 60000) return auth;
    if (auth.refresh_token) {
      try { return await refreshAccessToken(auth.refresh_token); }
      catch (e) { console.log("Token refresh failed:", e.message); }
    }
    return null;
  }

  async function createRecord(token, fields) {
    const uri = `/v7/coop/dbsheet/${fileId}/sheets/${sheetId}/records/create`;
    const url = `https://openapi.wps.cn${uri}`;
    const bodyObj = { prefer_id: false, records: [{ fields_value: JSON.stringify(fields) }] };
    const bodyStr = JSON.stringify(bodyObj);
    const headers = kso1Sign("POST", uri, bodyStr);
    headers["Authorization"] = `Bearer ${token}`;
    const { status, body } = await httpsPost(url, headers, bodyStr);
    const data = JSON.parse(body);
    if (status !== 200) throw new Error(`WPS ${status}: ${body}`);
    if (data.code !== undefined && data.code !== 0) throw new Error(`WPS error: ${data.msg || data.code}`);
    return data;
  }

  async function handleOAuthCallback(code, res) {
    try {
      const body = querystring.stringify({
        grant_type: "authorization_code",
        client_id: appId, client_secret: appKey,
        code, redirect_uri: redirectUri,
      });
      const { status, body: respBody } = await httpsPost(
        "https://openapi.wps.cn/oauth2/token",
        { "Content-Type": "application/x-www-form-urlencoded" }, body
      );
      const data = JSON.parse(respBody);
      if (status !== 200 || !data.access_token) throw new Error(respBody);
      const auth = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in || 7200,
        obtained_at: new Date().toISOString(),
      };
      saveAuth(auth);
      logJSON(logDir, "auth_login", { response: { token_type: data.token_type, expires_in: data.expires_in } });
      if (res) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>授权成功 ✅</h1><p>可以关闭此页面。</p>");
      }
      console.log("✅ OAuth complete, token saved");
      return auth;
    } catch (err) {
      logJSON(logDir, "auth_login", { error: err.message });
      if (res) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>授权失败</h1><p>${err.message}</p>`);
      }
      throw err;
    }
  }

  let _oauthPromise = null;

  function startOAuth() {
    if (_oauthPromise) return _oauthPromise;
    const authUrl =
      `https://openapi.wps.cn/oauth2/auth?response_type=code` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=kso.dbsheet.readwrite&state=vocab`;
    console.log("🔐 Opening browser for WPS authorization...");
    openBrowser(authUrl);
    let res, rej;
    _oauthPromise = new Promise((resolve, reject) => { res = resolve; rej = reject; });
    _oauthPromise._resolve = res;
    _oauthPromise._reject = rej;
    setTimeout(() => { if (_oauthPromise) { rej(new Error("Auth timeout")); _oauthPromise = null; } }, 5 * 60 * 1000);
    return _oauthPromise;
  }

  function getAuthUrl() {
    return `https://openapi.wps.cn/oauth2/auth?response_type=code` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=kso.dbsheet.readwrite&state=vocab`;
  }

  return { getValidAuth, createRecord, handleOAuthCallback, startOAuth, getAuthUrl, _oauth: () => _oauthPromise, _setOauth: (p) => { _oauthPromise = p; } };
}

module.exports = { createClient };
