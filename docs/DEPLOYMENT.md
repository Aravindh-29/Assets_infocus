# INFOCUS deployment and operations

Use [README.md](../README.md) for local Windows development. This guide deploys the built application on an Ubuntu/Debian server with PostgreSQL, systemd, and Nginx. DNS is managed separately by you.

## Deployment layout

```text
Browser → https://assets.infocuscs.com
                 │
                 Nginx (ports 80/443)
                 ├── /       → React files + SPA route fallback
                 └── /api/   → API on 127.0.0.1:<selected-port>
                                      │
                                      PostgreSQL on local port 5432
```

The interactive installer defaults to internal API port **5002**. On the INFOCUS shared server, SERV-IT already uses 5000 and Grow Together uses 5001. The installer can select another free port on a first installation. It binds the API to loopback; only Nginx should expose the application publicly. PostgreSQL remains local. No Redis, MinIO, Google OAuth, or .NET components are required by this application.

The deployment uses a dedicated hostname at `/`. Hosting below a path such as `/assets-app/` requires additional React Router, Vite base-path, API, and cookie configuration and is not implemented by this installer.

## 1. Prepare the server

Use Ubuntu/Debian with systemd and sudo/root access. Copy or clone the repository, including `package-lock.json` and all committed Prisma migrations, onto the server. The installer needs outbound access to official Node runtime downloads and the npm registry. It reuses a compatible Node.js 22.12+ or 24 installation, or installs a private Node runtime under `/opt/infocus-assets` without replacing the system Node used by other apps. It reuses the running local PostgreSQL server. Required system tools must already be installed; missing tools cause a preflight failure. Prepare missing OS packages separately during appropriate server maintenance, since package-manager hooks can affect shared services.

For optional help, a guided preview, or a read-only server check, run from the repository root:

```bash
bash install.sh --help
bash install.sh --interactive --dry-run
sudo bash install.sh --interactive --check
```

`assets.infocuscs.com` is the intended hostname. `--interactive` asks for settings one at a time. `--dry-run` then prints the plan without inspecting the server. `--check` performs actual read-only checks of dependencies, Nginx, PostgreSQL, managed paths, hostname conflicts, available ports, and build resources, then exits before deployment. Run the server check with sudo so it can inspect Nginx and use PostgreSQL peer authentication. The implementation remains in `scripts/install.sh`, which also accepts these options directly; normal installation requires the complete checkout.

