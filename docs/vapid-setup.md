# Web Push / VAPID Setup — Sow Now

Push notifications are sent via the Web Push protocol using a zero-dependency
implementation in `apps/api/src/lib/webpush.ts`. VAPID authentication requires
three secrets that must be set in the Cloudflare Worker's secret store before
deploying to production.

---

## Step 1 — Generate the VAPID key pair

Run the generator script once from the `vernal/` directory:

```bash
cd vernal
node scripts/gen-vapid.mjs
```

The script prints:
- `VAPID_PUBLIC_KEY` — URL-safe base64 uncompressed P-256 public key
- `VAPID_PRIVATE_KEY` — URL-safe base64 raw private key scalar

**Keep both values safe.** The public key is also baked into the web app
(see `apps/web/src/lib/api.ts` → `VAPID_PUBLIC_KEY` constant). If you ever
rotate the key pair you must update that constant and redeploy the PWA so
browsers re-subscribe.

---

## Step 2 — Set the three secrets via wrangler

```bash
cd vernal

# Paste the VAPID_PUBLIC_KEY value when prompted
npx wrangler secret put VAPID_PUBLIC_KEY --name sow-now-api

# Paste the VAPID_PRIVATE_KEY value when prompted
npx wrangler secret put VAPID_PRIVATE_KEY --name sow-now-api

# Set the VAPID subject — must be a mailto: or https: URI that identifies
# the push service operator (you). Cloudflare sends this in the JWT claim.
npx wrangler secret put VAPID_SUBJECT --name sow-now-api
# Enter: mailto:hello@sow-now.uk
```

> **Note:** `--name sow-now-api` must match the `name` field in
> `apps/api/wrangler.jsonc`. Omit if your current directory already
> has `wrangler.jsonc` configured.

---

## Step 3 — Verify

After deploying the Worker, check the Push section in Settings. Subscribe to
notifications and confirm a push arrives after the next daily advice cron
(05:30 UTC).

To test immediately, post a message directly to the advice queue:

```bash
npx wrangler queues message send vernal-advice-queue \
  --message '{"userId":"<your-user-id>"}' \
  --name sow-now-api
```

---

## Key rotation

1. Generate a new key pair with `node scripts/gen-vapid.mjs`
2. Update `VAPID_PUBLIC_KEY` in `apps/web/src/lib/api.ts`
3. Re-deploy the PWA so users receive the new key on next visit
4. Set the new secrets with `wrangler secret put` (as above)
5. Re-deploy the Worker
6. All existing push subscriptions will fail with HTTP 410 and will be
   auto-cleaned by `apps/api/src/queue/advice-consumer.ts` on next send.
   Users must re-subscribe once the new key is live.
