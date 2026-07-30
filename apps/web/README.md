# Sow Now — Web App (Cloudflare Pages)

Mobile-first React PWA. Deployed to `app.sow-now.uk` via Cloudflare Pages.

## Pages config (set in Cloudflare dashboard)

| Setting | Value |
|---------|-------|
| Build command | `npm run build --workspace=apps/web` |
| Build output directory | `apps/web/dist` |
| Root directory | `/` |
| Node.js version | `20` |

## Custom domain

In Cloudflare Pages → Custom domains → add `app.sow-now.uk`

## Local dev

```bash
cd /path/to/sow-now
npm run dev --workspace=apps/web
# Opens at http://localhost:5173
```
