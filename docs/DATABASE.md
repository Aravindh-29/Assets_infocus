# INFOCUS database operations

The application uses PostgreSQL and Prisma 6. Models, field names, and relations are defined in `backend/prisma/schema.prisma`; committed migrations are the deployment source of truth. Model names map directly to case-sensitive quoted table names, such as `"Asset"` and `"AssetAssignment"`.

## Data and history invariants

- Every asset tag is unique. Serial numbers can repeat only when the category disables serial uniqueness. The service derives a unique key from the category ID and the trimmed, uppercase serial number.
- An asset has at most one open assignment. PostgreSQL enforces this using a partial unique index on `AssetAssignment.assetId` where `returnedAt IS NULL`.
- Transfers close the former assignment and create a new assignment. Returns, approved losses, and receipt for repair close custody. These operations and their history/audit entries commit in the same transaction.
- Assignment return dates and expected return dates cannot precede the assignment. Warranty, repair, and offboarding dates also have database chronology checks. Purchase and repair costs cannot be negative.
- Employee transfers and location movements must have different source and destination values.
- There can be only one in-progress offboarding per employee. Completion requires all assets to be accounted for.
- Asset history and audit logs are append-only. PostgreSQL triggers reject updates, deletes, and truncation of these tables. Application archive actions use `deletedAt` and preserve relations and historical records.
- Foreign keys use restrictive deletion for records with historical or operational relationships. Authentication secrets are hashed; plaintext passwords and refresh/reset tokens must never be stored in audit details.

`backend/prisma/integrity.sql` documents database features Prisma cannot express, including partial indexes, checks, and immutable-log triggers. Its statements are included in the initial migration. Do not run this file again against a migrated database. Additional changes belong in a new migration.

For production, use separate migration and runtime database roles. The migration role owns the schema; the runtime role receives only the table/sequence access it needs and cannot disable triggers or alter tables. Removing application endpoints alone does not protect history from a database owner.

## Local and test isolation

- Development uses the dedicated `asset_management` database and `backend/.env`.
- Integration tests use the separate `asset_management_test` database and `backend/.env.test`.
- Verify the database name before applying migrations, running a seed, or executing integration tests. Do not point tests at development, staging, or production data.
- Test fixtures use unique names/tags and retain audit history. Tests must not disable triggers, truncate immutable tables, or delete another run's records.
- `.env` files and backups contain sensitive configuration/data; keep them out of version control and restrict access.

The development seed is allowed only with explicit `NODE_ENV=development` or `NODE_ENV=test`. It inserts sample users, employees, assets, and lifecycle examples without replacing existing records or resetting passwords. It refuses staging and production. Repeated runs preserve existing asset history.

## Database creation and schema setup

Use the included helper instead of manually running the migration SQL. It uses `psql` to check/create the dedicated database and Prisma to apply committed migrations, including the custom PostgreSQL constraints and append-only protections.

Requirements: Node.js 22.12+ or 24, dependencies installed with `npm ci`, a running PostgreSQL server, and a matching `psql` client. Generate the application's Prisma client separately with `npm run db:generate` before first startup. The helper applies/checks migrations but does not regenerate the client; on Windows the running API may lock its engine DLL, so stop this application's API before dependency installation or client generation and restart afterward. The Bash script is a portable entry point to the Node helper; the full Ubuntu/Debian installer calls the same helper after generating the client in a fresh release.

From the repository root:

```bash
# Initial setup only: generate the client while this application's API is stopped.
npm run db:generate

# Inspect configuration and the plan without connecting or changing anything.
bash scripts/setup-db.sh --env-file backend/.env --dry-run

# Create a missing database, migrate, and verify it; reuse a compatible database.
bash scripts/setup-db.sh --env-file backend/.env
```

Native Windows PowerShell uses the identical implementation directly:

```powershell
npm.cmd run db:generate
node scripts/setup-db.mjs --env-file backend/.env --dry-run
node scripts/setup-db.mjs --env-file backend/.env
```

Omitting `--env-file` selects this repository's `backend/.env`. An explicit path is resolved relative to the current working directory and must exist. Values already exported in the process environment take precedence over values in the file; check for stale `DATABASE_URL` or `PG_ADMIN_*` variables when switching environments. Files are parsed as dotenv data, not executed as shell scripts.

### Configuration

