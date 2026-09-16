# social-bridge

A lightweight bridge between AI agents and social platforms, starting with LinkedIn.

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

## Secrets

Create these Firebase secrets before deploying:

```bash
firebase functions:secrets:set SOCIAL_BRIDGE_KEY
firebase functions:secrets:set LINKEDIN_ACCESS_TOKEN
firebase functions:secrets:set LINKEDIN_AUTHOR_URN
firebase functions:secrets:set LINKEDIN_CLIENT_SECRET
```

`LINKEDIN_AUTHOR_URN` should be the authenticated member URN used as the post author.

## LinkedIn OAuth

The V0 OAuth flow uses `openid profile w_member_social`.

Open `/linkedin/auth`, authorize the LinkedIn account, and LinkedIn will redirect to `/linkedin/callback`. The callback currently returns the access token and member URN so they can be stored manually in Firebase Secret Manager.

Token persistence and renewal are intentionally still manual in V0.

## Deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

## Scope

V0 intentionally has no UI, database, scheduler, analytics, or multi-user support. First milestone: verify the LinkedIn connection and publish one text post through the bridge.

Automatic token renewal, images, scheduling, and additional networks come later.
