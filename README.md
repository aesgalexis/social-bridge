# social-bridge

A lightweight bridge between AI agents and social platforms, starting with LinkedIn.

The goal is simple: give trusted AI agents a small, controlled HTTP interface for publishing to social networks without giving them direct access to platform credentials.

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

## Architecture

```text
AI agent / trusted caller
        |
        v
   Social Bridge
  Firebase HTTPS
        |
        v
  LinkedIn REST API
```

The caller only needs the bridge URL and `SOCIAL_BRIDGE_KEY`. LinkedIn credentials stay in Firebase Secret Manager and are never exposed to the publishing caller.

## Example

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

## Secrets

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

The first milestone is deliberately narrow: verify the LinkedIn connection and publish one text post reliably while keeping platform credentials isolated from the calling agent.

## Roadmap

- [x] LinkedIn OAuth
- [x] LinkedIn connection status check
- [x] LinkedIn text publishing
- [ ] Automatic token renewal
- [ ] Media / image publishing
- [ ] Scheduling
- [ ] Additional social networks

The bridge should stay small. New capabilities belong here only when they are useful to agents and can be exposed through a simple, controlled interface.
