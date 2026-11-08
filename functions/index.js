const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("node:crypto");
const { publishTextPost, publishImagePost } = require("./linkedin");

const BRIDGE_KEY = defineSecret("SOCIAL_BRIDGE_KEY");
const LINKEDIN_ACCESS_TOKEN = defineSecret("LINKEDIN_ACCESS_TOKEN");
const LINKEDIN_AUTHOR_URN = defineSecret("LINKEDIN_AUTHOR_URN");
const LINKEDIN_CLIENT_SECRET = defineSecret("LINKEDIN_CLIENT_SECRET");
const LINKEDIN_OAUTH_ADMIN_KEY = defineSecret("LINKEDIN_OAUTH_ADMIN_KEY");

const LINKEDIN_CLIENT_ID = "77ycnpkcgzoi5g";
const LINKEDIN_REDIRECT_URI =
  "https://europe-west1-social-bridge-7d433.cloudfunctions.net/socialBridge/linkedin/callback";
const LINKEDIN_SCOPES = "openid profile w_member_social";
const LINKEDIN_MAX_TEXT_LENGTH = 3000;
const LINKEDIN_MAX_ALT_TEXT_LENGTH = 4086;
const BRIDGE_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif"
]);
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_ORIGIN = new URL(LINKEDIN_REDIRECT_URI).origin;
const OAUTH_COOKIE = "__Host-social-bridge-oauth";
const OAUTH_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
const OAUTH_FORM = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Connect LinkedIn</title>
<h1>Connect LinkedIn</h1>
<form method="post" action="auth">
  <label>OAuth admin key <input name="adminKey" type="password" required></label>
  <button type="submit">Continue to LinkedIn</button>
</form>
</html>`;

function secureEqual(value, expected) {
  if (typeof value !== "string" || !value || !expected) return false;
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function authorized(req) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return secureEqual(token, BRIDGE_KEY.value());
}

function signOAuthState(message, session, adminKey) {
  return crypto.createHmac("sha256", adminKey)
    .update(`linkedin-oauth:${message}:${session}`)
    .digest("hex");
}

function createOAuthState(session, adminKey) {
  const message = `${Date.now()}.${crypto.randomBytes(16).toString("hex")}`;
  return `${message}.${signOAuthState(message, session, adminKey)}`;
}

function oauthStateNonce(state, cookie, adminKey) {
  if (typeof state !== "string" || !adminKey) return null;

  const session = cookie?.match(
    /(?:^|;\s*)__Host-social-bridge-oauth=([a-f0-9]{64})(?=;|$)/
  )?.[1];
  const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(state);
  if (!session || !match) return null;

  const [, timestamp, nonce, signature] = match;
  const age = Date.now() - Number(timestamp);
  if (age < 0 || age > STATE_MAX_AGE_MS) return null;

  const expected = signOAuthState(`${timestamp}.${nonce}`, session, adminKey);
  return secureEqual(signature, expected) ? nonce : null;
}

const GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "social-bridge-7d433";

// Uses the Cloud Run service identity, never browser-supplied credentials.
async function googleServiceToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) }
  );
  if (!response.ok) throw new Error(`GCP identity unavailable (${response.status})`);
  const payload = await response.json();
  if (typeof payload.access_token !== "string") throw new Error("Missing GCP identity token");
  return payload.access_token;
}

// A conditional create consumes the state once across all function instances.
async function consumeOAuthState(nonce) {
  const bucket = `${GOOGLE_CLOUD_PROJECT}-oauth-replay`;
  const params = new URLSearchParams({
    uploadType: "media",
    name: `linkedin/${nonce}`,
    ifGenerationMatch: "0"
  });
  const accessToken = await googleServiceToken();
  const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?${params}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "text/plain" },
    body: "used",
    signal: AbortSignal.timeout(10000)
  });
  await response.body?.cancel();
  if (response.status === 412) return false;
  if (!response.ok) throw new Error(`OAuth replay store unavailable (${response.status})`);
  return true;
}

async function secretManagerRequest(method, secretName, suffix, body) {
  const accessToken = await googleServiceToken();
  const url = `https://secretmanager.googleapis.com/v1/projects/${GOOGLE_CLOUD_PROJECT}/secrets/${secretName}${suffix}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Secret Manager ${method} ${secretName} failed (${response.status})`);
  return response.json();
}