| Variable              | Meaning / default                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`        | Required target URL, using the schema-owner/migration login. Example: `postgresql://asset_owner:ENCODED_PASSWORD@localhost:5432/asset_management?schema=public`.   |
| `PG_ADMIN_HOST`       | Administrative connection host; defaults to the target URL host.                                                                                                   |
| `PG_ADMIN_PORT`       | Administrative connection port; defaults to the target URL port.                                                                                                   |
| `PG_ADMIN_USER`       | PostgreSQL administrative login, default `postgres`.                                                                                                               |
| `PG_ADMIN_DATABASE`   | Existing maintenance database, default `postgres`. It is only used to create/check the dedicated target.                                                           |
| `PG_ADMIN_PASSWORD`   | Administrative password. If omitted and the admin login equals the URL login, the URL password is reused. Otherwise libpq's password file may be used.             |
| `PGPASSFILE`          | Optional protected PostgreSQL password-file path for administrative authentication when no admin password is supplied.                                             |
| `PG_ADMIN_OS_USER`    | Linux root-only peer-authentication option, normally `postgres`; runs administrative `psql` via `runuser` using the local socket. Target must be loopback.         |
| `PSQL_BIN`            | Optional full path to `psql`/`psql.exe`. Windows auto-detects standard `C:\Program Files\PostgreSQL\<version>\bin` installations; otherwise uses `psql` from PATH. |
| `DB_RUNTIME_USER`     | Optional separate application login to create/check and grant restricted access after migrations.                                                                  |
| `DB_RUNTIME_PASSWORD` | Required with `DB_RUNTIME_USER`; at least 16 characters. Existing role passwords are never rotated.                                                                |

The helper uses `DATABASE_URL`, not a separate `MIGRATION_DATABASE_URL` setting. For owner/runtime separation, keep two protected environment files and pass the maintenance file to setup; point the running server at the runtime URL. The Linux installer does this automatically with `/etc/infocus-assets/maintenance.env` and `/etc/infocus-assets/app.env`.

Use a dedicated application database, not `postgres`, `template0`, or `template1`. Database and role names must be 1–63 ASCII letters, digits, or underscores, beginning with a letter or underscore. This helper supports the application's `public` schema only. URL-encode username/password components. Administrative permissions must be sufficient to create missing roles/databases and inspect the target; local PostgreSQL user `postgres` normally provides these rights.

Keep privileged passwords in a protected environment file or PostgreSQL password file, not in command arguments or shell history. On Unix, libpq expects password-file permissions restricted to the owner, commonly mode 600. The helper disables interactive `psql` password prompts so unattended runs fail clearly instead of hanging. On Windows, choose a `PGPASSFILE` location protected by your user account's ACLs.

Example `psql` path override in PowerShell:

```powershell
$env:PSQL_BIN = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
node scripts/setup-db.mjs --env-file backend/.env
```

For a Linux server whose protected maintenance environment selects local peer administration:

```bash
sudo /opt/infocus-assets/bin/node \
  /opt/infocus-assets/current/scripts/setup-db.mjs \
  --env-file /etc/infocus-assets/maintenance.env
```

### What it checks and changes

1. Validates the connection configuration and confirms administrative access.
2. Checks whether the target exists before creating roles. An existing target must belong to the URL's schema-owner role and either be empty or contain the expected INFOCUS application/migration tables. Recorded migrations must match the committed migration names; unrelated populated databases and older/unrelated checkouts are refused.
3. Creates the owner login when absent and the database when absent. Existing passwords, ownership, and data are retained; the configured owner password must actually authenticate.
4. Runs Prisma `migrate deploy` and `migrate status`. Pending committed migrations are applied; data is not reset. Client generation is a separate build/setup step.
5. Verifies every application model table, the two partial unique indexes for custody/offboarding, nine chronology/value constraints, and four enabled history/audit triggers.
6. When requested, creates/checks the separate runtime login, grants table/sequence access and future-object defaults, and verifies restricted permissions.

The runtime role must differ from the owner/admin and have no superuser, role-creation, database-creation, replication, bypass-RLS, or role-membership privileges. It must not own public relations or hold `TRUNCATE` permission on public tables. Setup verifies its credentials before migrations and rejects incompatible existing roles instead of silently changing them. When runtime separation is requested, setup revokes `CREATE` on `public` from `PUBLIC`, grants data operations, and checks that runtime access has no database/schema creation privileges. It does not transfer ownership. Run this only against the dedicated application database, since these are real database permission changes.

