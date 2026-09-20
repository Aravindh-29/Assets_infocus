# INFOCUS Asset Management

INFOCUS's internal asset accountability application, built with React 19, TypeScript, Express 5, Prisma 6, and PostgreSQL. Register equipment, track custody, transfer or return it, handle incidents and repairs, and account for outstanding equipment during employee offboarding. PostgreSQL retains assignment records, lifecycle history, and audit logs.

This guide covers local development, database creation, and the Linux installer that adds an Nginx site for your domain. For server operations, DNS, HTTPS, updates, and backups, see [deployment instructions](docs/DEPLOYMENT.md) and [database operations](docs/DATABASE.md).

## 1. Prerequisites

For local development install:

- Node.js 22.12 or later in the 22.x line, or Node.js 24, with npm. This machine uses Node.js 24.
- PostgreSQL 17, running locally, including the `psql` client. The existing PostgreSQL Windows service is used directly; Docker is optional.
- A terminal: PowerShell on Windows; Bash on Linux/macOS. The full server installer targets Ubuntu/Debian with systemd.

Check the tools in PowerShell:

```powershell
node --version
npm.cmd --version
Get-Service *postgres*
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' --version
```

Use your actual PostgreSQL installation path if different. The database helper can discover standard Windows PostgreSQL installations; the database server must already be running.

## 2. Configure local development

The configured development database is **asset_management**. Automated API tests use **asset_management_test**. The pre-existing `psh_ticketing` database is unrelated and is not used or modified by this application.

From the repository root, install the exact dependency versions in `package-lock.json`. If this application is already running, stop its API/dev terminal before `npm ci` or `db:generate`; Windows can lock Prisma's engine DLL while it is in use. Restart after setup. Copy example environment files only if your real files do not already exist:

```powershell
cd C:\Users\aravi\OneDrive\Desktop\AssetManagement
npm.cmd ci
if (-not (Test-Path -LiteralPath backend/.env)) {
    Copy-Item -LiteralPath backend/.env.example -Destination backend/.env
}
if (-not (Test-Path -LiteralPath frontend/.env)) {
    Copy-Item -LiteralPath frontend/.env.example -Destination frontend/.env
}
notepad backend/.env
```

For Bash, use `npm` instead of `npm.cmd`; copy with `[ -f backend/.env ] || cp backend/.env.example backend/.env` and the equivalent for `frontend/.env`.

Set `backend/.env` to your own local PostgreSQL credentials and fresh secrets:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=5000
DATABASE_URL=postgresql://postgres:YOUR_URL_ENCODED_PASSWORD@localhost:5432/asset_management?schema=public
JWT_SECRET=REPLACE_WITH_FIRST_RANDOM_SECRET
JWT_REFRESH_SECRET=REPLACE_WITH_SECOND_RANDOM_SECRET
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
REMEMBER_TOKEN_EXPIRES_IN=30d
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
APP_URL=http://localhost:5173
TRUST_PROXY_HOPS=0
LOG_LEVEL=info
```

Generate two independent random secrets, then paste the values into the two JWT fields. Run this command twice:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Both JWT secrets must be at least 32 characters and should be different. URL-encode special characters in the **username/password components** of `DATABASE_URL`; for example `@` in a password becomes `%40`. Do not URL-encode the entire connection URL. Never commit real `.env` files.

Keep `frontend/.env` as:

```dotenv
VITE_API_URL=/api
```

`SESSION_SECRET` and `CLIENT_URL` from the earlier sample configuration are **not used** by this application. Authentication uses `JWT_SECRET` and `JWT_REFRESH_SECRET`; browser origins and generated links use `CORS_ORIGIN` and `APP_URL`. Never put database credentials or JWT secrets in a `VITE_` variable: those values become public browser code.

## 3. Create the database and schema

The new setup helper connects to PostgreSQL, checks the target database, creates it when missing, and reuses it when present. It applies the committed Prisma migrations and verifies the schema. It does not drop databases, reset data, or insert demo users.

On Windows, from the repository root:

```powershell
npm.cmd run db:generate
node scripts/setup-db.mjs --env-file backend/.env
```

On Linux/macOS, or from a configured Bash terminal:

```bash
npm run db:generate
bash scripts/setup-db.sh --env-file backend/.env
```

The Bash entry point invokes the same Node helper, so the checks and migration behavior are shared. Run `npm ci` and generate the Prisma client first; the database helper does not generate it or replace its engine files. By default, the administrative connection uses PostgreSQL user `postgres`, database `postgres`, and the target URL's host/port; it can reuse the URL password when the URL user is also `postgres`. For a different administrative account, set the `PG_ADMIN_*` options described in [database setup options](docs/DATABASE.md#database-creation-and-schema-setup). The helper refuses to take over a database owned by another role or a nonempty database without this application's migration history.

For local sample data, run this **after** setup:

```powershell
npm.cmd run db:seed
```

Seeding is optional. Without it, create the first administrator using `npm.cmd run admin:create -w backend`. For a production deployment, use that administrator bootstrap and never run the demo seed.

## 4. Start the application

```powershell
npm.cmd run dev
```

Open [http://localhost:5173](http://localhost:5173). The backend API is [http://127.0.0.1:5000/api](http://127.0.0.1:5000/api). Vite proxies `/api` to the backend. Keep the terminal open; Ctrl+C stops both development processes.

Verify the API and database from another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/health
```

