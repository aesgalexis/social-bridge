<p align="center">
  <img src="assets/social%20bridge%20logo.png" alt="Social Bridge" width="180" />
</p>

# social-bridge

A lightweight bridge between AI agents and social platforms, starting with LinkedIn.

The goal is simple: give trusted AI agents a small, controlled path for publishing to social networks without giving them direct access to platform credentials.

## Current flow

```text
ChatGPT / trusted agent
        |
        | creates an approved JSON request
        v
GitHub outbox
outbox/linkedin/*.json
        |
        | immediate push or scheduled scan
        v
GitHub Actions
        |
        | durable claim / receipt in git
        v
Social Bridge
Firebase HTTPS Function
        |
        | LinkedIn token stays in Firebase
        v
LinkedIn REST API
```

The agent can publish without receiving the LinkedIn password, LinkedIn access token, or Firebase secrets. The flow has been validated end to end with a real LinkedIn post published from a ChatGPT conversation after human approval.

## Capabilities

Social Bridge currently supports:

- LinkedIn OAuth and connection validation
- text posts
- single-image posts using LinkedIn's Images API
- immediate publishing from the GitHub outbox
- scheduled publishing through GitHub Actions
- durable delivery receipts to prevent automatic duplicate retries
- weekly LinkedIn connection health checks

The Firebase function exposes:

- `GET /health`
- `GET /linkedin/auth`
- `GET /linkedin/callback`
- `GET /linkedin/status`
- `POST /linkedin/post`

`GET /linkedin/status` and `POST /linkedin/post` require:

```text
Authorization: Bearer <SOCIAL_BRIDGE_KEY>
```

## Agent outbox

A new JSON file committed to `outbox/linkedin/` on `main` triggers `.github/workflows/publish-linkedin.yml`.

Immediate text post:

```json
{
  "publish": true,
  "text": "Hello LinkedIn"
}
```

Scheduled post:

```json
{
  "publish": true,
  "publishAt": "2026-09-18T09:30:00+02:00",
  "text": "Hello later"
}
```

Image post:

```json
{
  "publish": true,
  "text": "Hello with an image",
  "image": {
    "path": "media/linkedin/example.png",
    "altText": "Accessible description"
  }
}
```

Scheduling and images can be combined. The scheduler scans every 15 minutes, so `publishAt` is treated as "not before" rather than exact-to-the-minute delivery.

See `outbox/linkedin/README.md` for the full request format.

## Durable delivery receipts

Before calling LinkedIn, `scripts/publish-linkedin.mjs` creates a claim under `receipts/linkedin/`. After LinkedIn accepts the post, that receipt is updated to `published` with the returned post ID.

If a request becomes ambiguous, it remains claimed or is marked `attention_required`. Automatic runs will then refuse to publish that request again. This deliberately prefers a missed post requiring review over an accidental duplicate.

Outbox requests and delivery receipts remain in git history as a public audit trail.

## Connection monitoring

`.github/workflows/linkedin-health.yml` checks the protected `/linkedin/status` route every Monday and can also be run manually from GitHub Actions.

This catches an expired/revoked LinkedIn token or author mismatch before the next publication attempt.

## Direct HTTP example

Set the deployed function URL and bridge key:

```bash
export SOCIAL_BRIDGE_URL="https://europe-west1-<project-id>.cloudfunctions.net/socialBridge"
export SOCIAL_BRIDGE_KEY="<your-bridge-key>"
```

Check the public health endpoint:

```bash
curl "$SOCIAL_BRIDGE_URL/health"
```

Check the LinkedIn connection without publishing:

```bash
curl "$SOCIAL_BRIDGE_URL/linkedin/status" \
  -H "Authorization: Bearer $SOCIAL_BRIDGE_KEY"
```

Publish a text post:

```bash
curl -X POST "$SOCIAL_BRIDGE_URL/linkedin/post" \
  -H "Authorization: Bearer $SOCIAL_BRIDGE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello LinkedIn"}'
```

## Firebase secrets

Create these Firebase secrets before deploying:

```bash
firebase functions:secrets:set SOCIAL_BRIDGE_KEY
firebase functions:secrets:set LINKEDIN_ACCESS_TOKEN
firebase functions:secrets:set LINKEDIN_AUTHOR_URN
firebase functions:secrets:set LINKEDIN_CLIENT_SECRET
```

`LINKEDIN_AUTHOR_URN` is the authenticated member URN used as the post author.

## LinkedIn OAuth

The V0 OAuth flow uses `openid profile w_member_social`.

Open `/linkedin/auth`, authorize the LinkedIn account, and LinkedIn redirects to `/linkedin/callback`. The callback currently returns the access token and member URN so they can be stored manually in Firebase Secret Manager.

Token persistence and renewal are intentionally still manual. LinkedIn programmatic refresh tokens are only available to approved Marketing Developer Platform partners, so refresh-token automation depends on the app's LinkedIn access. Once persistence is automated, the callback should stop returning the access token to the browser.

## Deploy

The Functions runtime is Node.js 22. Dependency resolution is pinned with `functions/package-lock.json`.

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

## Scope

Social Bridge intentionally has no dashboard, analytics, or multi-user application layer. GitHub remains the queue, audit trail, scheduling surface, and delivery ledger for the current implementation.

## Roadmap

### Completed

- [x] LinkedIn OAuth
- [x] LinkedIn connection status check
- [x] LinkedIn text publishing
- [x] GitHub Actions agent relay
- [x] First real LinkedIn post published end to end from ChatGPT after human approval
- [x] Weekly LinkedIn connection health check
- [x] Firebase Functions on Node.js 22 with reproducible dependency lock
- [x] Durable delivery receipts / at-most-once automatic delivery
- [x] Single-image publishing
- [x] Scheduled publishing with ISO-8601 `publishAt`
- [x] Strict outbox/media validation with shared CI-tested guardrails

### Next

- [ ] Validate image publishing end to end with a real approved image post
- [ ] Multi-image publishing
- [ ] Automate LinkedIn token persistence / renewal where LinkedIn app access allows it
- [ ] Remove access token from OAuth callback response once persistence is automatic
- [ ] Additional social networks

The bridge should stay small. New capabilities belong here only when they are useful to agents and can be exposed through a simple, controlled interface.
