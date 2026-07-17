# Vernal 🌱

> *Your season starts here.*

Precision Growing Degree Day platform for home growers. Local sensors + GDD science + AI advice, delivered to your phone every morning.

## Monorepo Structure

```
vernal/
├── apps/
│   ├── api/          # Cloudflare Workers — ingest, GDD engine, advice API
│   └── web/          # React PWA — mobile-first dashboard (Cloudflare Pages)
├── packages/
│   └── gdd-core/     # Shared GDD calculation logic (used by api + pi-agent)
├── pi-agent/         # Python agent for Raspberry Pi Zero 2W
│   ├── agent/        # Sensor polling, SQLite buffer, uplink
│   ├── firmware/     # ATtiny85 sensor node firmware (PlatformIO)
│   └── setup/        # Pi provisioning scripts
├── migrations/       # D1 SQL migrations
├── scripts/          # Dev tooling and seed scripts
└── .github/
    └── workflows/    # CI/CD pipelines
```

## Quick Start

### Prerequisites
- Node.js 20+
- npm 10+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- Cloudflare account
- GitHub account

### 1. Clone and install

```bash
git clone https://github.com/GHaigh/vernal.git
cd vernal
npm install
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

### 3. Create Cloudflare resources

```bash
npm run cf:setup
```

This creates:
- D1 database (`vernal-db`)
- KV namespace (`vernal-sessions`)
- Cloudflare Queue (`vernal-advice-queue`)
- Vectorize index (`vernal-crops`)

### 4. Apply D1 migrations

```bash
npm run db:migrate
```

### 5. Start local development

```bash
npm run dev
```

- API Worker: http://localhost:8787
- Web app: http://localhost:5173

### 6. Deploy

```bash
npm run deploy
```

## Environment Variables

Copy `.dev.vars.example` to `apps/api/.dev.vars` for local development.

**Never commit `.dev.vars` or any file containing real secrets.**

## Hardware

See [`pi-agent/README.md`](pi-agent/README.md) for full Pi Zero 2W setup guide.

## Docs

- [Architecture overview](docs/architecture.md)
- [GDD engine](docs/gdd-engine.md)
- [Hardware build guide](docs/hardware.md)
- [Sensor node firmware](pi-agent/firmware/README.md)