The normal installer targets a local PostgreSQL instance reachable by the `postgres` operating-system account through peer authentication. The wizard asks for its port, defaulting to `5432`; enter the intended local cluster's port if different. In noninteractive mode, `--db-port` selects the cluster, or the script detects it when unambiguous. It does not change another application's PostgreSQL port, database, or credentials. For remote PostgreSQL or a different administrative authentication setup, provision the database with the [database helper](DATABASE.md#database-creation-and-schema-setup) and adapt a reviewed deployment configuration instead of running this local-server installer unchanged.

The installer uses database `asset_management`, schema-owner login `infocus_assets_owner`, and runtime login `infocus_assets`. A database with that name but another owner is refused, including a database previously created under a developer's `postgres` login. Reusing/moving existing local data onto this production setup requires a planned backup/restore and ownership/grant review; it is not an automatic takeover. Likewise, an unrelated existing `infocus-assets` OS account, managed-path directory, or conflicting Nginx hostname is refused.

Nginx must use the standard `/etc/nginx/sites-enabled/*` include inside its HTTP configuration. If your server uses custom includes, review the routing integration first; the installer does not rewrite global Nginx configuration. The installer expects a normal systemd server, not a Windows terminal or a container image bootstrap environment.

## 2. Install the application

In an interactive terminal on the Linux server, change to the repository root and run:

```bash
sudo bash install.sh
```

If your checkout predates the root launcher, fetch the update with `git pull origin main` first. The installer does not run Git commands or update your checkout automatically.

On a first installation, answer the questions in this order:

| Question                                  | Default / answer                                                     |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Dedicated application hostname            | Press Enter for `assets.infocuscs.com`.                              |
| Internal API port                         | Press Enter for `5002`, leaving existing apps on 5000/5001 in place. |
| Local PostgreSQL port                     | Press Enter for `5432`, or enter your existing cluster's port.       |
| Request trusted HTTPS with Let's Encrypt? | Press Enter for **yes**, or enter **no** if DNS is not ready.        |

Invalid answers are requested again. Answering the four questions starts the selected operation automatically; there is no additional approval prompt. No certificate email address is requested or required. Ending input before the questions are complete aborts the run. The wizard requires an interactive terminal; use explicit options for automation.

Managed reruns retain the stored hostname, API port, and PostgreSQL port and show those settings instead of asking to change them. Only the HTTPS choice is requested. Existing credentials and trusted certificates are preserved.

The root `install.sh` forwards to `scripts/install.sh`, keeping the deployment script in the `scripts/` folder. Existing options remain supported. For example, the noninteractive equivalent is:

```bash
sudo bash install.sh --domain assets.infocuscs.com --port 5002 --db-port 5432 \
  --letsencrypt
```

DNS and inbound ports 80/443 must be ready before requesting Let's Encrypt; see the HTTPS section below. The wizard's default choice requests the trusted certificate during this first run. An optional `--email` flag remains available for existing automation, but omitting it registers with Certbot's `--register-unsafely-without-email` option.

The installer:

1. Checks the OS, runtime, tools, PostgreSQL connection, and requested hostname.
2. Creates an `infocus-assets` service user and a new release directory.
3. Generates independent JWT secrets and PostgreSQL credentials on first setup; retains them on reruns.
4. Creates the application database when missing, or reuses a compatible existing database; applies committed migrations and checks tables, constraints, indexes, and history protections.
5. Separates the schema owner used for migrations from the restricted database login used by the running API.
6. Installs dependencies from the lockfile and builds both workspaces.
7. Creates the first administrator only if no administrator exists, using username `admin` and temporary password `Admin@123`, with a mandatory first-login password change.
8. Configures systemd and its own Nginx server block, then validates Nginx before reloading it.
9. Checks database-backed API health and the frontend/API routes through Nginx, including before public DNS resolves, and prints the new administrator credentials after successful verification.

No demo inventory or sample employee accounts are created. Existing administrator accounts and passwords are preserved, including disabled administrators. An incompatible existing database, administrator identifier conflict, failed migration, invalid Nginx configuration, or failed health check produces a failure rather than a false success banner. Review the reported failure before rerunning.

Existing unrelated Nginx sites remain enabled. The installer owns only the INFOCUS site and service paths below. Existing databases are not dropped or reset. Applied migrations can still change the application schema, so take a recoverable backup before an upgrade.

## Shared-server safeguards

- System packages and the system Node/PostgreSQL versions are left in place. Nginx and the selected PostgreSQL cluster must already be running. The installer only starts/restarts its own `infocus-assets` application service.
- The separate `asset_management` database and `infocus_assets_owner`/`infocus_assets` roles must be unused or belong to a compatible prior INFOCUS installation. Existing application databases are not adopted or reset.
- The new enabled-site link is `zz-infocus-assets.conf`. Installation refuses if that name would sort before another enabled site, or if the older `infocus-assets.conf` enabled link remains; review the routing layout instead of removing existing sites. Existing default hosts and domain routing retain their order.
- Nginx receives a configuration test followed by a graceful reload. Its boot enablement is not changed. The installer refuses to reload if unrelated Nginx configuration changes during its run. A reload applies the server's complete on-disk configuration, so resolve any pre-existing unreviewed edits to other sites before deployment.
- Builds run at lower priority with one CPU's worth of quota, 1536 MiB memory and 512 MiB swap limits. Preflight requires at least 1536 MiB available memory and 4 GiB available disk space. This limits build contention but does not remove all load from the shared machine.
- Certificate renewal hooks are scoped to the INFOCUS certificate. The installer does not start or enable the shared Certbot timer; confirm an existing timer or scheduled renewal job is active before relying on automatic renewal.

The initial pre-deployment inspection found the two existing apps healthy over HTTPS, the new DNS pointing to the intended host, and the INFOCUS paths/database/roles unused at that time. These historical checks do not describe the current installation; rerun `--check` immediately before deployment.

## Paths and service names

| Item                                   | Path / name                                       |
| -------------------------------------- | ------------------------------------------------- |
| Application releases                   | `/opt/infocus-assets/releases/`                   |
| Active release symlink                 | `/opt/infocus-assets/current`                     |
| Stable Node executable                 | `/opt/infocus-assets/bin/node`                    |
| Stable npm entry point                 | `/opt/infocus-assets/bin/npm`                     |
| Runtime environment                    | `/etc/infocus-assets/app.env`                     |
| Maintenance / schema-owner environment | `/etc/infocus-assets/maintenance.env`             |
| Service user and systemd unit          | `infocus-assets` / `infocus-assets.service`       |
| systemd unit file                      | `/etc/systemd/system/infocus-assets.service`      |
| Nginx site definition                  | `/etc/nginx/sites-available/infocus-assets.conf`  |
| Nginx enabled-site link                | `/etc/nginx/sites-enabled/zz-infocus-assets.conf` |
| Frontend files                         | `/opt/infocus-assets/current/frontend/dist/`      |
| Initial self-signed certificate/key    | `/etc/infocus-assets/tls/cert.pem` / `key.pem`    |
| Let's Encrypt certificate directory    | `/etc/letsencrypt/live/infocus-assets/`           |
| ACME challenge webroot                 | `/opt/infocus-assets/acme/`                       |

`app.env` is readable by root and the application service group (mode 640); `maintenance.env` is root-only (mode 600). Keep both out of source control, tickets, screenshots, and application logs. The runtime file contains the restricted database URL; the maintenance file contains the schema-owner URL. Do not give the API the maintenance credentials.

## 3. DNS and trusted HTTPS

The interactive installer defaults to requesting a trusted Let's Encrypt certificate during installation. Prepare DNS before selecting this option. The installer temporarily uses a self-signed certificate while configuring its HTTPS route and ACME webroot, then replaces it with the issued trusted certificate in the same run.

In your DNS provider:

1. Add an **A** record for `assets.infocuscs.com` pointing to the server's public IPv4 address.
2. Add an **AAAA** record only if the server has correctly routed public IPv6 and Nginx/firewall allow it. A stale AAAA record can break certificate validation and browser access.
3. Allow inbound TCP 80 and 443 through the server firewall and hosting-provider firewall/security group. Do not expose the API or PostgreSQL port publicly.

Check DNS from a machine outside the server:

```bash
nslookup assets.infocuscs.com
```

If you previously chose **no** because DNS was not ready, browsers will show a warning for the first installation's self-signed certificate. Once DNS resolves, run the installer again and choose **yes** for trusted HTTPS:

```bash
sudo bash install.sh
```

The installer requests a Let's Encrypt certificate using the Nginx-served ACME webroot and configures certificate renewal/reload support. It uses noninteractive Certbot registration without email by default. Choosing trusted HTTPS, or using `--letsencrypt` explicitly, accepts Let's Encrypt's subscriber terms for that request. This rerun also builds a new release using the checkout you run it from, while retaining existing credentials. Read any certificate failure and correct DNS, port 80 reachability, or hostname conflicts before retrying. Existing trusted certificates are retained on subsequent runs, including when choosing **no** to a new certificate request. Install a trusted certificate before users begin working.

Verify normal certificate trust without `-k`:

```bash
curl --fail --show-error https://assets.infocuscs.com/api/health
curl --fail --show-error --head https://assets.infocuscs.com/login
sudo certbot certificates
sudo certbot renew --dry-run
```

Production refresh cookies are `Secure`; `APP_URL` and `CORS_ORIGIN` must use HTTPS. The Nginx HTTP listener redirects to HTTPS while allowing ACME validation. Do not turn off secure cookies or weaken the production origin configuration to avoid certificate setup.

If an older installer failed certificate issuance with HTTP 403 while the API is healthy, preserve its database and managed configuration. Update the checkout and rerun `sudo bash install.sh`, choosing trusted HTTPS. The corrected installer repairs traversal permissions on its public ACME directories and tests the challenge URL before contacting Certbot. No certificate email is required. Inspect Nginx's error log if that probe still fails; do not change permissions on `/etc/infocus-assets` or private certificate keys.

## 4. Create the first administrator

The full installer performs this step automatically if no user has the `ADMIN` role. After a successful installation, sign in at [https://assets.infocuscs.com/login](https://assets.infocuscs.com/login) using:

| Login field        | Initial value |
| ------------------ | ------------- |
| Username           | `admin`       |
| Temporary password | `Admin@123`   |

Use the exact spelling **`admin`**. The application requires you to replace the temporary password before accessing its features. The replacement must contain at least 10 characters, uppercase and lowercase letters, a number, and a symbol, and fit within bcrypt's 72-byte limit. The initial account uses reserved placeholder email `admin@infocus.invalid`; this address cannot receive password-reset messages. Email recovery requires a deliverable account address and configured SMTP.

On every rerun, any existing administrator, including a disabled administrator, causes automatic account creation to be skipped. Passwords, account status, and first-login password-change state are left unchanged. The installer cannot be used to reset a forgotten password or reactivate an account. If an earlier attempt created this administrator but failed a later deployment check, rerunning retains that same account and its current password. An unrelated account or employee using the reserved identifier causes a clear failure rather than an account takeover.

The standalone database helper does not create administrators. For a manual deployment that has no administrator, the interactive `admin:create` command remains available. On an installer-managed server, its environment-aware equivalent is:

```bash
cd /opt/infocus-assets/current/backend
sudo -u infocus-assets /opt/infocus-assets/bin/node \
  --env-file=/etc/infocus-assets/app.env \
  /opt/infocus-assets/current/node_modules/tsx/dist/cli.mjs \
  /opt/infocus-assets/current/backend/scripts/create-admin.ts
```

This optional command loads the installed environment without evaluating it as shell code. Enter the administrator email, name, and hidden strong password. The manual CLI requires at least 12 characters, uppercase and lowercase letters, a number, and a symbol, within bcrypt's 72-byte limit. The account must change this password at first login.

The command refuses if an administrator or the specified email already exists, and writes an audit event when it succeeds. Additional administrators are managed through the application. Do not run `db:seed` in production; the README's demo login details are only for seeded development environments.

After first login, configure your real categories, departments, locations, employees, and assets. Confirm an assignment, transfer, return, report download, and session refresh work through the final HTTPS hostname.

## Configuration reference

| Variable                                                            | Meaning / installed setting                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                          | `production` on the server; `development` locally; `test` for isolated tests. `staging` is also validated as HTTPS-only.        |
| `HOST` / `PORT`                                                     | `127.0.0.1` and the selected API port for the systemd installation.                                                             |
| `DATABASE_URL`                                                      | PostgreSQL URL; restricted runtime account in `app.env`, schema owner in `maintenance.env`.                                     |
| `JWT_SECRET` / `JWT_REFRESH_SECRET`                                 | Independent random secrets, each at least 32 characters.                                                                        |
| `JWT_EXPIRES_IN`                                                    | Access-token lifetime, normally `15m`.                                                                                          |
| `REFRESH_TOKEN_EXPIRES_IN` / `REMEMBER_TOKEN_EXPIRES_IN`            | Refresh lifetimes such as `7d` and `30d`; accepted duration range is `1m` through `365d`.                                       |
| `APP_URL`                                                           | Public application URL, e.g. `https://assets.infocuscs.com`.                                                                    |
| `CORS_ORIGIN`                                                       | Comma-separated allowed origins; use the exact HTTPS origin, without a trailing route.                                          |
| `TRUST_PROXY_HOPS`                                                  | `1` for the single installed Nginx proxy; `0` for direct local development. Change only for a known, restricted proxy topology. |
| `LOG_LEVEL`                                                         | Application logging level, normally `info`.                                                                                     |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Password-recovery email delivery; configure your mail provider's settings.                                                      |
| `VITE_API_URL`                                                      | `/api` when building the frontend for this same-origin Nginx deployment. Public browser configuration only.                     |

`SESSION_SECRET` and `CLIENT_URL` are not application settings. Use the JWT secrets, `CORS_ORIGIN`, and `APP_URL` above. Production password recovery requires working SMTP; development reset-link responses are disabled in production.

Edit server configuration with `sudoedit /etc/infocus-assets/app.env`, retain its ownership/mode, then restart the service. Preserve the installer-managed values unless intentionally changing the deployment; reruns reuse stored configuration and refuse changing an existing hostname or relocating the database/API port through command flags. Frontend variables are compiled into browser files and need a rebuild. Never put secrets into frontend variables.

## Health, logs, and common failures

```bash
sudo systemctl status infocus-assets --no-pager
sudo journalctl -u infocus-assets -n 100 --no-pager
sudo journalctl -u infocus-assets -f
sudo nginx -t
curl --fail --show-error https://assets.infocuscs.com/api/health
```

The health response must contain `success: true` and `database: "connected"`. A running process alone does not establish database readiness.

To restart or stop intentionally:

```bash
sudo systemctl restart infocus-assets
sudo systemctl stop infocus-assets
sudo systemctl start infocus-assets
```

For a 502 response, inspect the API journal, selected `PORT`, and Nginx upstream. For a certificate error, check the domain's A/AAAA records and installed certificate. For origin/session errors, check `APP_URL`, `CORS_ORIGIN`, HTTPS, and the forwarded protocol header. If a port or hostname belongs to an existing app, choose a different dedicated value rather than removing that app's configuration.

## Updating and rollback limits

1. Take and verify a PostgreSQL backup; record the current release path with `readlink -f /opt/infocus-assets/current`.
2. Update the source checkout to a reviewed version. Review pending migration SQL and run the relevant tests before deployment.
3. Run the same installer from that checkout:

   ```bash
   sudo bash install.sh
   ```

4. It builds a new timestamped release, retains configuration/secrets, applies pending migrations, switches the active release, restarts the service, and checks health. Verify login, inventory, and one controlled workflow through the final domain.

Keep the previous release until the new one is verified. Restoring an older application release does **not** undo database migrations. If a migration is incompatible with the old code, recover with a reviewed forward fix or a verified database restore as described in [database operations](DATABASE.md). Do not run Prisma reset, drop the live database, or assume switching a symlink reverses schema/data changes. Installer cleanup/rollback of files and services cannot make a migrated database revert automatically.

Schedule database backups to protected storage away from the server and rehearse restoring into an isolated database. Record the runtime grants and required infrastructure alongside the backups. Release directories are not database backups.

## Optional Docker Compose

Docker is an alternative deployment path and is not needed for the local Windows PostgreSQL installation or the Ubuntu/Debian installer above. Its stack uses its own PostgreSQL volume; it does not automatically connect to the installed host PostgreSQL service.

1. Copy root `.env.example` to `.env` without overwriting existing settings.
2. Set distinct database and JWT secrets. For the current Compose interpolation use a URL-safe database password, or adapt the connection URL with proper credential encoding.
3. For local preview keep `NODE_ENV=development`, `APP_URL=http://localhost:8080`, and the same `CORS_ORIGIN`.
4. Start with `docker compose up -d --build`.
5. Create the first administrator from the migration/build image:

   ```bash
   docker compose run --rm --no-deps migrate npm run admin:create
   ```

Migrations complete before the API starts. The frontend container serves files and proxies `/api` to the API. PostgreSQL data persists in `postgres_data`; removing this volume deletes the stored application database. The migration image includes TypeScript maintenance tools; the smaller API runtime image runs compiled application code.

The Compose endpoint binds to loopback port 8080 by default. For production, set `NODE_ENV=production`, configure an external HTTPS `APP_URL`/`CORS_ORIGIN`, and arrange trusted TLS termination. The bundled Compose connection uses one database account, so adapt it to separate owner/runtime accounts before using it as the production deployment. Reassess `TRUST_PROXY_HOPS` if adding another proxy. The host installer configures a separate host-based deployment and is not a certificate wrapper for this Compose stack.

Container execution, external SMTP, trusted certificate issuance, DNS, and production-server provisioning must be verified in their target environment; local application test results do not establish those external services are configured.