A healthy response contains `success: true`, `status: "ok"`, and `database: "connected"`.

After the first setup, you only need `npm.cmd run dev` to start again. The optional `powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1` generates Prisma, applies pending migrations, and starts both processes; create the database and configure `.env` first. A background instance started during the original local setup can be stopped with `scripts/stop-local.ps1`.

To use a different API port, change `PORT` in `backend/.env` and set Vite's proxy target before starting:

```powershell
$env:API_PROXY_TARGET = 'http://127.0.0.1:5002'
npm.cmd run dev
```

The frontend uses port 5173 with strict port selection. If changing it, update the Vite port and `CORS_ORIGIN`/`APP_URL` together. Do not stop unrelated applications merely because they occupy a port.

## Development accounts

These credentials are for the seeded local development environment only.

| Role          | Email                    | Password        |
| ------------- | ------------------------ | --------------- |
| Administrator | admin@example.com        | Admin@12345!    |
| Asset Manager | assetmanager@example.com | Manager@12345!  |
| Employee      | employee@example.com     | Employee@12345! |

The seed creates 10 employees, 20 assets, 5 categories, 4 departments, 3 locations, and representative history. Rerunning it preserves existing assets and passwords. Seeding is refused outside development/test. Never load these accounts into production. Use the first-admin bootstrap described below for a clean production database.

## Features

- Email/employee-ID login, refresh sessions, role-based permissions, account management, password changes and recovery.
- Asset inventory with search, filters, pagination, sorting, column visibility, selection, and exports.
- Registration, assignment, transfer, return, location movement, controlled status transitions, soft deletion/restoration.
- Employee profiles with current equipment and custody history; offboarding with outstanding-item checks.
- Repair records, maintenance, damage/loss/return/transfer requests, warranty tracking, and in-app notifications.
- Operational dashboards, trends, categories, departments, locations, inventory/employee/incident reports.
- CSV, XLSX, and PDF downloads, audit log review, and system settings.
- Real PostgreSQL transactions and database constraints; immutable history/audit records during normal operation.
- Compact enterprise console with persistent navigation collapse, breadcrumbs, keyboard command search (Ctrl+K), notification previews and accessible quick-view drawers.
- Asset and employee card/table views, draft filters with removable chips, guided custody confirmations and offboarding progress.
- CSV import with validation and per-row results; eligible bulk assignment, location and status changes with explicit review and individual outcomes.

CSV import accepts up to 500 rows or 2 MB per file. Download the template from **Assets → Import**; category, department and location columns accept existing IDs or names. Preview errors before importing. Bulk changes use the existing API for each asset: successful records stay saved when another record fails, and the result panel identifies every outcome.

The [UI modernization plan and verification](docs/UI-MODERNIZATION.md) describes the console design, preserved workflows and review scope.

