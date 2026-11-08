<p align="center">
  <img src="assets/social%20bridge%20logo.png" alt="Social Bridge" width="180" />
</p>

# social-bridge

A small bridge between AI agents and social networks, initially LinkedIn. Agents can request approved posts without receiving LinkedIn credentials or GitHub Actions secrets.

## Secure publishing architecture

```text
Approved local draft (never committed)
  -> scripts/seal-linkedin-outbox.mjs + public encryption key
  -> outbox/linkedin/*.sealed.json (public GitHub repo, encrypted)
  -> GitHub Actions (private decryption key)
  -> delivery claim / receipt in Git
  -> Firebase HTTPS Function (bridge key)
  -> LinkedIn REST API (access token held in Google Secret Manager)
```

Only the encrypted post request is published in Git. The text, future scheduling time, and any image bytes are hidden inside authenticated ciphertext. The public key can be shared with AI agents, but **the private key must never be committed or given to an agent**.

## First-time activation

Before merging and deploying, configure the matching `LINKEDIN_OUTBOX_PRIVATE_KEY` Actions secret, the separate Firebase OAuth admin key, and the permissions for token renewal and replay protection.

See [SECURITY.md](SECURITY.md) for setup, deployment and migration details.

## Authoring an approved post

Create a local `drafts/post.json` (the entire `drafts/` directory is ignored by Git):

```json
{
  "publish": true,
  "publishAt": "2026-11-10T09:30:00+01:00",
  "text": "Hello LinkedIn!"
}
```

Optional image:

```json
{
  "publish": true,
  "text": "Text with an image",
  "image": {
    "path": "media/linkedin/local-picture.png",
    "altText": "A descriptive alt text"
  }
}
```

The image file must remain local and **must not be committed**. Encryption embeds the image bytes in the sealed request. Supported image types are JPG, PNG and GIF, up to 12 MiB.

```bash
node scripts/seal-linkedin-outbox.mjs drafts/post.json outbox/linkedin/my-post.sealed.json
git add outbox/linkedin/my-post.sealed.json
git commit -m "Queue approved LinkedIn post"
git push
```

New sealed files on `main` trigger immediate publishing if due. Scheduled requests are scanned every 15 minutes; `publishAt` is a not-before time rather than a guarantee of exact delivery.

## Delivery safety

Before publishing, the GitHub runner stores a durable claim under `receipts/linkedin/`. Successful publication updates it to `published`. Ambiguous failures remain claimed or become `attention_required`, so automated runs do not blindly retry and duplicate posts.

Receipt metadata contains no post text or credential. Previous unencrypted outbox entries have been removed from the current tree, but their public Git history still exists.

## Firebase API

- `GET /health` — public liveness
- `GET /linkedin/auth` — opens the admin sign-in form
- `POST /linkedin/auth` — starts OAuth from that form with the separate admin key
- `GET /linkedin/callback` — LinkedIn redirect, accepts a matching browser session once and renews the token server-side
- `GET /linkedin/status` — requires bridge key; validates current connected author
- `POST /linkedin/post` — requires bridge key; publishes text or one image

Direct publishing:

```bash
curl -X POST "$SOCIAL_BRIDGE_URL/linkedin/post" \
  -H "Authorization: Bearer $SOCIAL_BRIDGE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello LinkedIn"}'
```

For reauthorization, open `$SOCIAL_BRIDGE_URL/linkedin/auth` in a browser, enter the OAuth admin key and complete LinkedIn authorization in the same browser within ten minutes.

## Deploy and tests

```bash
cd functions
npm ci
npm run check
cd ..
node --test scripts/linkedin-oauth.test.cjs scripts/linkedin-request.test.mjs scripts/sealed-outbox.test.mjs
node scripts/validate-linkedin-outbox.mjs
firebase deploy --only functions
```

The Firebase project is configured in `.firebaserc` (`social-bridge-7d433`). Secret names already used by the function: `SOCIAL_BRIDGE_KEY`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_OAUTH_ADMIN_KEY`.

## Scope

Social Bridge stays intentionally small: no dashboard or multi-user system. Additional networks and features should preserve the separation between public agent requests, private delivery keys, and platform credentials.
