const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("node:crypto");
const { publishTextPost } = require("./linkedin");

const BRIDGE_KEY = defineSecret("SOCIAL_BRIDGE_KEY");
const LINKEDIN_ACCESS_TOKEN = defineSecret("LINKEDIN_ACCESS_TOKEN");
const LINKEDIN_AUTHOR_URN = defineSecret("LINKEDIN_AUTHOR_URN");
const LINKEDIN_CLIENT_SECRET = defineSecret("LINKEDIN_CLIENT_SECRET");

const LINKEDIN_CLIENT_ID = "77ycnpkcgzoi5g";
const LINKEDIN_REDIRECT_URI =
  "https://europe-west1-social-bridge-7d433.cloudfunctions.net/socialBridge/linkedin/callback";
const LINKEDIN_SCOPES = "openid profile w_member_social";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function authorized(req) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = BRIDGE_KEY.value();

  if (!token || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function createOAuthState() {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac("sha256", BRIDGE_KEY.value())
    .update(timestamp)
    .digest("hex");

  return `${timestamp}.${signature}`;
}

function validOAuthState(state) {
  if (typeof state !== "string") return false;

  const [timestamp, signature] = state.split(".");
  if (!timestamp || !signature) return false;

  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || age < 0 || age > STATE_MAX_AGE_MS) return false;

  const expected = crypto
    .createHmac("sha256", BRIDGE_KEY.value())
    .update(timestamp)
    .digest("hex");

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
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

exports.socialBridge = onRequest(
  {
    region: "europe-west1",
    secrets: [
      BRIDGE_KEY,
      LINKEDIN_ACCESS_TOKEN,
      LINKEDIN_AUTHOR_URN,
      LINKEDIN_CLIENT_SECRET
    ]
  },
  async (req, res) => {
    if (req.method === "GET" && req.path === "/health") {
      return res.status(200).json({ ok: true });
    }

    if (req.method === "GET" && req.path === "/linkedin/auth") {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: LINKEDIN_CLIENT_ID,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        state: createOAuthState(),
        scope: LINKEDIN_SCOPES
      });

      return res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
    }

    if (req.method === "GET" && req.path === "/linkedin/callback") {
      res.set("Cache-Control", "no-store");

      if (req.query.error) {
        return res.status(400).json({
          ok: false,
          error: "linkedin_authorization_denied",
          details: req.query.error_description || req.query.error
        });
      }

      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";

      if (!code || !validOAuthState(state)) {
        return res.status(400).json({ ok: false, error: "invalid_oauth_callback" });
      }

      try {
        const token = await exchangeLinkedInCode(code);
        const userInfo = await getLinkedInUserInfo(token.access_token);
        const authorUrn = `urn:li:person:${userInfo.sub}`;

        return res.status(200).json({
          ok: true,
          accessToken: token.access_token,
          expiresIn: token.expires_in || null,
          authorUrn,
          member: {
            sub: userInfo.sub,
            name: userInfo.name || null
          },
          next: [
            "Set the access token as LINKEDIN_ACCESS_TOKEN in Firebase Secret Manager.",
            "Set authorUrn as LINKEDIN_AUTHOR_URN in Firebase Secret Manager.",
            "Redeploy the function."
          ]
        });
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
        const userInfo = await getLinkedInUserInfo(LINKEDIN_ACCESS_TOKEN.value());
        const actualAuthorUrn = `urn:li:person:${userInfo.sub}`;
        const configuredAuthorUrn = LINKEDIN_AUTHOR_URN.value();

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

      try {
        const result = await publishTextPost({
          accessToken: LINKEDIN_ACCESS_TOKEN.value(),
          authorUrn: LINKEDIN_AUTHOR_URN.value(),
          text
        });

        return res.status(201).json({ ok: true, ...result });
      } catch (error) {
        console.error(error);
        return res.status(502).json({ ok: false, error: "linkedin_publish_failed" });
      }
    }

    return res.status(404).json({ ok: false, error: "not_found" });
  }
);
