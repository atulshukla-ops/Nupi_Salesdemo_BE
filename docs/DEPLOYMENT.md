# Deployment note: Sales Demo Room backend (for DevOps)

This backend deploys the same way as **be-admin-portal**: Docker containers on the existing QA/production server, behind the existing nginx. You don't need a new server, a new database server or new tools.

> **Summary for DevOps.** Add two containers from one image (`api` + `worker`). Create one new database on the existing PostgreSQL server. Add one nginx location that also allows WebSocket upgrades. Then apply the AWS changes in [AWS_REQUEST.md](AWS_REQUEST.md).

---

## 1. What runs

| Container | Command | Port | Notes |
|---|---|---|---|
| `sales_demo_api` | `node build/index.js` | 8130 (configurable via `PORT`) | REST API at `/api/*`, live relay WebSocket at `/sync`, health at `/health` |
| `sales_demo_worker` | `node build/worker.js` | none | Video conversion (ffmpeg) + nightly cleanup at 02:00 IST. Uses CPU while converting. |
| `migrate` (one-off) | `npm run migration:run:prod` | none | Applies database migrations. Run it before starting a new version. |

**Image facts:**

| Item | Value |
|---|---|
| Base | `node:24-bookworm-slim`. Node 24 is LTS, supported until April 2028; Node 20, used by be-admin-portal, reached end-of-life in April 2026. |
| Extra packages | System `ffmpeg` and `tini` |
| Runs as | Non-root user `node` (uid 1000) |
| Build | Multi-stage: the TypeScript build happens in the image, and only the compiled JavaScript and production packages ship. No `nodemon`. |
| Secrets | None in the image. All settings come from `.env` at run time. |

**Sizing:**

| Container | Resources |
|---|---|
| API | Light (about 150 MB RAM) |
| Worker | About 1–2 CPU cores and 1 GB RAM while converting a video. Idle otherwise. |
| Disk | Temporary space for one video being converted, up to about 2× the largest upload (4 GB) |

The worker can run on the same server as other services. To limit it, add `cpus: "1.5"` to the worker service.

---

## 2. One-time setup

### 2.1 Database (on the existing PostgreSQL server)

```sql
CREATE DATABASE nupi_salesdemo;
-- a dedicated user is recommended:
CREATE USER sales_demo WITH PASSWORD '<generate>';
GRANT ALL PRIVILEGES ON DATABASE nupi_salesdemo TO sales_demo;
\c nupi_salesdemo
GRANT ALL ON SCHEMA public TO sales_demo;
```

- The user needs to create tables (migrations) and one schema `pgboss` (the job queue creates it on first start).
- Nothing touches any other database.
- Tables created: `T_SDR_Workspace_Settings`, `T_SDR_Products`, `T_SDR_Assets`, `T_SDR_Demos`, `T_SDR_Demo_Sessions`, `T_SDR_Migrations`, plus the `pgboss` schema.

### 2.2 Code and settings on the server

```bash
git clone https://github.com/atulshukla-ops/Nupi_Salesdemo_BE.git
cd Nupi_Salesdemo_BE
cp .env.example .env     # fill in as in section 3
mkdir -p /var/log/sales-demo && chown 1000:1000 /var/log/sales-demo
echo "LOG_DIR=/var/log/sales-demo" >> .env
```

### 2.3 First start

```bash
docker compose build
docker compose run --rm migrate    # creates the tables
docker compose up -d               # starts api + worker
curl http://localhost:8130/health  # {"status":"UP",...}
```

---

## 3. Settings (`.env` on the server)