async function readSecretLatest(secretName) {
  const payload = await secretManagerRequest("GET", secretName, "/versions/latest:access");
  if (typeof payload.payload?.data !== "string") throw new Error("Secret Manager returned empty secret");
  return Buffer.from(payload.payload.data, "base64").toString("utf8");
}

async function addSecretVersion(secretName, value) {
  return secretManagerRequest("POST", secretName, ":addVersion", {
    payload: { data: Buffer.from(value, "utf8").toString("base64") }
  });
}

async function readLinkedInConnection() {
  const [accessToken, authorUrn] = await Promise.all([
    readSecretLatest("LINKEDIN_ACCESS_TOKEN"),
    readSecretLatest("LINKEDIN_AUTHOR_URN")
  ]);
  if (!accessToken || !/^urn:li:person:[a-zA-Z0-9_-]+$/.test(authorUrn)) {
    throw new Error("LinkedIn credentials not configured");
  }
  return { accessToken, authorUrn };
}

async function exchangeLinkedInCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: LINKEDIN_CLIENT_ID,
    client_secret: LINKEDIN_CLIENT_SECRET.value(),
    redirect_uri: LINKEDIN_REDIRECT_URI
  });

  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(`LinkedIn token exchange failed (${response.status})`);
  }

  return payload;
}

async function getLinkedInUserInfo(accessToken) {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const payload = await response.json();
  if (!response.ok || !payload.sub) {
    throw new Error(`LinkedIn userinfo failed (${response.status})`);
  }

  return payload;
}

function parseImagePayload(body) {
  if (body?.image === undefined) return null;

  const data = typeof body.image?.data === "string" ? body.image.data.trim() : "";
  const contentType =
    typeof body.image?.contentType === "string"
      ? body.image.contentType.trim().toLowerCase()
      : "";
  const altText =
    typeof body.image?.altText === "string" ? body.image.altText.trim() : "";

  if (!data) {
    return { error: "image_data_required" };
  }

  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
    return {
      error: "unsupported_image_type",
      supportedTypes: [...SUPPORTED_IMAGE_TYPES]
    };
  }

  if (altText.length > LINKEDIN_MAX_ALT_TEXT_LENGTH) {
    return {
      error: "image_alt_text_too_long",
      maxLength: LINKEDIN_MAX_ALT_TEXT_LENGTH
    };
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { error: "invalid_image_base64" };
  }

  const imageBuffer = Buffer.from(data, "base64");

  if (!imageBuffer.length) {
    return { error: "invalid_image_base64" };
  }

  if (imageBuffer.length > BRIDGE_MAX_IMAGE_BYTES) {
    return {
      error: "image_too_large_for_bridge",
      maxBytes: BRIDGE_MAX_IMAGE_BYTES
    };
  }

  return {
    imageBuffer,
    contentType,
    altText
  };
}