No application accounts or demo data are inserted by this helper. It never drops databases, resets migrations, executes `db push`, changes existing passwords, or automatically resolves a failed migration. A failure exits nonzero; inspect the target and cause before rerunning. Successfully applied migrations remain applied even if a later verification fails.

For database creation/login verification **without** applying or checking the schema:

```bash
bash scripts/setup-db.sh --env-file backend/.env --skip-migrations
```

`--skip-migrations` cannot be combined with runtime-role grants. It does not prepare a usable application schema by itself. For normal setup, leave it out.

### Test database

Create a separate `backend/.env.test` pointing to `asset_management_test`, with `NODE_ENV=test` and `PORT=5001`. Use the same helper to create/migrate it, then the test setup to insert test fixtures:

```powershell
node scripts/setup-db.mjs --env-file backend/.env.test
npm.cmd run db:test:setup
npm.cmd run test:integration
```

`db:test:setup` alone expects the database to exist. Tests must not target the development or production database. The pre-existing `psh_ticketing` database is unrelated to this application.

### Testing the setup helper

`scripts/tests/setup-db.test.mjs` is an opt-in test of database creation, migration verification, preservation on rerun, password preservation, incompatible database rejection, and runtime permissions. It is skipped unless `SETUP_DB_TEST_ADMIN_URL` is supplied. Use a local/disposable PostgreSQL server and an administrator allowed to create/drop fixture databases and roles.

Create a protected, git-ignored `backend/.env.setup-test` file using your own administrator credentials. This example contains placeholders only:

```dotenv
SETUP_DB_TEST_ADMIN_URL=postgresql://POSTGRES_ADMIN:URL_ENCODED_PASSWORD@localhost:5432/postgres
```

Then run from the repository root, in PowerShell or Bash:

```sh
node --env-file=backend/.env.setup-test --test scripts/tests/setup-db.test.mjs
node --env-file=backend/.env.setup-test --import tsx --test scripts/tests/installer-admin.test.mjs
```

Set `PSQL_BIN` in that file if your client is not in the standard PostgreSQL 17 Windows location or on PATH. Do not paste a real password into the command line or commit the environment file. This test creates unique `infocus_setup_<random>_test` and `infocus_foreign_<random>_test` databases and `infocus_owner_<random>` / `infocus_runtime_<random>` roles; its cleanup removes those fixtures after verifying their generated names and database ownership. It does not target `asset_management`, `asset_management_test`, or any existing application data. If the process is forcibly terminated, inspect the generated fixture names before manually cleaning up anything left behind.

Unlike the application integration suite, these disposable setup fixtures deliberately alter a trigger, grants, ownership, and a migration record to verify that setup refuses unsafe configurations. Those checks occur only inside the newly created temporary databases, and each altered fixture is restored before cleanup.

The installer-admin suite uses a separate `infocus_installer_<random>_test` database and `infocus_inst_owner_<random>` / `infocus_inst_runtime_<random>` roles, with the same guarded cleanup. It checks automatic account creation with restricted database permissions, conflicting identifiers, concurrent reruns, real username login, mandatory password change, and preservation of changed passwords and disabled accounts.

## Apply migrations

Run the following from `backend` with the target `DATABASE_URL` provided securely:

```sh
npm run db:generate
npm run db:migrate
```

`db:migrate` runs `prisma migrate deploy`, applying only committed migrations. Review migration SQL before deployment and take a recoverable backup before changes that may affect existing data. For schema development, generate a new migration in a disposable development database and inspect it; never use `prisma migrate reset` or `prisma db push` against valuable data. `db push` does not recreate the custom history and uniqueness protections.

Run `npx prisma migrate status` to inspect applied migrations. Do not edit an already-applied migration or remove its entry from `_prisma_migrations`. Failed migrations require diagnosing the failure, verifying the live schema, and an intentional repair; do not mark an unknown state as resolved.

For an installer-managed server, prefer rerunning `scripts/install.sh` from the reviewed source checkout: it selects the protected maintenance connection, migrates, verifies, and builds/activates a new release. A manual migration must use `maintenance.env`, never the restricted runtime credentials from `app.env`. Ordinary `npm run db:migrate` loads the local backend configuration and does not automatically discover the installer's environment files.