See [API documentation](docs/API.md), [database operations](docs/DATABASE.md), [deployment instructions](docs/DEPLOYMENT.md), and [verification results](docs/VERIFICATION.md).

## Business rules

An asset has at most one active assignment. Transfers close old custody and open a new assignment; returns close custody. Employees may hold multiple assets. Only available assets can be assigned. A damaged or unusable return becomes DAMAGED. A healthy return becomes AVAILABLE. Receiving an asset for repair closes custody and records the event. Completing repair returns it to inventory. Lost-asset reports require approval; approving loss closes custody while retaining the incident and responsible employee in history. An authorized admin must resolve loss of an outstanding offboarding item.

Registration, transfer, and return are history events. The current asset status is one of AVAILABLE, ASSIGNED, UNDER_REPAIR, DAMAGED, LOST, RETIRED, DISPOSED. Additional state transitions and permissions should be added deliberately in the centralized backend business logic; arbitrary status strings are not accepted from clients.

Email notifications, enterprise identity/HR/procurement integrations, barcode scanning, and a separate mobile app are future integrations. Asset identifiers include QR/barcode fields in preparation. Password-recovery email is supported when SMTP is configured. In local development, the recovery response exposes a reset link to allow testing without an email server; this is disabled in production.

## Tests and build

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Create `backend/.env.test` separately, without overwriting an existing file. Copy the local settings and change `DATABASE_URL` to a dedicated **asset_management_test** database, `NODE_ENV=test`, and `PORT=5001`. Use distinct test JWT secrets. The integration runner refuses any database whose name does not end with `_test`.

```powershell
node scripts/setup-db.mjs --env-file backend/.env.test
npm.cmd run db:test:setup
npm.cmd run test:integration
npm.cmd run test:e2e
```

The setup helper creates the missing test database and schema; `db:test:setup` applies migrations and seeds the existing test database. Integration tests start their own API on a random loopback port. Their unique fixtures remain in the isolated test database so immutable history does not need to be deleted. Browser tests start a separate test API on 5001 and frontend on 5174, and use the test database. They create clearly identified test records. Browser installation/setup is described in the [verification document](docs/VERIFICATION.md).

