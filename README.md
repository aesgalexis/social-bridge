# social-bridge

A lightweight bridge between AI agents and social platforms, starting with LinkedIn.

## V0

One Firebase HTTPS function with two routes:

- `GET /health`
- `POST /linkedin/post`

The publish route expects:

```json
{
  "text": "Hello LinkedIn"
}
```

and requires:

```text
Authorization: Bearer <SOCIAL_BRIDGE_KEY>
```

## Secrets

Create these Firebase secrets before deploying:

```bash
firebase functions:secrets:set SOCIAL_BRIDGE_KEY
firebase functions:secrets:set LINKEDIN_ACCESS_TOKEN
firebase functions:secrets:set LINKEDIN_AUTHOR_URN
```

`LINKEDIN_AUTHOR_URN` should be the authenticated member URN used as the post author.

## Deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

## Scope

V0 intentionally has no UI, database, scheduler, analytics, multi-user support, or OAuth flow. First milestone: publish one text post through the bridge.

OAuth, token renewal, images, scheduling, and additional networks come later.
