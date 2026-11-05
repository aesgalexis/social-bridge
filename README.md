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

The maintainer must finish two one-time setup tasks before merging and deploying this change:

1. Configure the GitHub Actions secret `LINKEDIN_OUTBOX_PRIVATE_KEY` with the private key matching `config/outbox-public.pem`. The Actions runner refuses to decrypt without it.
2. Grant the deployed Firebase function service account Secret Manager `roles/secretmanager.secretVersionAdder` on the existing `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_AUTHOR_URN` secrets, then deploy the updated Firebase function. Status and publishing now read the latest secret versions from Google Cloud at request time.

See **[SECURITY.md](SECURITY.md)** for the exact commands, key handling, deployment and migration caveats. This branch intentionally fails closed if its required secrets and IAM access are absent.

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
- `POST /linkedin/auth` — **requires** `Authorization: Bearer <SOCIAL_BRIDGE_KEY>`; returns a short-lived authorization URL, not an access token
- `GET /linkedin/callback` — LinkedIn redirect; persists new credentials server-side, never returns them
- `GET /linkedin/status` — requires bridge key; validates current connected author
- `POST /linkedin/post` — requires bridge key; publishes text or one image

Direct publishing:

```bash
curl -X POST "$SOCIAL_BRIDGE_URL/linkedin/post" \
  -H "Authorization: Bearer $SOCIAL_BRIDGE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello LinkedIn"}'
```

OAuth initiation (after deploying and granting the required Secret Manager IAM permissions):

```bash
curl -sS -X POST "$SOCIAL_BRIDGE_URL/linkedin/auth" \
  -H "Authorization: Bearer $SOCIAL_BRIDGE_KEY"
```

Open the returned `authorizationUrl` in a browser within ten minutes. The callback shows only a connection result, not the token. `GET /linkedin/auth` is disabled.

## Deploy and tests

```bash
cd functions
npm ci
npm run check
cd ..
node --test scripts/linkedin-request.test.mjs scripts/sealed-outbox.test.mjs
node scripts/validate-linkedin-outbox.mjs
firebase deploy --only functions
```

The Firebase project is configured in `.firebaserc` (`social-bridge-7d433`). Secret names already used by the function: `SOCIAL_BRIDGE_KEY`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN`, and `LINKEDIN_CLIENT_SECRET`.

## Scope

Social Bridge stays intentionally small: no dashboard or multi-user system. Additional networks and features should preserve the separation between public agent requests, private delivery keys, and platform credentials.
