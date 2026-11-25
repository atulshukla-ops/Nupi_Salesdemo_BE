# Nupi_Salesdemo_BE

Backend for the **NupiPay Sales Demo Room**. It covers:
- the shared demo library: products, videos, and later decks;
- video upload and processing;
- client demos and Standard Flows;
- the live sync relay between the presenter console and client viewers.

Frontend: `nupipay-demo-room`.

Conventions follow `be-admin-portal`: Express + TypeScript, route → controller → service, Joi validators, `AppError` + a global error handler, the `successCallback` envelope, and winston logs.

## Documentation

| Document | For |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works: components, code flow, local setup, every feature flow (with diagrams) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | DevOps: Docker, settings, database, nginx (WebSocket), updates, checks |
| [docs/AWS_REQUEST.md](docs/AWS_REQUEST.md) | DevOps: the S3 / CloudFront / IAM changes, costs, rollback |
| `http://localhost:8130/api-docs` | Swagger: every endpoint, try it with the team key |

## Run locally

Requires Node.js 22.13+ and a PostgreSQL server (the local one is fine). ffmpeg comes with `npm install`. PowerPoint decks need LibreOffice installed; PDF decks don't.

```bash
npm install
cp .env.example .env      # then fill in DB_*, TEAM_KEY and HOST_TOKEN_SECRET
npm run migration:run     # creates the T_SDR_* tables
npm run dev               # API on http://localhost:8130
npm run dev:worker        # second terminal: video processing + nightly cleanup
```

Check that it is up: `GET http://localhost:8130/health` → `{"status":"UP", ...}`

| Script | What it does |
| --- | --- |
| `npm run dev` | API with auto-reload |
| `npm run dev:worker` | Background worker: processes uploaded videos and runs the nightly cleanup (02:00 IST). Run it next to `npm run dev`. |
| `npm test` | Automated tests (no database or running server needed) |
| `npm run cleanup:now` | Runs the nightly cleanup once, immediately |
| `npm run migration:show` / `migration:run` / `migration:revert` | Database migrations (review before running) |
| `npm run migration:show:prod` / `migration:run:prod` | The same, from the compiled `build/` (servers, Docker) |
| `npm run typecheck` | TypeScript check, no output |
| `npm run build` / `npm start` / `npm run start:worker` | Compile to `build/` and run the API or worker |

## Docker (servers)

```bash
docker compose build
docker compose run --rm migrate   # database migrations
docker compose up -d              # api + worker
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Responses: success `{ status, act, message, data }`; errors `{ status, statusCode, message }`.
