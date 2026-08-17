# Email Sending Setup — Sow Now

Magic link authentication emails are sent via [Resend](https://resend.com) using their REST API directly from the Worker. No npm package is used — the Worker calls `https://api.resend.com/emails` with a `Bearer` token.

## Prerequisites

1. A Resend account (free tier: 3,000 emails/month, 100/day).
2. **Domain verified in Resend** — add the DNS records Resend provides for `sow-now.uk`.
3. The `RESEND_API_KEY` secret set on the Worker (see below).

## One-time Setup

### 1. Create a Resend account and add the domain

1. Sign up at [resend.com](https://resend.com)
2. Go to **Domains → Add Domain** and enter `sow-now.uk`
3. Resend will give you DNS records to add — add them in the Cloudflare DNS dashboard for `sow-now.uk`:

| Type | Name | Value |
|------|------|-------|
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@sow-now.uk` |
| CNAME | `resend._domainkey` | (Resend provides this — add as-is) |

4. Once DNS propagates, click **Verify** in the Resend dashboard. Status will turn green.

### 2. Get your API key

In the Resend dashboard → **API Keys → Create API Key**.

Name it `sow-now-production`. Set permission to **Sending access**.

Copy the key — it is only shown once.

### 3. Set the secret on the Worker

```bash
cd apps/api
npx wrangler secret put RESEND_API_KEY
# paste the key when prompted
```

### 4. Deploy the Worker

```bash
cd apps/api
npx wrangler deploy
```

## All secrets to set

```bash
cd apps/api

# Email
npx wrangler secret put RESEND_API_KEY

# Stripe
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_GROWER
npx wrangler secret put STRIPE_PRICE_SMALLHOLDER

# Device JWT signing key (generate a strong random string, e.g. openssl rand -hex 32)
npx wrangler secret put DEVICE_JWT_SECRET

# Web Push VAPID keys (see docs/vapid-setup.md once generated)
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

`STRIPE_PRICE_GROWER` and `STRIPE_PRICE_SMALLHOLDER` are the Stripe Price IDs
(format: `price_xxxxxxxx`) from your Stripe dashboard Products page.

## Setting up the Stripe webhook

1. In Stripe dashboard → **Developers → Webhooks → Add endpoint**:
   - URL: `https://api.sow-now.uk/api/v1/webhooks/stripe`
   - Events: `checkout.session.completed`, `invoice.payment_succeeded`,
     `customer.subscription.deleted`, `customer.subscription.updated`

2. Copy the **Signing Secret** and set it:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

## Testing locally

Magic links are logged to the Wrangler dev console when `ENVIRONMENT != production`:

```
[DEV] Magic link for user@example.com: https://app.sow-now.uk/#session=...
```

For end-to-end email testing locally, set `ENVIRONMENT=production` in
`apps/api/.dev.vars` and use a real email address you control. Resend will
deliver the email normally.

## How email sending works in the code

[`apps/api/src/routes/auth.ts`](../apps/api/src/routes/auth.ts) — `sendEmail()` function:

```
POST https://api.resend.com/emails
Authorization: Bearer <RESEND_API_KEY>
{
  "from": "Sow Now <hello@sow-now.uk>",
  "to": ["user@example.com"],
  "subject": "Your Sow Now sign-in link",
  "html": "...",
  "text": "..."
}
```

Delivery errors are logged server-side only — the magic-link endpoint always
returns `{ ok: true }` regardless of delivery outcome to avoid leaking whether
an email address is registered.
