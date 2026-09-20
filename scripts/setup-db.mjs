#!/usr/bin/env node
/** Cross-platform implementation for setup-db.sh; never executes an environment file. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const fail = (message) => {
  throw new Error(message);
};
const identifier = (value, label) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value ?? ''))
    fail(
      `${label} must be a PostgreSQL identifier of 1–63 letters, digits or underscores, starting with a letter/underscore.`,
    );
  return value;
};
const quoted = (value) => `"${value.replaceAll('"', '""')}"`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const info = (message) => console.log(`[INFOCUS DB] ${message}`);

function argumentsFor(argv) {
  const result = { envFile: path.join(backend, '.env'), explicit: false, dryRun: false, skip: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--env-file':
        if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('--env-file requires a path.');
        result.envFile = path.resolve(argv[++i]);
        result.explicit = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--skip-migrations':
        result.skip = true;
        break;
      case '--help':
        result.help = true;
        break;
      default:
        fail(`Unknown argument: ${argv[i]}. Use --help.`);
    }
  }
  return result;
}

function connection(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash)
    fail('DATABASE_URL must specify a PostgreSQL host, user, and database without a URL fragment.');
  let user, password, database;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    fail('DATABASE_URL contains invalid URL encoding.');
  }
  identifier(user, 'Database user');
  identifier(database, 'Database name');
  if (['postgres', 'template0', 'template1'].includes(database.toLowerCase()))
    fail('Use a dedicated application database, not postgres/template0/template1.');
  if (!password || /[\0\r\n]/.test(password))
    fail(
      'DATABASE_URL must include a password without NUL/newline characters; URL-encode special characters.',
    );
  for (const [key] of url.searchParams) {
    if (!['schema', 'sslmode', 'connection_limit', 'pool_timeout', 'connect_timeout'].includes(key))
      fail(`Unsupported DATABASE_URL option: ${key}. Use a direct PostgreSQL connection for setup.`);
  }
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')
    fail('This application uses schema=public; other schemas are not supported by this setup.');
  const sslmode = url.searchParams.get('sslmode') || 'prefer';
  if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode))
    fail('Invalid PostgreSQL sslmode.');
  return {
    user,
    password,
    database,
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port || '5432',
    sslmode,
  };
}

function findPsql(env) {
  if (env.PSQL_BIN) return env.PSQL_BIN;
  if (process.platform === 'win32') {
    const directory = path.join(env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    if (fs.existsSync(directory)) {
      for (const version of fs.readdirSync(directory).sort((a, b) => Number(b) - Number(a))) {
        const candidate = path.join(directory, version, 'bin', 'psql.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return 'psql';
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) {
    console.log(`INFOCUS database setup
Usage: bash scripts/setup-db.sh [--env-file PATH] [--dry-run] [--skip-migrations]
Windows alternative: node scripts/setup-db.mjs [same options]

Reads backend/.env by default; process environment overrides file values.
Required: DATABASE_URL (the dedicated schema-owner/migration connection).
Admin overrides: PG_ADMIN_HOST, PG_ADMIN_PORT, PG_ADMIN_USER (postgres),
PG_ADMIN_PASSWORD, PG_ADMIN_DATABASE (postgres), PG_ADMIN_OS_USER (Linux peer).
If the admin user equals the URL user, its URL password is reused by default.
Otherwise use PG_ADMIN_PASSWORD or your PostgreSQL password file.
PSQL_BIN may point to psql/psql.exe. Optional DB_RUNTIME_USER and
DB_RUNTIME_PASSWORD create/grant a separate non-owner runtime account.

Creates missing roles/database, verifies ownership and credentials, deploys
committed Prisma migrations, and checks schema protections.
Existing databases, role passwords, and application data are never reset.
--skip-migrations creates/verifies the database only (no runtime grants).
--dry-run validates configuration and prints the plan without connecting.
Run npm ci first. Generate the Prisma client separately with npm run db:generate.
No demo data or administrator is seeded automatically.`);
    return;
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    fail('Node.js 22.12+ is required (Node.js 24 is also supported).');
  let fileEnv = {};
  if (fs.existsSync(options.envFile)) {
    const { parse } = await import('dotenv');
    fileEnv = parse(fs.readFileSync(options.envFile));
  } else if (options.explicit) fail('The requested --env-file does not exist.');
  const env = { ...fileEnv, ...process.env };
  if (!env.DATABASE_URL) fail('Set DATABASE_URL in backend/.env, --env-file, or the process environment.');
  const target = connection(env.DATABASE_URL);
  const adminUser = identifier(env.PG_ADMIN_USER || 'postgres', 'Administrative user');
  const adminDatabase = identifier(env.PG_ADMIN_DATABASE || 'postgres', 'Administrative database');
  const adminPort = env.PG_ADMIN_PORT || target.port;
  if (!/^\d+$/.test(adminPort) || Number(adminPort) < 1 || Number(adminPort) > 65535)
    fail('PG_ADMIN_PORT must be a valid port.');
  const runtimeUser = env.DB_RUNTIME_USER;
  const runtimePassword = env.DB_RUNTIME_PASSWORD;
  if (Boolean(runtimeUser) !== Boolean(runtimePassword))
    fail('Set both DB_RUNTIME_USER and DB_RUNTIME_PASSWORD, or neither.');
  if (runtimeUser) {
    identifier(runtimeUser, 'Runtime user');
    if (runtimeUser === target.user || runtimeUser === adminUser)
      fail('Runtime user must differ from the migration and administrative users.');
    if (runtimePassword.length < 16 || /[\0\r\n]/.test(runtimePassword))
      fail('Runtime password must be at least 16 characters without NUL/newline characters.');
    if (options.skip) fail('--skip-migrations cannot be combined with runtime-role grants.');
  }
  if (env.PG_ADMIN_OS_USER) {
    if (process.platform !== 'linux' || process.getuid?.() !== 0)
      fail('PG_ADMIN_OS_USER requires root on Linux; otherwise use the PG_ADMIN_* connection settings.');
    identifier(env.PG_ADMIN_OS_USER, 'PostgreSQL operating-system user');
    if (!['localhost', '127.0.0.1', '::1'].includes(target.host))
      fail('Local peer administration requires a loopback DATABASE_URL host.');
  }
  info(`Target: ${target.database} on ${target.host}:${target.port}; schema owner ${target.user}.`);
  if (options.dryRun) {
    info(
      'DRY RUN: verify PostgreSQL administrator; create missing owner/database; preserve existing data/passwords.',
    );
    info(
      options.skip
        ? 'Would verify owner login; schema migration is explicitly skipped.'
        : 'Would deploy migrations and verify migration history, tables and history/custody safeguards. Prisma client generation is separate.',
    );
    if (runtimeUser)
      info(`Would create/verify ${runtimeUser} and grant data access without ownership, CREATE or TRUNCATE.`);
    return;
  }

  const psql = findPsql(env);
  const psqlArgs = [
    '--no-psqlrc',
    '--no-password',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
    '--set=VERBOSITY=terse',
  ];
  function query(sql, as = 'admin', database = target.database) {
    const admin = as === 'admin';
    const childEnv = {
      ...process.env,
      PGCONNECT_TIMEOUT: '10',
      PGCLIENTENCODING: 'UTF8',
      PGOPTIONS: '-c standard_conforming_strings=on',
    };
    // Do not let inherited libpq variables select a different server/database.
    for (const name of [
      'PGHOST',
      'PGHOSTADDR',
      'PGPORT',
      'PGUSER',
      'PGDATABASE',
      'PGPASSWORD',
      'PGSERVICE',
      'PGSERVICEFILE',
    ])
      delete childEnv[name];
    Object.assign(childEnv, {
      PGHOST: admin ? env.PG_ADMIN_HOST || target.host : target.host,
      PGPORT: admin ? adminPort : target.port,
      PGUSER: admin ? adminUser : as === 'runtime' ? runtimeUser : target.user,
      PGDATABASE: database,
      PGSSLMODE: target.sslmode,
    });
    if (env.PGPASSFILE) childEnv.PGPASSFILE = env.PGPASSFILE;
    const password = admin
      ? (env.PG_ADMIN_PASSWORD ?? (adminUser === target.user ? target.password : undefined))
      : as === 'runtime'
        ? runtimePassword
        : target.password;
    if (password !== undefined) childEnv.PGPASSWORD = password;
    let command = psql;
    let args = psqlArgs;
    if (admin && env.PG_ADMIN_OS_USER) {
      command = 'runuser';
      args = ['-u', env.PG_ADMIN_OS_USER, '--', psql, ...psqlArgs];
      delete childEnv.PGHOST;
      delete childEnv.PGPASSWORD;
    }
    const result = spawnSync(command, args, {
      env: childEnv,
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error?.code === 'ENOENT')
      fail('PostgreSQL client (psql) or runuser is missing. Install it or set PSQL_BIN.');
    if (result.status !== 0)
      fail(
        `PostgreSQL ${as} operation failed. Verify service, host/port, credentials, ownership and privileges. Existing passwords were not changed. No SQL/credentials are printed.`,
      );
    return result.stdout.trim();
  }

  // Query and refuse foreign ownership/data before creating any account.
  query('SELECT 1;', 'admin', adminDatabase);
  const databaseOwner = query(
    `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=${literal(target.database)};`,
    'admin',
    adminDatabase,
  );
  if (databaseOwner && databaseOwner !== target.user)
    fail(
      `Database ${target.database} exists but is owned by ${databaseOwner}, not ${target.user}; refusing to change its owner.`,
    );
  if (databaseOwner) {
    const hasObjects = Number(
      query(
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f');",
      ),
    );
    if (hasObjects > 0) {
      const known = query(
        `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AND to_regclass('public."User"') IS NOT NULL AND to_regclass('public."Asset"') IS NOT NULL AND to_regclass('public."AssetHistory"') IS NOT NULL AND to_regclass('public."AuditLog"') IS NOT NULL;`,
      );
      if (known !== 't')
        fail(
          'Database is not empty and is not a migrated INFOCUS asset database. Refusing to adopt or reset it. Choose a new database or review a baseline separately.',
        );
      const migrationDirectory = path.join(backend, 'prisma/migrations');
      const committed = new Set(
        fs
          .readdirSync(migrationDirectory, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isDirectory() &&
              fs.existsSync(path.join(migrationDirectory, entry.name, 'migration.sql')),
          )
          .map((entry) => entry.name),
      );
      const recorded = query(
        'SELECT migration_name FROM public."_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY started_at;',
      )
        .split('\n')
        .filter(Boolean);
      if (!recorded.length || recorded.some((name) => !committed.has(name))) {
        fail(
          'Existing migration history does not match the committed INFOCUS migrations. Refusing to adopt the database or deploy an older/unrelated checkout. No migration records were changed.',
        );
      }
    }
    info('Database exists; retaining its ownership and data.');
  }
  function ensureRole(user, password) {
    const existing = query(`SELECT 1 FROM pg_roles WHERE rolname=${literal(user)};`, 'admin', adminDatabase);
    if (existing === '1') {
      info(`Role ${user} exists; preserving its password.`);
      return;
    }
    query(
      `CREATE ROLE ${quoted(user)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)};`,
      'admin',
      adminDatabase,
    );
    info(`Created role ${user}.`);
  }
  ensureRole(target.user, target.password);
  if (!databaseOwner) {
    query(
      `CREATE DATABASE ${quoted(target.database)} OWNER ${quoted(target.user)} ENCODING 'UTF8' TEMPLATE template0;`,
      'admin',
      adminDatabase,
    );
    info('Created the application database.');
  }
  if (query('SELECT current_user;', 'owner') !== target.user)
    fail('The database-owner connection resolved to an unexpected account.');
  if (options.skip) {
    info('Database owner login verified. Schema migration was skipped.');
    return;
  }

  function verifyRuntimeRelations() {
    const safe = query(`SELECT NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND (
        c.relowner=(SELECT oid FROM pg_roles WHERE rolname=${literal(runtimeUser)})
        OR CASE WHEN c.relkind IN ('r','p','v','m','f')
          THEN has_table_privilege(${literal(runtimeUser)},c.oid,'TRUNCATE') ELSE false END
      )
    );`);
    if (safe !== 't')
      fail(
        'Runtime role owns public relations or has TRUNCATE privileges. Refusing to change existing ownership/grants; review and remove the excessive permissions explicitly.',
      );
  }
  if (runtimeUser) {
    ensureRole(runtimeUser, runtimePassword);
    const elevated = query(
      `SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolcanlogin OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) FROM pg_roles WHERE rolname=${literal(runtimeUser)};`,
      'admin',
      adminDatabase,
    );
    if (elevated !== 'f')
      fail(
        'Runtime role has elevated privileges, memberships, or disabled login. Refusing to modify that existing role.',
      );
    verifyRuntimeRelations();
    // CONNECT is required to verify credentials when PUBLIC access has been revoked.
    // Verify login before applying migrations or granting application data access.
    query(`GRANT CONNECT ON DATABASE ${quoted(target.database)} TO ${quoted(runtimeUser)};`, 'owner');
    if (query('SELECT current_user;', 'runtime') !== runtimeUser)
      fail('Runtime database login did not match the requested account.');
  }

  const prismaCli = path.join(root, 'node_modules/prisma/build/index.js');
  if (!fs.existsSync(prismaCli))
    fail('Prisma is not installed. Run npm ci in the project root and rerun setup.');
  function prisma(...args) {
    const result = spawnSync(process.execPath, [prismaCli, ...args], {
      cwd: backend,
      env: { ...env, DATABASE_URL: env.DATABASE_URL },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
      // Prisma errors may contain connection details; emit a task-specific safe summary.
      const detail = `${result.error?.code ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      let guidance = 'Inspect migrations and connection configuration.';
      if (/\b(?:EPERM|EACCES)\b|operation not permitted|permission denied|access is denied/i.test(detail)) {
        guidance =
          'A file/process permission or lock prevented Prisma from running. Check project permissions and security software; stop only the process locking this project and retry. Client generation is intentionally separate from this helper.';
      } else if (
        /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|unable to (?:verify|get local issuer)|certificate has expired|download|fetch failed|binaries\.prisma\.sh/i.test(
          detail,
        )
      ) {
        guidance =
          'Prisma could not obtain or reach a required engine/network resource. Check internet/proxy access and trusted CA certificates, run npm ci if engines are missing, and retry without resetting the database.';
      } else if (/\bP100[012]\b|ECONNREFUSED|authentication failed|can.t reach database/i.test(detail)) {
        guidance =
          'Verify PostgreSQL service status, connection host/port, and the configured schema-owner credentials.';
      }
      fail(
        `Prisma ${args.join(' ')} failed. ${guidance} Existing credentials were not changed. No automatic reset, rollback, or baseline was performed; review migration status before retrying.`,
      );
    }
    info(`Prisma ${args.join(' ')} succeeded.`);
  }
  prisma('migrate', 'deploy');
  prisma('migrate', 'status');
  const schema = fs.readFileSync(path.join(backend, 'prisma/schema.prisma'), 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
  const missing = query(
    `SELECT name FROM (VALUES ${models.map((name) => `(${literal(name)})`).join(',')}) expected(name) WHERE to_regclass('public.' || quote_ident(name)) IS NULL;`,
    'owner',
  );
  if (missing) fail(`Missing application tables: ${missing.split('\n').join(', ')}.`);
  const guards = query(
    `SELECT
    (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('AssetAssignment_one_active_per_asset','Offboarding_one_in_progress_per_employee') AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL) = 2
    AND (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname IN ('AssetHistory_append_only','AssetHistory_no_truncate','AuditLog_append_only','AuditLog_no_truncate') AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')) = 4
    AND (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='c' AND c.convalidated AND c.conname IN ('AssetAssignment_return_chronology','AssetAssignment_expected_return_chronology','Asset_purchase_cost_nonnegative','Asset_warranty_chronology','AssetRepair_cost_nonnegative','AssetRepair_chronology','AssetTransfer_different_employees','AssetMovement_different_locations','Offboarding_chronology')) = 9;`,
    'owner',
  );
  if (guards !== 't')
    fail(
      'Required custody indexes, chronology constraints or append-only history triggers are missing/disabled. Review schema drift; setup will not silently recreate protections.',
    );
  info(
    `Verified ${models.length} application tables, both custody indexes, nine checks and all four history triggers.`,
  );

  if (runtimeUser) {
    // Revoke CREATE inherited through PUBLIC (not changed on a database unless runtime separation is requested).
    query(
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${quoted(target.database)} TO ${quoted(runtimeUser)};
      GRANT USAGE ON SCHEMA public TO ${quoted(runtimeUser)};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoted(runtimeUser)};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoted(runtimeUser)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${quoted(target.user)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoted(runtimeUser)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${quoted(target.user)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quoted(runtimeUser)};
      REVOKE ALL ON TABLE public."_prisma_migrations" FROM ${quoted(runtimeUser)};`,
      'owner',
    );
    verifyRuntimeRelations();
    const permissions = query(
      `SELECT has_table_privilege(current_user,'public."Asset"','SELECT')
      AND has_table_privilege(current_user,'public."Asset"','INSERT')
      AND has_table_privilege(current_user,'public."Asset"','UPDATE')
      AND has_table_privilege(current_user,'public."Asset"','DELETE')
      AND NOT has_schema_privilege(current_user,'public','CREATE')
      AND NOT has_database_privilege(current_user,current_database(),'CREATE')
      AND NOT pg_has_role(current_user,${literal(target.user)},'MEMBER');`,
      'runtime',
    );
    if (permissions !== 't')
      fail(
        'Runtime permissions did not meet the non-owner/no-CREATE/no-TRUNCATE requirements. Review existing grants.',
      );
    info('Runtime login and non-owner data permissions verified.');
  }
  info('Database setup complete. No demo data or administrator account was inserted.');
}

main().catch((error) => {
  console.error(
    `[INFOCUS DB] ${error.code === 'ERR_MODULE_NOT_FOUND' ? 'Run npm ci before using database setup.' : error.message}`,
  );
  process.exitCode = 1;
});
