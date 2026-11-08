const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8");
const origin = "https://europe-west1-social-bridge-7d433.cloudfunctions.net";
const adminKey = "fixture-admin-key";
const bridgeKey = "fixture-publish-key";
const cookieName = "__Host-social-bridge-oauth";

function mockBridge({ member = "owner", storageStatus = 200 } = {}) {
  const exports = {};
  const consumed = new Set();
  const writes = [];
  let exchanges = 0;
  let now = Date.now();
  const jsonResponse = (data) => ({ ok: true, status: 200, json: async () => data });
  vm.runInNewContext(source, {
    require(id) {
      if (id === "firebase-functions/v2/https") return { onRequest: (_, handler) => handler };
      if (id === "firebase-functions/params") {
        const secrets = { LINKEDIN_OAUTH_ADMIN_KEY: adminKey, SOCIAL_BRIDGE_KEY: bridgeKey };
        return { defineSecret: (name) => ({ value: () => secrets[name] }) };
      }
      if (id === "./linkedin") return {};
      assert.equal(id, "node:crypto");
      return require(id);
    },
    exports,
    process: { env: {} },
    console: { error() {} },
    AbortSignal,
    Buffer,
    URL,
    URLSearchParams,
    Date: class extends Date { static now() { return now; } },
    async fetch(address, options) {
      const url = new URL(address);
      if (url.hostname === "metadata.google.internal") return jsonResponse({ access_token: "gcp-token" });
      if (url.hostname === "storage.googleapis.com") {
        assert.equal(options.method, "POST");
        assert.equal(url.searchParams.get("ifGenerationMatch"), "0");
        const name = url.searchParams.get("name");
        assert.match(name, /^linkedin\/[a-f0-9]{32}$/);
        if (consumed.has(name)) return { ok: false, status: 412 };
        if (storageStatus !== 200) return { ok: false, status: storageStatus };
        consumed.add(name);
        return jsonResponse({});
      }
      if (address === "https://www.linkedin.com/oauth/v2/accessToken") {
        exchanges++;
        return jsonResponse({ access_token: "linkedin-token" });
      }
      if (address === "https://api.linkedin.com/v2/userinfo") return jsonResponse({ sub: member });
      if (url.pathname.endsWith("/LINKEDIN_AUTHOR_URN/versions/latest:access")) {
        return jsonResponse({ payload: { data: Buffer.from("urn:li:person:owner").toString("base64") } });
      }
      if (url.pathname.endsWith(":addVersion")) {
        writes.push(url.pathname.split("/").at(-1));
        return jsonResponse({});
      }
      throw new Error("Unexpected request " + address);
    }
  });

  async function request(method, path, { headers = {}, body, query = {} } = {}) {
    const res = {
      statusCode: 200,
      headers: {},
      set(key, value) { this.headers[key] = value; return this; },
      type(value) { return this.set("Content-Type", value); },
      status(code) { this.statusCode = code; return this; },
      send(value) { this.body = value; return this; },
      json(value) { return this.send(value); },
      cookie(name, value, options) { this.sessionCookie = { name, value, options }; return this; },
      clearCookie(name) { this.clearedCookie = name; return this; },
      redirect(code, url) { return this.status(code).set("Location", url); }
    };
    await exports.socialBridge({
      method, path, body, query,
      get: (key) => headers[key],
      is: (contentType) => headers["content-type"] === contentType
    }, res);
    return res;
  }

  async function start({ key = adminKey, from = origin } = {}) {
    return request("POST", "/linkedin/auth", {
      headers: { origin: from, "content-type": "application/x-www-form-urlencoded" },
      body: { adminKey: key }
    });
  }

  function callback(started, { cookie, code = "linkedin-code", error } = {}) {
    return request("GET", "/linkedin/callback", {
      headers: { cookie },
      query: {
        state: new URL(started.headers.Location).searchParams.get("state"),
        code,
        error
      }
    });
  }

  return { request, start, callback, consumed, writes, exchanges: () => exchanges, advance(ms) { now += ms; } };
}

function session(started) {
  return `${started.sessionCookie.name}=${started.sessionCookie.value}`;
}

test("only the admin can start OAuth in a same-origin browser", async () => {
  const bridge = mockBridge();
  const form = await bridge.request("GET", "/linkedin/auth");
  assert.match(form.body, /type="password"/);
  assert.equal(form.headers["Cache-Control"], "no-store");
  assert.equal(form.headers["Referrer-Policy"], "same-origin");
  assert.equal((await bridge.start({ key: bridgeKey })).statusCode, 401);
  assert.equal((await bridge.start({ from: "https://other.example" })).statusCode, 401);

  const started = await bridge.start();
  assert.equal(started.statusCode, 303);
  assert.equal(new URL(started.headers.Location).hostname, "www.linkedin.com");
  assert.equal(started.sessionCookie.name, cookieName);
  assert.equal(started.sessionCookie.options.httpOnly, true);
  assert.equal(started.sessionCookie.options.secure, true);
  assert.equal(started.sessionCookie.options.sameSite, "lax");
  assert.equal(started.sessionCookie.options.path, "/");
  assert.equal(started.sessionCookie.options.maxAge, 600_000);
});

test("rejects missing, mismatched and expired browser sessions before consuming state", async () => {
  const bridge = mockBridge();
  const started = await bridge.start();
  const other = await bridge.start();
  assert.equal((await bridge.callback(started)).statusCode, 400);
  assert.equal((await bridge.callback(started, { cookie: session(other) })).statusCode, 400);
  bridge.advance(600_001);
  assert.equal((await bridge.callback(started, { cookie: session(started) })).statusCode, 400);
  assert.equal(bridge.consumed.size, 0);
  assert.equal(bridge.exchanges(), 0);
});

test("consumes a matching state once even for concurrent callbacks", async () => {
  const bridge = mockBridge();
  const started = await bridge.start();
  const cookie = session(started);
  const results = await Promise.all([
    bridge.callback(started, { cookie }),
    bridge.callback(started, { cookie, code: "another-code" })
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 400]);
  const success = results.find((result) => result.statusCode === 200);
  assert.equal(success.clearedCookie, cookieName);
  assert.equal(success.body.connected, true);
  assert.doesNotMatch(JSON.stringify(success.body), /linkedin-token|linkedin-code/);
  assert.equal(bridge.exchanges(), 1);
  assert.deepEqual(bridge.writes, ["LINKEDIN_ACCESS_TOKEN:addVersion"]);
});

test("a callback for another LinkedIn member cannot replace the connection", async () => {
  const bridge = mockBridge({ member: "other-member" });
  const started = await bridge.start();
  const result = await bridge.callback(started, { cookie: session(started) });
  assert.equal(result.statusCode, 409);
  assert.deepEqual(bridge.writes, []);
});

test("fails before exchanging a code if replay protection is unavailable", async () => {
  const bridge = mockBridge({ storageStatus: 403 });
  const started = await bridge.start();
  assert.equal((await bridge.callback(started, { cookie: session(started) })).statusCode, 502);
  assert.equal(bridge.exchanges(), 0);
  assert.deepEqual(bridge.writes, []);
});
