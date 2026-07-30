# Sow Now — Marketing Site (sow-now.uk)

Static HTML site deployed to Cloudflare Pages.

## Cloudflare Pages config

| Setting | Value |
|---------|-------|
| Project name | `sow-now-marketing` |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | *(leave blank — static HTML, no build step)* |
| Build output directory | `apps/marketing` |
| Root directory | `/` |

## Custom domain

In Cloudflare Pages → Custom domains → add `sow-now.uk` and `www.sow-now.uk`

## Pages

| File | URL |
|------|-----|
| `index.html` | `sow-now.uk` |
| `privacy.html` | `sow-now.uk/privacy` |
| `terms.html` | `sow-now.uk/terms` |

## Notes

- Zero JavaScript — pure HTML + CSS
- No external dependencies or CDN calls
- No tracking cookies
- Loads in under 1 second on 3G