The database-setup script also has an opt-in PostgreSQL test suite, enabled with `SETUP_DB_TEST_ADMIN_URL`. It creates uniquely named fixture databases/roles and removes those fixtures afterward; it does not use the real application database. See [setup-helper tests](docs/DATABASE.md#testing-the-setup-helper) for the protected configuration and invocation.

`npm run build` creates `backend/dist` and `frontend/dist`. `npm start` runs only the compiled API; it does not serve the frontend. Use the Linux installer/Nginx deployment below for the complete production application.

## Ubuntu/Debian server installation with Nginx

Copy or clone this repository onto the server. From the repository root, run:

```bash
sudo bash install.sh
```

The installer asks for each setting in order. Press **Enter** to accept a displayed default:

1. Application hostname — `assets.infocuscs.com`.
2. Internal API port — `5002`, since the other two applications use 5000 and 5001.
3. Local PostgreSQL port — `5432`.
4. Request trusted HTTPS with Let's Encrypt — **yes**.
5. Certificate contact email — enter your real email address; this is required when choosing trusted HTTPS.

Invalid answers are requested again. After you answer the questions, the installer runs its checks and starts installation automatically. DNS must point to this server and inbound ports 80/443 must be reachable for Let's Encrypt. Choosing trusted HTTPS and providing your email accepts its subscriber terms. On a managed rerun, the hostname and ports are retained; the wizard asks only about HTTPS and its contact email.

The root `install.sh` is a launcher; the deployment implementation remains in `scripts/install.sh`. If your server has an older checkout without the launcher, run `git pull origin main` once to fetch this update. The installer uses your current checkout and does not pull Git changes automatically. Run it in an interactive Linux terminal.

To preview the same questions without deploying, use either of these optional commands:

```bash
bash install.sh --interactive --dry-run
sudo bash install.sh --interactive --check
```

`--dry-run` prints the selected plan. `--check` inspects the live server without deploying or changing services. The installer requires existing system dependencies and running Nginx/PostgreSQL; it does not install OS packages or start/restart those shared services. It creates the separate application database if needed, verifies migrations, builds the app with resource limits, and adds its own systemd service and Nginx site. If necessary on a first install, it can choose the next free API port. Explicit command-line options remain available for noninteractive use; see `bash install.sh --help`.

The application is served at the domain root, with `/api` routed to the loopback API:

```text
https://assets.infocuscs.com/       → built React application
https://assets.infocuscs.com/api/   → http://127.0.0.1:<selected-port>/api/
```

The Nginx configuration is `/etc/nginx/sites-available/infocus-assets.conf`, enabled from `/etc/nginx/sites-enabled/zz-infocus-assets.conf`. The installer requires that enabled link to sort after the existing sites, preserving their implicit default-host order, and validates Nginx before a graceful reload. This is a dedicated hostname deployment; a subpath such as `/asset-management/` is not configured. See the [shared-server safeguards](docs/DEPLOYMENT.md#shared-server-safeguards) before installation.

With the wizard's default HTTPS choice, the first installation requests a trusted certificate during the same run. If you choose **no** while preparing DNS, a first installation uses a self-signed certificate and browsers show a warning. Once DNS is ready, run `sudo bash install.sh` again and choose **yes**. Existing trusted certificates and stored credentials are retained; rerunning builds a new application release. Production sessions require HTTPS. See the [full server guide](docs/DEPLOYMENT.md) for first-admin creation, certificate verification, paths, logs, updates, and rollback limits.

## Production bootstrap

Use a clean database, apply migrations, and create the first administrator from the backend maintenance workspace:

```powershell
npm.cmd run admin:create -w backend
```

The command prompts for the admin identity and a hidden strong password, refuses to overwrite existing administrators, records an audit event, and requires a password change at first login. Production requires HTTPS for secure session cookies, strong environment secrets, SMTP for recovery, backup/restore planning, and a database account with only the application permissions it needs. For an installer-managed server use the environment-aware command in [deployment instructions](docs/DEPLOYMENT.md), which also covers optional Docker Compose.

## Troubleshooting

| Symptom                                                  | Check                                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `node` / `npm` is not found                              | Install a supported Node version, then open a new terminal. On PowerShell use `npm.cmd` if script execution policy blocks `npm.ps1`.      |
| PostgreSQL connection refused                            | Check the PostgreSQL service, host, and port. The local helper does not install or start PostgreSQL.                                      |
| Prisma engine DLL / `EPERM` during install or generation | Stop this application's running API/dev process before `npm ci` or `npm run db:generate`, then retry and restart it afterward.            |
| Password authentication failed                           | Correct `DATABASE_URL` or the separate `PG_ADMIN_*` connection. URL-encode special characters in URL credentials.                         |
| Database does not exist                                  | Run `node scripts/setup-db.mjs --env-file backend/.env`; its creation connection needs `CREATEDB` or administrator rights.                |
| Migration reports existing tables or drift               | Check the selected database. Use a dedicated database with this app's migration history; do not reset an unrelated database.              |
| Invalid configuration / login fails                      | Check the two JWT secrets, `CORS_ORIGIN`, `APP_URL`, and backend health; restart after editing backend `.env`.                            |
| API requests fail while the page loads                   | Confirm port 5000 is running and Vite's `API_PROXY_TARGET` agrees with `PORT`; check terminal logs.                                       |
| Production login does not persist                        | Verify trusted HTTPS, the exact configured origin, Nginx forwarded headers, and `TRUST_PROXY_HOPS=1` for the installed single-proxy path. |
| Nginx installation fails                                 | Read the specific error and run `sudo nginx -t`; do not disable existing sites to hide a conflict.                                        |

## Project structure

```text
backend/
  prisma/       Schema, versioned migrations, safe development seed
  src/          Express routes, validated APIs, shared lifecycle services
  scripts/      First administrator bootstrap
  tests/        Business rules and real PostgreSQL integration tests
frontend/
  src/          React pages, reusable UI, auth, API client, charts
scripts/        Local startup, database/schema setup, Linux/Nginx installer
e2e/            Browser workflow tests
docs/           API, database, deployment, verification
install.sh      Interactive launcher for scripts/install.sh
```
