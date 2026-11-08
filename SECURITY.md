# Security setup and migration

## 1. Configure the GitHub outbox decryption secret

This repository remains public. The public RSA-OAEP-SHA256 encryption key is in `config/outbox-public.pem`. The matching RSA private key must be stored ONLY as the Actions secret `LINKEDIN_OUTBOX_PRIVATE_KEY`; it must not be committed, pasted into pull requests, sent to AI publishing agents, or included in logs.

On a trusted machine, using the matching private PEM file and GitHub CLI:

```bash
gh secret set LINKEDIN_OUTBOX_PRIVATE_KEY --repo aesgalexis/social-bridge < /secure/path/outbox-private.pem
```

If the original private key is unavailable, create a new RSA-3072 keypair on your own machine, replace the public key file and the GitHub Actions secret **together** before creating new sealed requests. When rotating keys, re-seal queued encrypted posts before replacing the old key. The client uses RSA-OAEP with SHA-256 to wrap a unique random AES-256-GCM key per post.

Draft posts should live in `drafts/` (ignored); referenced images must remain local. Never commit them directly to public `media/linkedin/`.

## 2. Configure administrative OAuth

The browser flow uses a separate `LINKEDIN_OAUTH_ADMIN_KEY`. Generate a high-entropy value on a trusted machine and store it in Google Secret Manager. Share access to this secret only with operators who may reauthorize LinkedIn. GitHub Actions and publishing agents do not need it.

```bash
PROJECT=social-bridge-7d433
REGION=europe-west1
BUCKET="$PROJECT-oauth-replay"
SA=$(gcloud functions describe socialBridge --gen2 --region="$REGION" --project="$PROJECT" --format="value(serviceConfig.serviceAccountEmail)")

openssl rand -hex 32 | tr -d '\n' | gcloud secrets create LINKEDIN_OAUTH_ADMIN_KEY --project="$PROJECT" --data-file=-
gcloud secrets add-iam-policy-binding LINKEDIN_OAUTH_ADMIN_KEY --project="$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding LINKEDIN_ACCESS_TOKEN --project="$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretVersionAdder"

gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=0s
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA" --role="roles/storage.objectCreator"
LIFECYCLE=$(mktemp)
printf '%s\n' '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' > "$LIFECYCLE"
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$LIFECYCLE"
rm "$LIFECYCLE"
```

The service account must retain Secret Manager access to the existing secrets. `LINKEDIN_AUTHOR_URN` identifies the only account that may reauthorize. To deliberately change accounts, an administrator must update that secret separately. The function adds versions only to `LINKEDIN_ACCESS_TOKEN`. Publishing and status read the latest versions at request time.

The private bucket holds short-lived replay markers. It stores no tokens, authorization codes, cookies or post content. The function creates each marker once with a generation precondition and rejects the callback if the state has already been consumed or the bucket is unavailable.

Deploy:

```bash
cd functions && npm ci && npm run check && cd ..
node --test scripts/linkedin-oauth.test.cjs
firebase deploy --only functions:socialBridge --project "$PROJECT"
```

Open `$SOCIAL_BRIDGE_URL/linkedin/auth` in a browser. Retrieve the admin key from Secret Manager on a trusted machine and enter it in the form. Complete authorization in that browser within ten minutes. The callback accepts a state only with its matching session cookie and returns a connection result. LinkedIn may require periodic interactive reauthorization.

## 3. Historical exposure and caveats

- The three legacy plaintext queue entries had `published` receipts; they were removed from the latest branch. Their content **still exists** in older commits and possibly forks/clones. Git removal does not erase public disclosure.
- If any unpublished draft was ever committed publicly, treat it as disclosed. If a credential was ever exposed anywhere, rotate/revoke it. These changes do not rotate credentials automatically.
- CI validates sealed envelope structure but deliberately does **not** decrypt with a private key. Outbox encryption prevents casual disclosure, not deletion from history or protection against a compromised CI runner or malicious person with repository admin access.
- Safeguard the `main` branch with review rules and restrict write permissions. A contributor with Git write access can still choose to expose a plaintext draft in another path, despite the intended workflow.
- After rollout, verify `/linkedin/status` and reauthorize from the browser. Use an approved post for an end-to-end publication check.