## First production administrator

The full Ubuntu/Debian installer automatically creates the first administrator after applying and verifying migrations, only if no administrator exists. Its login is username **`admin`** and temporary password **`Admin@123`**. A password change is required at first login. The account has placeholder email `admin@infocus.invalid`, which cannot receive password-reset messages; email recovery requires a deliverable account address and configured SMTP.

Installer reruns preserve existing administrators and passwords, including disabled accounts. They neither reset passwords nor create another administrator when any administrator already exists. A reserved-username/email or employee-ID collision fails without altering that account. Creation and its audit record run in one transaction, with a database advisory lock shared with manual first-admin creation to serialize concurrent attempts.

The standalone `setup-db.sh`/`setup-db.mjs` helper still creates **no application accounts**. For a manual deployment without the full installer, create the target database, apply migrations, then run from `backend`:

```sh
npm run admin:create
```

For Docker Compose, run the command in the migration service after migrations have completed:

```sh
docker compose run --rm migrate npm run admin:create
```

That service uses the build image, which includes the bootstrap script and TypeScript runner. The smaller application runtime image contains compiled server code and production dependencies only.

The installer does not require this manual command. If a manual first-admin command is needed on an installer-managed server with no administrator, use its environment-aware form in [deployment instructions](DEPLOYMENT.md#4-create-the-first-administrator). It loads `/etc/infocus-assets/app.env` and runs as the service user; it does not rely on a developer `.env` file.

The CLI asks for an email, name, and hidden password. The password must contain at least 12 characters including uppercase, lowercase, a number, and a symbol, and fit within bcrypt's 72-byte limit. The account must change its one-time password after signing in.

For non-interactive use of the **manual** CLI, inject `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` through the deployment secret manager. Do not put that chosen password in a command-line argument, committed file, shell history, build log, or persistent container definition. Remove those one-time values after completion. The manual CLI never prints the password/hash, creates an audit entry, and refuses if any administrator or the requested email already exists. The full installer uses its explicit temporary credentials instead and prints them only after successful application verification. Additional administrators are managed through the application.

Never run demo seeds in production. Development example credentials are not production credentials.

## Backup

Use PostgreSQL client tools compatible with the server. Run under an authorized operator account. Store backups in an access-controlled, encrypted location separate from the database host, and establish retention according to company policy.

Example with a PostgreSQL connection service named `asset_production`; keep credentials in an appropriately protected PostgreSQL password file or secret manager:

```sh
pg_dump --dbname=service=asset_production --format=custom --file=asset-management.backup
pg_restore --list asset-management.backup
```

The custom-format dump includes application data, schema, indexes, constraints, trigger definitions, and Prisma migration records. Cluster-level roles and grants may require a separately protected infrastructure backup. A successful dump is insufficient evidence of recoverability: regularly restore into an isolated database and verify row counts, lifecycle history, active assignments, and representative workflows.

For deployments requiring recovery between logical backups, configure PostgreSQL physical backups and WAL archiving/PITR with the database operations team. Record backup timestamps and restoration results.

## Restore into a fresh database

Stop writes to the target application, verify the destination, and restore into a newly created database first. The following commands assume a prepared service named `asset_restore` that points to that new database:

```sh
pg_restore --dbname=service=asset_restore --no-owner --no-privileges --exit-on-error --single-transaction asset-management.backup
```

Do not restore over an active database or use `--clean` casually. Existing history triggers deliberately reject destructive changes, and merging logical backups into an existing live database can violate custody and uniqueness invariants. An isolated restore provides a reviewable destination without changing current records.

After restoration:

1. Reapply the intended runtime grants and ownership using reviewed infrastructure configuration.
2. Inspect `_prisma_migrations`, run `prisma migrate status`, and apply any newer reviewed migrations.
3. Verify the active-assignment partial index, log triggers, and constraints are present and enabled.
4. Check representative employee/asset timelines and confirm each asset has at most one active assignment.
5. Check administrator access and session handling, then point the application at the restored database through its managed configuration.
6. Run health checks and a controlled assignment/transfer/return workflow before reopening normal access.

Database owners can bypass table protections; tightly control privileged access and retain database-level backup and administrative audit records independently of this application.
