const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("node:crypto");
const { publishTextPost } = require("./linkedin");

const BRIDGE_KEY = defineSecret("SOCIAL_BRIDGE_KEY");
const LINKEDIN_ACCESS_TOKEN = defineSecret("LINKEDIN_ACCESS_TOKEN");
const LINKEDIN_AUTHOR_URN = defineSecret("LINKEDIN_AUTHOR_URN");

function authorized(req) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = BRIDGE_KEY.value();

  if (!token || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

exports.socialBridge = onRequest(
  {
    region: "europe-west1",
    secrets: [BRIDGE_KEY, LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN]
  },
  async (req, res) => {
    if (req.method === "GET" && req.path === "/health") {
      return res.status(200).json({ ok: true });
    }

    if (!authorized(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
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
