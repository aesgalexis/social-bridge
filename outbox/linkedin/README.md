# LinkedIn encrypted outbox

Only `*.sealed.json` entries belong here. This repository is **public**. Do not commit unpublished plaintext posts, draft images, OAuth credentials, or any private key.

1. Save a local request in the ignored `drafts/` directory. Required fields: `{ "publish": true, "text": "..." }`. Optional `publishAt` must include an explicit timezone, and optional `image` may specify a local `media/linkedin/...` path and `altText`.
2. Run `node scripts/seal-linkedin-outbox.mjs drafts/post.json outbox/linkedin/<unique-name>.sealed.json`.
3. Commit only the sealed envelope. The content, scheduling time, and referenced image bytes are encrypted using the public key in `config/outbox-public.pem`.
4. GitHub Actions decrypts with the private repository secret `LINKEDIN_OUTBOX_PRIVATE_KEY`, publishes due requests, and writes a non-secret delivery receipt under `receipts/linkedin/`.

The scheduler runs every 15 minutes. A durable claim protects against accidental duplicate retries after ambiguous failures. Read `SECURITY.md` for required setup and known limitations.

Older plaintext posts were removed from the current tree but **remain in public Git history**.
