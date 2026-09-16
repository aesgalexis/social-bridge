# social-bridge

A lightweight bridge between AI agents and social platforms, starting with LinkedIn.

The goal is simple: give trusted AI agents a small, controlled path for publishing to social networks without giving them direct access to platform credentials.

## Current flow

Social Bridge can be called directly over HTTP, but ChatGPT does not always have a generic HTTP write tool available in a conversation. For this repo, GitHub can act as the final relay:

```text
ChatGPT / trusted agent
        |
        | creates an approved JSON file
        v
GitHub outbox
outbox/linkedin/*.json
        |
        | push to main
        v
GitHub Actions
        |
        | SOCIAL_BRIDGE_KEY
        v
Social Bridge
Firebase HTTPS Function
        |
        | LinkedIn token stays in Firebase
        v
LinkedIn REST API
```

The agent can therefore publish without receiving the LinkedIn password, LinkedIn access token, or Firebase secrets.

## V0

One Firebase HTTPS function with these routes:

- `GET /health`
- `GET /linkedin/auth`
- `GET /linkedin/callback`
- `GET /linkedin/status`
- `POST /linkedin/post`

`GET /linkedin/status` and `POST /linkedin/post` require:

```text
Authorization: Bearer <SOCIAL_BRIDGE_KEY>
```

The status route validates the stored LinkedIn access token against LinkedIn and confirms that it belongs to the configured author URN without publishing anything.

The publish route expects:

```json
{
  "text": "Hello LinkedIn"
}
```

## Agent outbox

A new JSON file committed to `outbox/linkedin/` on `main` triggers `.github/workflows/publish-linkedin.yml`.

Example:

```json
{
  "publish": true,
  "text": "Hello LinkedIn"
}
```

Only newly added `.json` files are published. Editing or deleting an existing outbox entry does not republish it.

The workflow validates the file, strips it down to the `text` payload, and sends it to Social Bridge. The bridge then publishes through LinkedIn using credentials stored in Firebase Secret Manager.

This gives the repo a simple public audit trail: the exact text an agent asked to publish remains visible in git history.

### GitHub Actions secret

The repository needs one Actions secret:

```text
SOCIAL_BRIDGE_KEY
```

It must contain the same value as the Firebase Secret Manager secret `SOCIAL_BRIDGE_KEY`.

No LinkedIn credential is stored in GitHub.

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

Token persistence and renewal are intentionally still manual in V0.

## Deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

## Scope

V0 intentionally has no UI, database, scheduler, analytics, or multi-user support.

The first milestone is deliberately narrow: let an AI agent publish an approved LinkedIn text post reliably while keeping platform credentials isolated from the agent.

## Roadmap

- [x] LinkedIn OAuth
- [x] LinkedIn connection status check
- [x] LinkedIn text publishing
- [x] GitHub Actions agent relay
- [ ] Automatic token renewal
- [ ] Media / image publishing
- [ ] Scheduling
- [ ] Additional social networks

The bridge should stay small. New capabilities belong here only when they are useful to agents and can be exposed through a simple, controlled interface.