| Variable | QA example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Hides internal error details from responses |
| `PORT` | `8130` | Pick a free port if 8130 is taken |
| `PUBLIC_BASE_URL` | `https://minineotest.nupipay.com/sales-demo` | **Public** address of this API, as browsers see it, including any path prefix. The relay address is derived from it (`wss://…/sales-demo/sync`). |
| `CORS_ORIGINS` | `https://<frontend QA domain>` | Comma-separated frontend addresses. Only these can call the API or open the relay from a browser. |
| `TRUST_PROXY_HOPS` | `1` | Number of proxies in front (nginx = 1, a load balancer plus nginx = 2). Needed so rate limits see real client IPs. |
| `API_DOCS` | `true` on QA, `false` on production | Swagger at `/api-docs` |
| `TEAM_KEY` | 24+ random chars | Shared key for the presenter app. Give it to the sales team by a secure channel. |
| `HOST_TOKEN_SECRET` | 48+ random chars | Signs live console tokens. Never shared. |
| `DB_HOST` / `DB_PORT` | DB server address / `5432` | `localhost` does **not** work inside a container. Use the server address, or `host.docker.internal` when PostgreSQL runs on the same machine. |
| `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | `sales_demo` / … / `nupi_salesdemo` | |
| `STORAGE_DRIVER` | `local` now → `s3` after the AWS setup | |
| `S3_BUCKET` / `AWS_REGION` / `STORAGE_PREFIX` | `storagenupi` / `ap-south-1` / `sales-demo` | Used once `STORAGE_DRIVER=s3`. The app never reads, writes or deletes anything outside `STORAGE_PREFIX/`. |
| AWS credentials | *(none)* | Best: the server's IAM role (nothing to set). Otherwise `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. |
| `CLOUDFRONT_DOMAIN` / `CLOUDFRONT_KEY_PAIR_ID` / `CLOUDFRONT_PRIVATE_KEY` | `dxxxx.cloudfront.net` / `K2…` / PEM | Set all three for CloudFront playback links, or none (then S3 presigned links are used). Write the PEM on one line with `\n` for line breaks. **Use CloudFront in production:** S3 presigned links signed with an IAM role only last until the role's credentials rotate (a few hours). The domain must be the bare host name, without a path. |
| `S3_ENDPOINT` | *(empty)* | Only for an S3-compatible test server; leave empty on AWS |
| `WORKER_CONCURRENCY` | `1` | Videos converted at the same time |

Generate the secrets with `openssl rand -base64 36`.

The full list, with comments, is in `.env.example`. The API refuses to start if the team key, the host token secret or the database name is missing.

---

## 4. nginx (same server as be-admin-portal)

Add one location next to the existing ones. The WebSocket upgrade lines are **required**, because the live demo relay runs at `/sync`.

```nginx
# Sales Demo Room API + live relay
location /sales-demo/ {
    proxy_pass http://127.0.0.1:8130/;          # trailing slash strips the /sales-demo prefix
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # WebSocket (/sync)
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;                    # live demos keep one connection open for hours
    proxy_send_timeout 3600s;
    client_max_body_size 20m;                    # only matters while STORAGE_DRIVER=local (16 MB upload parts)
}
```

The `$connection_upgrade` variable must be defined once, in the `http {}` block:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

**Other proxies in the path:**
- A **load balancer** (AWS ALB) in front supports WebSockets by default. Set its **idle timeout to at least 120 s**; the relay sends a heartbeat every 30 s.
- A corporate proxy or firewall needs nothing special: the relay uses normal `wss://` on port 443.
- **Run only one API container.** Live rooms are kept in memory, so the console and viewers of one demo must reach the same API. Scaling out later would need sticky routing or a shared broker.

---

## 5. Updating to a new version

```bash
git pull
docker compose build
docker compose run --rm migrate      # safe to run every time: does nothing when there is nothing new
docker compose up -d                 # recreates api + worker
```

**What happens during a restart:**
- **API:** open requests finish, live consoles and viewers are told to reconnect (code 1012), and the frontend reconnects by itself.
- **Worker:** a video conversion in progress is retried after the restart.
- Uploads in progress continue, because parts go directly to storage.

**Rollback:** check out the previous tag/commit, then `docker compose build && docker compose up -d`. If a migration must be undone: `docker compose run --rm migrate npm run migration:revert` (only with the developer's OK).

---

## 6. Checks after deploying

| Check | Expected |
|---|---|
| `curl https://<host>/sales-demo/health` | `{"status":"UP"}` |
| `https://<host>/sales-demo/api-docs` (QA) | Swagger page |
| `docker compose logs worker` | `Worker ready (1 video job(s) at a time, production)` |
| Upload a short video in the app | The status goes uploading → processing → ready |
| Open a demo console and its `/watch/<slug>` link on another network (phone hotspot) | The viewer follows the console within about 1 s |

---

## 7. Logs and monitoring

- **Files:** `LOG_DIR/all-YYYY-MM-DD.log` and `error-YYYY-MM-DD.log`, rotated daily (the same logger setup as be-admin-portal).
- **Health:** `GET /health` for uptime monitoring. The API container also has a Docker healthcheck.
- **Signals worth an alert:** repeated `failed after N attempts` (worker), and `Cannot start` / `Worker cannot start` (bad settings or DB unreachable).
