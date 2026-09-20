/**
 * Opt-in PostgreSQL integration coverage for the first-install account and login.
 * Run: node --import tsx --test scripts/tests/installer-admin.test.mjs
 * SETUP_DB_TEST_ADMIN_URL must point to a PostgreSQL administrative connection.
 * Only a fresh, randomly named fixture database and its two roles are modified.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const adminUrl = process.env.SETUP_DB_TEST_ADMIN_URL;

test(
  'installer administrator bootstrap and username login on isolated PostgreSQL',
  {
    skip: !adminUrl,
    timeout: 300000,
  },
  async (t) => {
    const adminConnection = new URL(adminUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(adminConnection.protocol));
    const suffix = randomBytes(6).toString('hex');
    const database = `infocus_installer_${suffix}_test`;
    const owner = `infocus_inst_owner_${suffix}`;
    const runtime = `infocus_inst_runtime_${suffix}`;
    const ownerPassword = randomBytes(24).toString('hex');
    const runtimePassword = randomBytes(24).toString('hex');
    const psql =
      process.env.PSQL_BIN ||
      (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe' : 'psql');
    const admin = {
      PGHOST: adminConnection.hostname.replace(/^\[|\]$/g, ''),
      PGPORT: adminConnection.port || '5432',
      PGUSER: decodeURIComponent(adminConnection.username),
      PGPASSWORD: decodeURIComponent(adminConnection.password),
      PGDATABASE: decodeURIComponent(adminConnection.pathname.slice(1)) || 'postgres',
      PGSSLMODE: adminConnection.searchParams.get('sslmode') || 'prefer',
      PGCONNECT_TIMEOUT: '10',
    };
    const childEnv = { ...process.env };
    // Ignore inherited libpq routing overrides so the fixture uses only this URL.
    for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PG_ADMIN_OS_USER'])
      delete childEnv[key];
    function adminSql(query) {
      const result = spawnSync(psql, ['-X', '-w', '-q', '-A', '-t', '--set=ON_ERROR_STOP=1'], {
        input: query,
        env: { ...childEnv, ...admin },
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
      });
      assert.equal(result.status, 0, 'Fixture administration failed (credentials and SQL omitted).');
      return result.stdout.trim();
    }
    const ownerUrl = new URL(adminConnection);
    ownerUrl.username = owner;
    ownerUrl.password = ownerPassword;
    ownerUrl.pathname = `/${database}`;
    ownerUrl.search = '';
    ownerUrl.searchParams.set('schema', 'public');
    ownerUrl.searchParams.set('sslmode', admin.PGSSLMODE);
    const runtimeUrl = new URL(ownerUrl);
    runtimeUrl.username = runtime;
    runtimeUrl.password = runtimePassword;
    runtimeUrl.searchParams.set('connection_limit', '4');
    runtimeUrl.searchParams.set('pool_timeout', '10');

    let db, server;
    let fixtureNamesVerified = false;
    const runtimeEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: runtimeUrl.href,
      JWT_SECRET: randomBytes(48).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
      JWT_EXPIRES_IN: '15m',
      REFRESH_TOKEN_EXPIRES_IN: '1d',
      REMEMBER_TOKEN_EXPIRES_IN: '30d',
      CORS_ORIGIN: 'http://127.0.0.1:5173',
      APP_URL: 'http://127.0.0.1:5173',
      PORT: '5000',
      TRUST_PROXY_HOPS: '0',
      LOG_LEVEL: 'silent',
      DOTENV_CONFIG_QUIET: 'true',
    };
    const originalEnv = Object.fromEntries(Object.keys(runtimeEnv).map((key) => [key, process.env[key]]));
    const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    try {
      // Prove names did not exist before setup; cleanup never targets a caller-supplied database.
      assert.match(database, /^infocus_installer_[a-f0-9]{12}_test$/);
      assert.equal(adminSql(`SELECT count(*) FROM pg_database WHERE datname='${database}';`), '0');
      assert.equal(
        adminSql(`SELECT count(*) FROM pg_roles WHERE rolname IN ('${owner}','${runtime}');`),
        '0',
      );
      fixtureNamesVerified = true;
      const setup = spawnSync(process.execPath, [path.join(root, 'scripts/setup-db.mjs')], {
        cwd: root,
        env: {
          ...childEnv,
          PSQL_BIN: psql,
          DATABASE_URL: ownerUrl.href,
          PG_ADMIN_HOST: admin.PGHOST,
          PG_ADMIN_PORT: admin.PGPORT,
          PG_ADMIN_USER: admin.PGUSER,
          PG_ADMIN_PASSWORD: admin.PGPASSWORD,
          PG_ADMIN_DATABASE: admin.PGDATABASE,
          DB_RUNTIME_USER: runtime,
          DB_RUNTIME_PASSWORD: runtimePassword,
        },
        encoding: 'utf8',
        timeout: 180000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      assert.equal(setup.status, 0, 'Fresh fixture setup and migrations must succeed (output omitted).');
      Object.assign(process.env, runtimeEnv);
      const { ensureInstallerAdmin, InstallerAdminConflict, installerAdmin } =
        await import('../../backend/src/services/installer-admin.ts');
      const { default: bcrypt } = await import('bcryptjs');
      ({ prisma: db } = await import('../../backend/src/db.ts'));
      const { app } = await import('../../backend/src/app.ts');
      server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}/api`;
      async function api(method, route, body, token) {
        const response = await fetch(base + route, {
          method,
          headers: {
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15000),
        });
        return { status: response.status, body: await response.json() };
      }
      const login = (identifier, password = installerAdmin.password) =>
        api('POST', '/auth/login', { identifier, password });
      const snapshot = async () =>
        digest({
          users: await db.user.findMany({ orderBy: { id: 'asc' } }),
          employees: await db.employee.findMany({ orderBy: { id: 'asc' } }),
          audits: await db.auditLog.findMany({ orderBy: { id: 'asc' } }),
        });
      const fixtureHash = await bcrypt.hash('Fixture-existing@12345', 4);
      const fixtureUser = (overrides = {}) =>
        db.user.create({
          data: {
            email: `fixture-${randomBytes(4).toString('hex')}@example.invalid`,
            name: 'Existing account fixture',
            passwordHash: fixtureHash,
            role: 'ASSET_MANAGER',
            active: true,
            mustChangePassword: false,
            ...overrides,
          },
        });
      let bootstrapUser, token;

      await t.test('bootstrap runs against an empty database using a non-owner runtime role', async () => {
        const [identity] = await db.$queryRaw`SELECT current_user AS username, current_database() AS database,
        has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
        has_table_privilege(current_user, 'public."User"', 'INSERT') AS can_insert,
        has_table_privilege(current_user, 'public."AuditLog"', 'TRUNCATE') AS can_truncate_audit`;
        assert.equal(identity.username, runtime);
        assert.equal(identity.database, database);
        assert.equal(identity.can_create, false);
        assert.equal(identity.can_insert, true);
        assert.equal(identity.can_truncate_audit, false);
        await assert.rejects(
          db.$executeRawUnsafe('CREATE TABLE public.installer_privilege_probe (id integer)'),
        );
        assert.equal(await db.user.count(), 0);
        assert.equal(await db.employee.count(), 0);
      });

      await t.test(
        'a disabled administrator with a different username is preserved without creating an installer account',
        async () => {
          const existing = await fixtureUser({ username: 'existing-admin', role: 'ADMIN', active: false });
          try {
            const before = await snapshot();
            assert.equal(await ensureInstallerAdmin(db), 'existing-admin');
            assert.equal(await snapshot(), before);
            assert.equal(await db.user.count({ where: { username: 'amdin' } }), 0);
          } finally {
            await db.user.delete({ where: { id: existing.id } });
          }
        },
      );

      await t.test(
        'case-insensitive username collision refuses bootstrap without changing any records',
        async () => {
          const existing = await fixtureUser({ username: 'AMDiN' });
          try {
            const before = await snapshot();
            await assert.rejects(ensureInstallerAdmin(db), InstallerAdminConflict);
            assert.equal(await snapshot(), before);
            assert.equal(await db.user.count({ where: { role: 'ADMIN' } }), 0);
          } finally {
            await db.user.delete({ where: { id: existing.id } });
          }
        },
      );

      await t.test(
        'reserved email and ambiguous email identifier collisions are refused without modifications',
        async () => {
          for (const email of ['AMDIN@INFOCUS.INVALID', 'AMDiN']) {
            // The second fixture represents legacy direct database data, not a valid new user API request.
            const existing = await fixtureUser({ email, username: 'another-user' });
            try {
              const before = await snapshot();
              await assert.rejects(ensureInstallerAdmin(db), InstallerAdminConflict);
              assert.equal(await snapshot(), before);
              assert.equal(await db.user.count({ where: { role: 'ADMIN' } }), 0);
            } finally {
              await db.user.delete({ where: { id: existing.id } });
            }
          }
        },
      );

      await t.test(
        'case-insensitive employee identifier collision is refused and the employee is untouched',
        async () => {
          const existing = await db.employee.create({
            data: {
              employeeId: 'AMDIN',
              name: 'Employee identifier fixture',
              email: 'employee@example.invalid',
            },
          });
          try {
            const before = await snapshot();
            await assert.rejects(ensureInstallerAdmin(db), InstallerAdminConflict);
            assert.equal(await snapshot(), before);
            assert.equal(await db.user.count(), 0);
          } finally {
            await db.employee.delete({ where: { id: existing.id } });
          }
        },
      );

      await t.test(
        'concurrent bootstraps create exactly one hashed administrator and one secret-free audit record',
        async () => {
          const results = await Promise.all([ensureInstallerAdmin(db), ensureInstallerAdmin(db)]);
          assert.deepEqual(results.sort(), ['created', 'existing-admin']);
          assert.equal(await db.user.count(), 1);
          bootstrapUser = await db.user.findFirstOrThrow();
          assert.equal(bootstrapUser.username, 'amdin');
          assert.equal(bootstrapUser.email, 'amdin@infocus.invalid');
          assert.equal(bootstrapUser.role, 'ADMIN');
          assert.equal(bootstrapUser.active, true);
          assert.equal(bootstrapUser.mustChangePassword, true);
          assert.equal(bootstrapUser.employeeId, null);
          assert.equal(await db.employee.count(), 0);
          assert.match(bootstrapUser.passwordHash, /^\$2[aby]\$12\$/);
          assert.equal(await bcrypt.compare('Admin@123', bootstrapUser.passwordHash), true);
          const audits = await db.auditLog.findMany();
          assert.equal(audits.length, 1);
          assert.equal(audits[0].action, 'ADMIN_BOOTSTRAPPED');
          assert.equal(audits[0].entityId, bootstrapUser.id);
          assert.equal(audits[0].details.source, 'installer');
          const auditText = JSON.stringify(audits);
          assert.equal(auditText.includes('Admin@123'), false);
          assert.equal(auditText.includes(bootstrapUser.passwordHash), false);
          assert.equal(auditText.includes('passwordHash'), false);
          await assert.rejects(
            db.auditLog.update({ where: { id: audits[0].id }, data: { action: 'ALTERED' } }),
          );
          assert.equal(
            (await db.auditLog.findUniqueOrThrow({ where: { id: audits[0].id } })).action,
            'ADMIN_BOOTSTRAPPED',
          );
        },
      );

      await t.test(
        'username login accepts trimmed mixed case, rejects wrong credentials, and gates protected routes',
        async () => {
          for (const identifier of ['amdin', '  AMDiN  ', installerAdmin.email]) {
            const result = await login(identifier);
            assert.equal(result.status, 200);
            assert.equal(result.body.data.user.id, bootstrapUser.id);
            assert.equal(result.body.data.user.mustChangePassword, true);
            assert.equal('passwordHash' in result.body.data.user, false);
            token = result.body.data.accessToken;
            assert.equal(typeof token, 'string');
          }
          for (const [identifier, password] of [
            ['amdin', 'wrong-password'],
            ['admin', installerAdmin.password],
          ]) {
            const result = await login(identifier, password);
            assert.equal(result.status, 401);
            assert.equal(result.body.errorCode, 'INVALID_CREDENTIALS');
            assert.equal(result.body.data, undefined);
          }
          // Existing username identity must win if later legacy data introduces an ambiguous identifier.
          const shadowEmployee = await db.employee.create({
            data: {
              employeeId: 'amdin',
              name: 'Later employee fixture',
              email: 'later-employee@example.invalid',
            },
          });
          const shadow = await fixtureUser({ email: 'amdin', employeeId: shadowEmployee.id });
          try {
            const preferred = await login('amdin');
            assert.equal(preferred.status, 200);
            assert.equal(preferred.body.data.user.id, bootstrapUser.id);
            assert.equal((await login('amdin', 'Fixture-existing@12345')).status, 401);
          } finally {
            await db.user.delete({ where: { id: shadow.id } });
            await db.employee.delete({ where: { id: shadowEmployee.id } });
          }
          assert.equal((await api('GET', '/auth/me', undefined, token)).status, 200);
          for (const [method, route, body] of [
            ['GET', '/dashboard/summary', undefined],
            ['GET', '/assets', undefined],
            ['POST', '/assets', {}],
          ]) {
            const result = await api(method, route, body, token);
            assert.equal(result.status, 403);
            assert.equal(result.body.errorCode, 'PASSWORD_CHANGE_REQUIRED');
          }
          assert.equal((await api('POST', '/auth/logout', undefined, token)).status, 200);
        },
      );

      await t.test(
        'required password change unlocks access and rerun preserves the changed password and account',
        async () => {
          const newPassword = 'Changed-installer@12345';
          const changed = await api(
            'POST',
            '/auth/change-password',
            {
              currentPassword: 'Admin@123',
              newPassword,
            },
            token,
          );
          assert.equal(changed.status, 200);
          assert.equal(changed.body.data.user.mustChangePassword, false);
          assert.equal(
            (await api('GET', '/dashboard/summary', undefined, changed.body.data.accessToken)).status,
            200,
          );
          assert.equal((await api('GET', '/auth/me', undefined, token)).status, 401);
          const saved = await db.user.findUniqueOrThrow({ where: { id: bootstrapUser.id } });
          assert.equal(await bcrypt.compare(newPassword, saved.passwordHash), true);
          assert.equal(saved.passwordHash === bootstrapUser.passwordHash, false);
          const before = await snapshot();
          assert.equal(await ensureInstallerAdmin(db), 'existing-admin');
          assert.equal(await snapshot(), before);
          assert.equal((await login('amdin', newPassword)).status, 200);
          assert.equal((await login('amdin', 'Admin@123')).status, 401);
          assert.equal(await db.auditLog.count({ where: { action: 'ADMIN_BOOTSTRAPPED' } }), 1);
          assert.equal(await db.auditLog.count({ where: { action: 'PASSWORD_CHANGED' } }), 1);
          const auditText = JSON.stringify(await db.auditLog.findMany());
          for (const secret of ['Admin@123', newPassword, saved.passwordHash, bootstrapUser.passwordHash])
            assert.equal(auditText.includes(secret), false);
        },
      );

      await t.test(
        'rerun never re-enables a disabled installer administrator or rotates its password',
        async () => {
          await db.user.update({ where: { id: bootstrapUser.id }, data: { active: false } });
          const before = await snapshot();
          assert.equal(await ensureInstallerAdmin(db), 'existing-admin');
          assert.equal(await snapshot(), before);
          assert.equal(await db.user.count(), 1);
          assert.equal((await login('amdin', 'Changed-installer@12345')).status, 401);
          const installer = spawnSync(
            process.execPath,
            ['--import', 'tsx', path.join(root, 'backend/scripts/bootstrap-installer-admin.ts')],
            { cwd: root, env: process.env, encoding: 'utf8', windowsHide: true, timeout: 30000 },
          );
          assert.equal(installer.status, 0);
          assert.equal(installer.stdout.trim(), 'existing-admin');
          assert.equal(installer.stderr.trim(), '');
          for (const secret of ['Admin@123', 'Changed-installer@12345', runtimePassword])
            assert.equal((installer.stdout + installer.stderr).includes(secret), false);
          assert.equal(await snapshot(), before);
          const manualPassword = 'Manual-admin-fixture@12345';
          const manual = spawnSync(
            process.execPath,
            ['--import', 'tsx', path.join(root, 'backend/scripts/create-admin.ts')],
            {
              cwd: root,
              env: {
                ...process.env,
                ADMIN_EMAIL: 'manual@example.invalid',
                ADMIN_NAME: 'Manual fixture',
                ADMIN_PASSWORD: manualPassword,
              },
              encoding: 'utf8',
              windowsHide: true,
              timeout: 30000,
            },
          );
          assert.equal(manual.status, 1);
          assert.match(manual.stderr, /administrator already exists/i);
          assert.equal((manual.stdout + manual.stderr).includes(manualPassword), false);
          assert.equal(await snapshot(), before);
        },
      );
    } finally {
      // Close every app connection before dropping only the verified random fixture.
      try {
        if (server)
          await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          });
      } finally {
        try {
          if (db) await db.$disconnect();
        } finally {
          for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
          if (fixtureNamesVerified) {
            assert.match(database, /^infocus_installer_[a-f0-9]{12}_test$/);
            const foundOwner = adminSql(
              `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='${database}';`,
            );
            if (foundOwner) {
              assert.equal(foundOwner, owner, 'Refusing cleanup: fixture database owner changed.');
              adminSql(`DROP DATABASE "${database}";`);
            }
            for (const role of [runtime, owner]) {
              assert.match(role, /^infocus_inst_(runtime|owner)_[a-f0-9]{12}$/);
              if (adminSql(`SELECT 1 FROM pg_roles WHERE rolname='${role}';`) === '1')
                adminSql(`DROP ROLE "${role}";`);
            }
          }
        }
      }
    }
  },
);
