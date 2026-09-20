/** Opt-in real PostgreSQL setup verification. Creates and removes only unique test databases/roles. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const helper = path.join(root, 'scripts/setup-db.mjs');
const adminUrl = process.env.SETUP_DB_TEST_ADMIN_URL;

test(
  'database setup preserves data, verifies schema, and restricts the runtime account',
  { skip: !adminUrl, timeout: 180000 },
  async (t) => {
    const url = new URL(adminUrl);
    const suffix = randomBytes(5).toString('hex');
    const database = `infocus_setup_${suffix}_test`;
    const foreign = `infocus_foreign_${suffix}_test`;
    const owner = `infocus_owner_${suffix}`;
    const runtime = `infocus_runtime_${suffix}`;
    const ownerPassword = `Test-${randomBytes(16).toString('hex')}-'@:$`;
    const runtimePassword = randomBytes(24).toString('hex');
    const psql =
      process.env.PSQL_BIN ||
      (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe' : 'psql');
    const admin = {
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
    };
    function sql(query, overrides = {}, allowFailure = false) {
      const result = spawnSync(psql, ['-X', '-w', '-q', '-A', '-t', '--set=ON_ERROR_STOP=1'], {
        input: query,
        env: { ...process.env, ...admin, ...overrides },
        encoding: 'utf8',
        windowsHide: true,
      });
      if (!allowFailure)
        assert.equal(result.status, 0, 'Fixture SQL must succeed (credentials/SQL intentionally omitted).');
      return { status: result.status, output: result.stdout?.trim() };
    }
    const target = new URL(adminUrl);
    target.username = owner;
    target.password = ownerPassword;
    target.pathname = `/${database}`;
    target.search = '?schema=public';
    const base = {
      ...process.env,
      PSQL_BIN: psql,
      DATABASE_URL: target.href,
      PG_ADMIN_HOST: admin.PGHOST,
      PG_ADMIN_PORT: admin.PGPORT,
      PG_ADMIN_USER: admin.PGUSER,
      PG_ADMIN_PASSWORD: admin.PGPASSWORD,
      PG_ADMIN_DATABASE: admin.PGDATABASE,
      DB_RUNTIME_USER: runtime,
      DB_RUNTIME_PASSWORD: runtimePassword,
    };
    delete base.PG_ADMIN_OS_USER;
    function setup(overrides = {}, args = []) {
      return spawnSync(process.execPath, [helper, ...args], {
        cwd: root,
        env: { ...base, ...overrides },
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
    }
    function succeeded(result) {
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    try {
      await t.test('fresh setup creates roles, database, versioned schema and least-privilege access', () => {
        succeeded(setup());
        assert.equal(sql('SELECT count(*) FROM public."User";', { PGDATABASE: database }).output, '0');
        assert.equal(
          sql('SELECT current_user;', { PGDATABASE: database, PGUSER: runtime, PGPASSWORD: runtimePassword })
            .output,
          runtime,
        );
        assert.equal(
          sql(
            `SELECT has_table_privilege(current_user,'public."Asset"','SELECT'), has_table_privilege(current_user,'public."Asset"','INSERT'), has_table_privilege(current_user,'public."Asset"','UPDATE'), has_table_privilege(current_user,'public."Asset"','DELETE');`,
            { PGDATABASE: database, PGUSER: runtime, PGPASSWORD: runtimePassword },
          ).output,
          't|t|t|t',
        );
        assert.notEqual(
          sql(
            'ALTER TABLE public."Asset" ADD COLUMN forbidden integer;',
            { PGDATABASE: database, PGUSER: runtime, PGPASSWORD: runtimePassword },
            true,
          ).status,
          0,
        );
        assert.notEqual(
          sql(
            'TRUNCATE public."AssetHistory";',
            { PGDATABASE: database, PGUSER: runtime, PGPASSWORD: runtimePassword },
            true,
          ).status,
          0,
        );
      });
      await t.test('rerun preserves existing rows and migration history', () => {
        sql(
          `INSERT INTO public."Department" (id,name) VALUES ('00000000-0000-4000-8000-000000000001','Setup preservation fixture');`,
          { PGDATABASE: database },
        );
        const migrations = sql('SELECT count(*) FROM public."_prisma_migrations";', {
          PGDATABASE: database,
        }).output;
        succeeded(setup());
        assert.equal(sql('SELECT count(*) FROM public."Department";', { PGDATABASE: database }).output, '1');
        assert.equal(
          sql('SELECT count(*) FROM public."_prisma_migrations";', { PGDATABASE: database }).output,
          migrations,
        );
      });
      await t.test('wrong existing role password fails without rotation', () => {
        const wrong = new URL(target);
        wrong.password = 'Wrong-password-no-overwrite';
        assert.notEqual(setup({ DATABASE_URL: wrong.href }).status, 0);
        assert.equal(
          sql('SELECT current_user;', { PGDATABASE: database, PGUSER: owner, PGPASSWORD: ownerPassword })
            .output,
          owner,
        );
      });
      await t.test(
        'wrong existing runtime password fails without rotating credentials or changing data',
        () => {
          const wrongPassword = 'Incorrect-runtime-password-no-overwrite';
          const failed = setup({ DB_RUNTIME_PASSWORD: wrongPassword });
          assert.notEqual(failed.status, 0);
          assert.match(failed.stderr, /PostgreSQL runtime operation failed/);
          assert.ok(!`${failed.stdout}${failed.stderr}`.includes(wrongPassword));
          assert.ok(!`${failed.stdout}${failed.stderr}`.includes(runtimePassword));
          assert.equal(
            sql('SELECT current_user;', {
              PGDATABASE: database,
              PGUSER: runtime,
              PGPASSWORD: runtimePassword,
            }).output,
            runtime,
          );
          assert.equal(
            sql('SELECT count(*) FROM public."Department";', { PGDATABASE: database }).output,
            '1',
          );
        },
      );
      await t.test(
        'existing TRUNCATE grants on inventory tables are refused without changing grants or data',
        () => {
          sql(`GRANT TRUNCATE ON public."Department" TO "${runtime}";`, { PGDATABASE: database });
          try {
            const failed = setup();
            assert.notEqual(failed.status, 0);
            assert.match(failed.stderr, /owns public relations or has TRUNCATE/);
            assert.equal(
              sql("SELECT has_table_privilege(current_user,'public.\"Department\"','TRUNCATE');", {
                PGDATABASE: database,
                PGUSER: runtime,
                PGPASSWORD: runtimePassword,
              }).output,
              't',
            );
            assert.equal(
              sql('SELECT count(*) FROM public."Department";', { PGDATABASE: database }).output,
              '1',
            );
          } finally {
            sql(`REVOKE TRUNCATE ON public."Department" FROM "${runtime}";`, { PGDATABASE: database });
          }
        },
      );
      await t.test(
        'runtime ownership of a public relation is refused and retained for explicit review',
        () => {
          sql(
            `CREATE TABLE public.setup_runtime_owned (id integer); INSERT INTO public.setup_runtime_owned VALUES (42); ALTER TABLE public.setup_runtime_owned OWNER TO "${runtime}";`,
            { PGDATABASE: database },
          );
          try {
            const failed = setup();
            assert.notEqual(failed.status, 0);
            assert.match(failed.stderr, /owns public relations or has TRUNCATE/);
            assert.equal(
              sql(
                "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.setup_runtime_owned'::regclass;",
                { PGDATABASE: database },
              ).output,
              runtime,
            );
            assert.equal(
              sql('SELECT id FROM public.setup_runtime_owned;', {
                PGDATABASE: database,
                PGUSER: runtime,
                PGPASSWORD: runtimePassword,
              }).output,
              '42',
            );
          } finally {
            sql('DROP TABLE public.setup_runtime_owned;', { PGDATABASE: database });
          }
        },
      );
      await t.test('unknown migration history is refused without editing records or existing data', () => {
        const original = sql(
          'SELECT migration_name FROM public."_prisma_migrations" ORDER BY started_at LIMIT 1;',
          { PGDATABASE: database },
        ).output;
        assert.match(original, /^[A-Za-z0-9_]+$/);
        const foreignMigration = '20990101000000_unrelated_application';
        sql(
          `UPDATE public."_prisma_migrations" SET migration_name='${foreignMigration}' WHERE migration_name='${original}';`,
          { PGDATABASE: database },
        );
        try {
          const failed = setup();
          assert.notEqual(failed.status, 0);
          assert.match(failed.stderr, /migration history does not match/);
          assert.equal(
            sql(
              `SELECT count(*) FROM public."_prisma_migrations" WHERE migration_name='${foreignMigration}';`,
              { PGDATABASE: database },
            ).output,
            '1',
          );
          assert.equal(
            sql('SELECT count(*) FROM public."Department";', { PGDATABASE: database }).output,
            '1',
          );
        } finally {
          sql(
            `UPDATE public."_prisma_migrations" SET migration_name='${original}' WHERE migration_name='${foreignMigration}';`,
            { PGDATABASE: database },
          );
        }
      });
      await t.test('missing schema protection is detected without silently changing it', () => {
        sql('ALTER TABLE public."AssetHistory" DISABLE TRIGGER "AssetHistory_append_only";', {
          PGDATABASE: database,
        });
        const failed = setup();
        assert.notEqual(failed.status, 0);
        assert.match(failed.stderr, /history triggers are missing\/disabled/);
        sql('ALTER TABLE public."AssetHistory" ENABLE TRIGGER "AssetHistory_append_only";', {
          PGDATABASE: database,
        });
      });
      await t.test('unrelated nonempty database is refused and retains its contents', () => {
        sql(`CREATE DATABASE "${foreign}" OWNER "${owner}";`);
        sql('CREATE TABLE public.legacy_record (id integer); INSERT INTO public.legacy_record VALUES (42);', {
          PGDATABASE: foreign,
        });
        const other = new URL(target);
        other.pathname = `/${foreign}`;
        const failed = setup({ DATABASE_URL: other.href });
        assert.notEqual(failed.status, 0);
        assert.match(failed.stderr, /not empty/);
        assert.equal(sql('SELECT id FROM public.legacy_record;', { PGDATABASE: foreign }).output, '42');
        assert.equal(
          sql(`SELECT to_regclass('public."_prisma_migrations"') IS NULL;`, { PGDATABASE: foreign }).output,
          't',
        );
      });
      await t.test('different database owner and reserved database names are rejected', () => {
        const different = new URL(target);
        different.username = runtime;
        different.password = runtimePassword;
        assert.match(
          setup({ DATABASE_URL: different.href, DB_RUNTIME_USER: '', DB_RUNTIME_PASSWORD: '' }).stderr,
          /owned by/,
        );
        const reserved = new URL(target);
        reserved.pathname = '/postgres';
        assert.match(
          setup({ DATABASE_URL: reserved.href }, ['--dry-run']).stderr,
          /dedicated application database/,
        );
      });
    } finally {
      for (const name of [foreign, database]) {
        assert.match(name, /^infocus_(setup|foreign)_[a-f0-9]{10}_test$/);
        const foundOwner = sql(
          `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='${name}';`,
        ).output;
        if (foundOwner) {
          assert.equal(foundOwner, owner);
          sql(`DROP DATABASE "${name}";`);
        }
      }
      for (const role of [runtime, owner]) {
        assert.match(role, /^infocus_(runtime|owner)_[a-f0-9]{10}$/);
        if (sql(`SELECT 1 FROM pg_roles WHERE rolname='${role}';`).output === '1')
          sql(`DROP ROLE "${role}";`);
      }
    }
  },
);
