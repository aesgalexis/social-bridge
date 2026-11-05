# Security setup and migration

## 1. Configure the GitHub outbox decryption secret

This repository remains public. The public RSA-OAEP-SHA256 encryption key is in `config/outbox-public.pem`. The matching RSA private key must be stored ONLY as the Actions secret `LINKEDIN_OUTBOX_PRIVATE_KEY`; it must not be committed, pasted into pull requests, sent to AI publishing agents, or included in logs.

On a trusted machine, using the matching private PEM file and GitHub CLI:

```bash
gh secret set LINKEDIN_OUTBOX_PRIVATE_KEY --repo aesgalexis/social-bridge < /secure/path/outbox-private.pem
```

If the original private key is unavailable, create a new RSA-3072 keypair on your own machine, replace the public key file and the GitHub Actions secret **together** before creating new sealed requests. When rotating keys, re-seal queued encrypted posts before replacing the old key. The client uses RSA-OAEP with SHA-256 to wrap a unique random AES-256-GCM key per post.

Draft posts should live in `drafts/` (ignored); referenced images must remain local. Never commit them directly to public `media/linkedin/`.

## 2. Grant Google Cloud permissions for LinkedIn OAuth

Previously the callback returned `accessToken` in the browser for manual Secret Manager setup. It now saves credentials server-side by adding secret versions and shows only a status message. The execution service account needs permission to add versions to **both** existing secrets.

```bash
PROJECT=social-bridge-7d433
SA=$(gcloud functions describe socialBridge --gen2 --region=europe-west1 --project="$PROJECT" --format="value(serviceConfig.serviceAccountEmail)")
for SECRET in LINKEDIN_ACCESS_TOKEN LINKEDIN_AUTHOR_URN; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project="$PROJECT" \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretVersionAdder"
done
```

The service account must also retain Secret Manager **Secret Accessor** on both secrets. Existing Firebase `defineSecret` bindings remain in the function. The function now reads the **latest** versions for posting/status rather than depending on a stale secret injected at startup.

Deploy:

```bash
cd functions && npm ci && npm run check && cd ..
firebase deploy --only functions
```

For reauthorization, run this on your trusted computer (without putting the bridge key in a URL):

```bash
curl -sS -X POST "$SOCIAL_BRIDGE_URL/linkedin/auth" \
  -H "Authorization: Bearer $SOCIAL_BRIDGE_KEY"
```

Open the returned `authorizationUrl` in a browser within 10 minutes. Successful callback responses contain NO access token. If Secret Manager IAM is missing, the callback fails without displaying a token. LinkedIn may still require periodic interactive reauthorization because token refresh availability varies by LinkedIn partner approval.

## 3. Historical exposure and caveats

- The three legacy plaintext queue entries had `published` receipts; they were removed from the latest branch. Their content **still exists** in older commits and possibly forks/clones. Git removal does not erase public disclosure.
- If any unpublished draft was ever committed publicly, treat it as disclosed. If a credential was ever exposed anywhere, rotate/revoke it. These changes do not rotate credentials automatically.
- CI validates sealed envelope structure but deliberately does **not** decrypt with a private key. Outbox encryption prevents casual disclosure, not deletion from history or protection against a compromised CI runner or malicious person with repository admin access.
- Safeguard the `main` branch with review rules and restrict write permissions. A contributor with Git write access can still choose to expose a plaintext draft in another path, despite the intended workflow.
- Until both the GitHub private key and the Google Cloud secret IAM permissions are configured, the changed workflows may fail closed. Verify `/linkedin/status` and perform one controlled post after rollout.