exports.socialBridge = onRequest(
  {
    region: "europe-west1",
    secrets: [
      BRIDGE_KEY,
      LINKEDIN_ACCESS_TOKEN,
      LINKEDIN_AUTHOR_URN,
      LINKEDIN_CLIENT_SECRET,
      LINKEDIN_OAUTH_ADMIN_KEY
    ]
  },
  async (req, res) => {
    if (req.method === "GET" && req.path === "/health") {
      return res.status(200).json({ ok: true });
    }

    if (req.path === "/linkedin/auth") {
      res.set("Cache-Control", "no-store");
      if (req.method === "GET") {
        res.set("Referrer-Policy", "same-origin");
        res.set("Content-Security-Policy", "default-src 'none'; form-action 'self' https://www.linkedin.com; frame-ancestors 'none'; base-uri 'none'");
        return res.type("html").send(OAUTH_FORM);
      }
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "method_not_allowed" });
      }

      res.set("Referrer-Policy", "no-referrer");
      const adminKey = LINKEDIN_OAUTH_ADMIN_KEY.value();
      if (req.get("origin") !== OAUTH_ORIGIN ||
          !req.is("application/x-www-form-urlencoded") ||
          !secureEqual(req.body?.adminKey, adminKey)) {
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }

      const session = crypto.randomBytes(32).toString("hex");
      res.cookie(OAUTH_COOKIE, session, { ...OAUTH_COOKIE_OPTIONS, maxAge: STATE_MAX_AGE_MS });
      const params = new URLSearchParams({
        response_type: "code",
        client_id: LINKEDIN_CLIENT_ID,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        state: createOAuthState(session, adminKey),
        scope: LINKEDIN_SCOPES
      });
      return res.redirect(303, `https://www.linkedin.com/oauth/v2/authorization?${params}`);
    }

    if (req.method === "GET" && req.path === "/linkedin/callback") {
      res.set("Cache-Control", "no-store");
      res.set("Referrer-Policy", "no-referrer");
      res.set("X-Content-Type-Options", "nosniff");

      const code = typeof req.query.code === "string" ? req.query.code : "";
      const denied = typeof req.query.error === "string" && req.query.error.length > 0;
      const nonce = oauthStateNonce(
        req.query.state, req.get("cookie"), LINKEDIN_OAUTH_ADMIN_KEY.value()
      );
      if ((!code && !denied) || !nonce) {
        return res.status(400).json({ ok: false, error: "invalid_oauth_callback" });
      }

      res.clearCookie(OAUTH_COOKIE, OAUTH_COOKIE_OPTIONS);
      try {
        if (!await consumeOAuthState(nonce)) {
          return res.status(400).json({ ok: false, error: "invalid_oauth_callback" });
        }
        if (denied) {
          return res.status(400).json({ ok: false, error: "linkedin_authorization_denied" });
        }

        const token = await exchangeLinkedInCode(code);
        const userInfo = await getLinkedInUserInfo(token.access_token);
        const authorUrn = await readSecretLatest("LINKEDIN_AUTHOR_URN");
        if (!/^urn:li:person:[a-zA-Z0-9_-]+$/.test(authorUrn) ||
            authorUrn !== `urn:li:person:${userInfo.sub}`) {
          return res.status(409).json({ ok: false, error: "linkedin_author_mismatch" });
        }
        await addSecretVersion("LINKEDIN_ACCESS_TOKEN", token.access_token);

        return res.status(200).json({ ok: true, connected: true });
      } catch (error) {
        console.error(error);
        return res.status(502).json({ ok: false, error: "linkedin_oauth_failed" });
      }
    }

    if (!authorized(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    if (req.method === "GET" && req.path === "/linkedin/status") {
      try {
        const connection = await readLinkedInConnection();
        const userInfo = await getLinkedInUserInfo(connection.accessToken);
        const actualAuthorUrn = `urn:li:person:${userInfo.sub}`;
        const configuredAuthorUrn = connection.authorUrn;

        if (actualAuthorUrn !== configuredAuthorUrn) {
          return res.status(409).json({
            ok: false,
            connected: true,
            error: "linkedin_author_mismatch",
            actualAuthorUrn,
            configuredAuthorUrn
          });
        }

        return res.status(200).json({
          ok: true,
          connected: true,
          authorUrn: configuredAuthorUrn,
          member: {
            sub: userInfo.sub,
            name: userInfo.name || null
          }
        });
      } catch (error) {
        console.error(error);
        return res.status(502).json({
          ok: false,
          connected: false,
          error: "linkedin_status_failed"
        });
      }
    }

    if (req.method === "POST" && req.path === "/linkedin/post") {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

      if (!text) {
        return res.status(400).json({ ok: false, error: "text_required" });
      }

      if (text.length > LINKEDIN_MAX_TEXT_LENGTH) {
        return res.status(400).json({
          ok: false,
          error: "text_too_long",
          maxLength: LINKEDIN_MAX_TEXT_LENGTH
        });
      }

      const image = parseImagePayload(req.body);

      if (image?.error) {
        return res.status(400).json({ ok: false, ...image });
      }

      try {
        const connection = await readLinkedInConnection();
        const userInfo = await getLinkedInUserInfo(connection.accessToken);
        if (`urn:li:person:${userInfo.sub}` !== connection.authorUrn) {
          return res.status(409).json({ ok: false, error: "linkedin_author_mismatch" });
        }
        const common = {
          accessToken: connection.accessToken,
          authorUrn: connection.authorUrn,
          text
        };

        const result = image
          ? await publishImagePost({ ...common, ...image })
          : await publishTextPost(common);

        return res.status(201).json({
          ok: true,
          mediaType: image ? "image" : "text",
          ...result
        });
      } catch (error) {
        console.error(error);
        return res.status(502).json({ ok: false, error: "linkedin_publish_failed" });
      }
    }

    return res.status(404).json({ ok: false, error: "not_found" });
  }
);
