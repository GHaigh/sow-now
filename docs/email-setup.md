# Email Sending Setup — Sow Now

Magic link authentication emails are sent via Cloudflare Email Service using the Workers binding.

## Prerequisites

1. **Domain must be onboarded** to Cloudflare Email Service before first send.
2. **SPF/DKIM/DMARC** records must be configured for deliverability.

## One-time Setup

### 1. Enable Email Sending for sow-now.uk

```bash
cd apps/api
npx wrangler email sending enable sow-now.uk
```

This adds the required DNS records.  Verify propagation:

```bash
npx wrangler email sending verify sow-now.uk
```

### 2. Configure DKIM, SPF, DMARC

After enabling, Cloudflare will prompt you to add DNS records in the dashboard:

| Type | Name | Value |
|------|------|-------|
| TXT | `@` | `v=spf1 include:_spf.cloudflare.com ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hello@sow-now.uk` |
| CNAME | `cf._domainkey` | (Cloudflare provides this — add as-is) |

All three are managed by Cloudflare since the domain uses Cloudflare DNS.

### 3. Deploy the Worker

```bash
cd apps/api
npx wrangler deploy
```

The `send_email` binding in `wrangler.jsonc` is automatically active after deploy.

## Secrets to set

```bash
cd apps/api
# Stripe
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_GROWER
npx wrangler secret put STRIPE_PRICE_SMALLHOLDER
```

`STRIPE_PRICE_GROWER` and `STRIPE_PRICE_SMALLHOLDER` are the Stripe Price IDs
(format: `price_xxxxxxxx`) from your Stripe dashboard Products page.

## Setting up the Stripe webhook

1. In Stripe dashboard → Developers → Webhooks → Add endpoint:
   - URL: `https://api.sow-now.uk/api/v1/webhooks/stripe`
   - Events: `checkout.session.completed`, `invoice.payment_succeeded`,
     `customer.subscription.deleted`, `customer.subscription.updated`

2. Copy the **Signing Secret** and set it:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

## Testing locally

Magic links are logged to console when `ENVIRONMENT != production`:

```
[DEV] Magic link for user@example.com: https://app.sow-now.uk/#session=...
```

For end-to-end email testing in preview, set `ENVIRONMENT=production` in
`.dev.vars` and use a real email address you control.
