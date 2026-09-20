import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.test'), override: true });
const databaseUrl = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid');
if (!databaseUrl.pathname.endsWith('_test'))
  throw new Error(
    'Integration tests require a separate database whose name ends in _test. Configure backend/.env.test.',
  );
process.env.NODE_ENV = 'test';
const { app } = await import('../src/app.js');
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server did not start');
const base = `http://127.0.0.1:${address.port}/api`;
const db = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const results: { name: string; passed: boolean; error?: string }[] = [];
type ResponseData = { status: number; body: any; response: Response };
async function api(
  method: string,
  route: string,
  token?: string,
  body?: unknown,
  cookie?: string,
): Promise<ResponseData> {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  return {
    status: response.status,
    body: contentType.includes('json') ? await response.json() : await response.arrayBuffer(),
    response,
  };
}
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.error(`FAIL ${name}: ${message}`);
  }
}
function ok(r: ResponseData, expected?: number) {
  assert.ok(
    expected ? r.status === expected : r.status >= 200 && r.status < 300,
    `HTTP ${r.status}: ${JSON.stringify(r.body)}`,
  );
  assert.equal(r.body.success, true, JSON.stringify(r.body));
  return r.body.data;
}
let admin = '',
  manager = '',
  employee = '',
  cookie = '';
let lookups: any, john: any, david: any, laptop: any;
let baseline: any;
const createAsset = async (tag: string, overrides: Record<string, unknown> = {}) =>
  ok(
    await api('POST', '/assets', admin, {
      assetTag: `${tag}-${suffix}`,
      assetType: 'Laptop',
      categoryId: lookups.categories[0].id,
      manufacturer: 'Integration Test',
      model: 'Lifecycle verification',
      serialNumber: `SN-${tag}-${suffix}`,
      condition: 'GOOD',
      locationId: lookups.locations[0].id,
      departmentId: lookups.departments[0].id,
      purchaseCost: 1250,
      ...overrides,
    }),
  );

try {
  await test('Health endpoint verifies database connectivity', async () => {
    ok(await api('GET', '/health'));
  });
  await test('Private endpoints reject unauthenticated requests', async () => {
    assert.equal((await api('GET', '/assets')).status, 401);
  });
  await test('Login rejects an incorrect password without disclosing credentials', async () => {
    const r = await api('POST', '/auth/login', undefined, {
      identifier: 'admin@example.com',
      password: 'invalid-password',
    });
    assert.equal(r.status, 401);
    assert.ok(!JSON.stringify(r.body).includes('passwordHash'));
  });
  await test('Admin, manager, and employee authentication succeeds', async () => {
    for (const [identifier, password, role] of [
      ['admin@example.com', 'Admin@12345!', 'ADMIN'],
      ['assetmanager@example.com', 'Manager@12345!', 'ASSET_MANAGER'],
      ['employee@example.com', 'Employee@12345!', 'EMPLOYEE'],
    ]) {
      const r = await api('POST', '/auth/login', undefined, { identifier, password });
      const data = ok(r);
      assert.equal(data.user.role, role);
      assert.ok(data.accessToken);
      assert.ok(!JSON.stringify(data).includes('passwordHash'));
      if (role === 'ADMIN') {
        admin = data.accessToken;
        cookie = r.response.headers.get('set-cookie')?.split(';')[0] || '';
      }
      if (role === 'ASSET_MANAGER') manager = data.accessToken;
      if (role === 'EMPLOYEE') employee = data.accessToken;
    }
    assert.ok(cookie, 'Refresh cookie is present');
  });
  if (!admin || !manager || !employee) throw new Error('Cannot continue tests without seeded accounts');
  await test('Refresh rotates tokens and rejects replay', async () => {
    const r = await api('POST', '/auth/refresh', undefined, undefined, cookie);
    admin = ok(r).accessToken;
    const nextCookie = r.response.headers.get('set-cookie')?.split(';')[0] || '';
    assert.ok(nextCookie && nextCookie !== cookie);
    assert.equal((await api('POST', '/auth/refresh', undefined, undefined, cookie)).status, 401);
    cookie = nextCookie;
  });
  await test('Managers cannot manage users or security settings', async () => {
    assert.equal((await api('GET', '/users', manager)).status, 403);
    assert.equal((await api('PUT', '/settings', manager, { organizationName: 'Unauthorized' })).status, 403);
  });
  await test('Employee cannot register assets, view employees, or view audit logs', async () => {
    assert.equal((await api('POST', '/assets', employee, {})).status, 403);
    assert.equal((await api('GET', '/employees', employee)).status, 403);
    assert.equal((await api('GET', '/audit-logs', employee)).status, 403);
  });
  await test('Lookups contain seeded categories, locations and departments', async () => {
    lookups = ok(await api('GET', '/lookups', admin));
    assert.ok(lookups.categories.length >= 5);
    assert.ok(lookups.departments.length >= 4);
    assert.ok(lookups.locations.length >= 3);
  });
  await test('Create two employees with real persisted profiles', async () => {
    const payload = (name: string) => ({
      employeeId: `EMP-${name}-${suffix}`,
      name: `${name} Test`,
      email: `${name.toLowerCase()}.${suffix}@example.test`,
      departmentId: lookups.departments[0].id,
      locationId: lookups.locations[0].id,
      designation: 'Engineer',
      status: 'ACTIVE',
      joinedAt: '2026-01-01',
    });
    john = ok(await api('POST', '/employees', admin, payload('John')));
    david = ok(await api('POST', '/employees', admin, payload('David')));
    assert.equal((await db.employee.findUnique({ where: { id: john.id } }))?.name, 'John Test');
  });
  await test('Invalid asset payload produces a validation error', async () => {
    const r = await api('POST', '/assets', admin, { assetTag: '' });
    assert.ok([400, 422].includes(r.status));
    assert.equal(r.body.success, false);
  });
  await test('Register asset with unique identification and history', async () => {
    laptop = await createAsset('LAP');
    assert.equal(laptop.status, 'AVAILABLE');
    const history = ok(await api('GET', `/assets/${laptop.id}/history`, admin));
    assert.ok(history.some((event: any) => event.eventType === 'ASSET_REGISTERED'));
    baseline = ok(await api('GET', '/dashboard/summary', admin));
  });
  await test('Duplicate asset tags and category-unique serial numbers are rejected', async () => {
    const payload = {
      assetTag: laptop.assetTag,
      assetType: 'Laptop',
      categoryId: lookups.categories[0].id,
      manufacturer: 'Test',
      model: 'Test',
    };
    assert.equal((await api('POST', '/assets', admin, payload)).status, 409);
    const category = lookups.categories.find((c: any) => c.serialRequiredUnique);
    assert.ok(category, 'At least one category requires unique serial numbers');
    const item = await createAsset('SERIAL', { categoryId: category.id });
    assert.equal(
      (
        await api('POST', '/assets', admin, {
          ...payload,
          assetTag: `OTHER-${suffix}`,
          categoryId: category.id,
          serialNumber: item.serialNumber,
        })
      ).status,
      409,
    );
  });
  await test('Assign asset to John and update current holder, profile, and dashboard', async () => {
    // Capture counters after the duplicate-serial test creates its separate fixture.
    baseline = ok(await api('GET', '/dashboard/summary', admin));
    ok(
      await api('POST', `/assets/${laptop.id}/assign`, admin, {
        employeeId: john.id,
        condition: 'GOOD',
        notes: 'Acceptance scenario',
      }),
    );
    const asset = ok(await api('GET', `/assets/${laptop.id}`, admin));
    assert.equal(asset.status, 'ASSIGNED');
    assert.equal(
      asset.currentAssignment?.employeeId ?? asset.assignments.find((a: any) => !a.returnedAt)?.employeeId,
      john.id,
    );
    const assets = ok(await api('GET', `/employees/${john.id}/assets`, admin));
    assert.ok(assets.some((a: any) => a.id === laptop.id || a.assetId === laptop.id));
    const summary = ok(await api('GET', '/dashboard/summary', admin));
    assert.equal(summary.assignedAssets, baseline.assignedAssets + 1);
    assert.equal(summary.availableAssets, baseline.availableAssets - 1);
  });
  await test('An already assigned asset cannot be assigned twice', async () => {
    const r = await api('POST', `/assets/${laptop.id}/assign`, admin, { employeeId: david.id });
    assert.equal(r.status, 409);
    assert.equal(await db.assetAssignment.count({ where: { assetId: laptop.id, returnedAt: null } }), 1);
  });
  await test('Employee cannot inspect or operate on another employee’s asset', async () => {
    assert.ok([403, 404].includes((await api('GET', `/assets/${laptop.id}`, employee)).status));
    assert.ok([403, 404].includes((await api('GET', `/assets/${laptop.id}/history`, employee)).status));
    assert.equal(
      (
        await api('POST', `/assets/${laptop.id}/transfer`, employee, {
          employeeId: david.id,
          reason: 'Unauthorized',
        })
      ).status,
      403,
    );
  });
  await test('Transfer closes John’s assignment and creates David’s assignment', async () => {
    ok(
      await api('POST', `/assets/${laptop.id}/transfer`, admin, {
        employeeId: david.id,
        reason: 'Employee transfer',
      }),
    );
    const assignments = await db.assetAssignment.findMany({
      where: { assetId: laptop.id },
      orderBy: { assignedAt: 'asc' },
    });
    assert.equal(assignments.length, 2);
    assert.ok(assignments[0].returnedAt);
    assert.equal(assignments[1].employeeId, david.id);
    assert.equal(assignments[1].returnedAt, null);
    const johnAssets = ok(await api('GET', `/employees/${john.id}/assets`, admin));
    assert.ok(!johnAssets.some((a: any) => a.id === laptop.id || a.assetId === laptop.id));
    const davidAssets = ok(await api('GET', `/employees/${david.id}/assets`, admin));
    assert.ok(davidAssets.some((a: any) => a.id === laptop.id || a.assetId === laptop.id));
  });
  await test('Return closes custody and preserves complete timeline', async () => {
    ok(
      await api('POST', `/assets/${laptop.id}/return`, admin, {
        condition: 'GOOD',
        accessories: ['Charger', 'Laptop bag'],
        notes: 'Returned at exit',
      }),
    );
    assert.equal((await db.asset.findUnique({ where: { id: laptop.id } }))?.status, 'AVAILABLE');
    assert.equal(await db.assetAssignment.count({ where: { assetId: laptop.id, returnedAt: null } }), 0);
    const detail = ok(await api('GET', `/assets/${laptop.id}`, admin));
    assert.equal(
      detail.currentAssignment,
      null,
      'Historical assignments must not be mistaken for current custody',
    );
    assert.equal(detail.assignments.length, 2, 'Both employees remain in asset assignment history');
    const davidProfile = ok(await api('GET', `/employees/${david.id}`, admin));
    assert.ok(davidProfile.assignments.some((a: any) => a.assetId === laptop.id && a.returnedAt));
    const events = ok(await api('GET', `/assets/${laptop.id}/history`, admin)).map((e: any) => e.eventType);
    for (const event of ['ASSET_REGISTERED', 'ASSET_ASSIGNED', 'ASSET_TRANSFERRED', 'ASSET_RETURNED'])
      assert.ok(events.includes(event), `Missing ${event}`);
  });
  await test('Concurrent assignment attempts produce one winner and one active assignment', async () => {
    const asset = await createAsset('RACE');
    const attempts = await Promise.all(
      [john.id, david.id].map((employeeId) =>
        api('POST', `/assets/${asset.id}/assign`, admin, { employeeId }),
      ),
    );
    assert.equal(attempts.filter((r) => r.status >= 200 && r.status < 300).length, 1);
    assert.equal(attempts.filter((r) => r.status === 409).length, 1);
    assert.equal(await db.assetAssignment.count({ where: { assetId: asset.id, returnedAt: null } }), 1);
    ok(await api('POST', `/assets/${asset.id}/return`, admin, { condition: 'GOOD' }));
  });
  await test('Retired assets cannot be assigned and invalid status transitions fail', async () => {
    const asset = await createAsset('RETIRED');
    ok(
      await api('PATCH', `/assets/${asset.id}/status`, admin, {
        status: 'RETIRED',
        notes: 'End of useful life',
      }),
    );
    assert.equal(
      (await api('POST', `/assets/${asset.id}/assign`, admin, { employeeId: john.id })).status,
      409,
    );
    assert.ok(
      [400, 409, 422].includes(
        (await api('PATCH', `/assets/${asset.id}/status`, admin, { status: 'ASSIGNED' })).status,
      ),
    );
  });
  await test('Damaged returns cannot silently become available', async () => {
    const asset = await createAsset('DAMAGE');
    ok(await api('POST', `/assets/${asset.id}/assign`, admin, { employeeId: john.id }));
    ok(
      await api('POST', `/assets/${asset.id}/return`, admin, {
        condition: 'DAMAGED',
        damage: 'Cracked display',
      }),
    );
    assert.equal((await db.asset.findUnique({ where: { id: asset.id } }))?.status, 'DAMAGED');
    const repair = ok(
      await api('POST', '/repairs', admin, {
        assetId: asset.id,
        issue: 'Cracked display',
        vendor: 'Test repair vendor',
        cost: 150,
      }),
    );
    for (const status of ['IN_REPAIR', 'REPAIRED', 'CLOSED'])
      ok(await api('PATCH', `/repairs/${repair.id}`, admin, { status }));
    assert.equal((await db.asset.findUnique({ where: { id: asset.id } }))?.status, 'AVAILABLE');
  });
  await test('Location movements retain previous and new locations', async () => {
    ok(
      await api('POST', `/assets/${laptop.id}/move`, manager, {
        locationId: lookups.locations[1].id,
        notes: 'Office relocation',
      }),
    );
    const movements = await db.assetMovement.findMany({ where: { assetId: laptop.id } });
    assert.equal(movements.at(-1)?.toLocationId, lookups.locations[1].id);
  });
  await test('Offboarding blocks outstanding assets then completes after return', async () => {
    const asset = await createAsset('OFFBOARD');
    ok(await api('POST', `/assets/${asset.id}/assign`, admin, { employeeId: john.id }));
    const offboarding = ok(
      await api('POST', '/offboarding', admin, { employeeId: john.id, notes: 'Test exit' }),
    );
    assert.equal((await api('POST', `/offboarding/${offboarding.id}/complete`, admin)).status, 409);
    const detail = ok(await api('GET', `/offboarding/${offboarding.id}`, admin));
    assert.ok(detail.items.some((item: any) => item.assetId === asset.id));
    ok(await api('POST', `/assets/${asset.id}/return`, admin, { condition: 'GOOD' }));
    const complete = ok(await api('POST', `/offboarding/${offboarding.id}/complete`, admin));
    assert.equal(complete.status, 'COMPLETED');
  });
  await test('Employee requests are scoped and lost reports require manager approval', async () => {
    const me = ok(await api('GET', '/auth/me', employee));
    const employeeId = me.employeeId ?? me.employee?.id;
    assert.ok(employeeId);
    const asset = await createAsset('LOST');
    ok(await api('POST', `/assets/${asset.id}/assign`, admin, { employeeId }));
    const request = ok(
      await api('POST', '/requests', employee, {
        assetId: asset.id,
        type: 'LOST',
        description: 'Lost during travel',
        location: 'Transit',
      }),
    );
    assert.equal((await db.asset.findUnique({ where: { id: asset.id } }))?.status, 'ASSIGNED');
    assert.equal(
      (await api('PATCH', `/requests/${request.id}`, employee, { status: 'APPROVED' })).status,
      403,
    );
    ok(
      await api('PATCH', `/requests/${request.id}`, admin, {
        status: 'APPROVED',
        resolution: 'Incident verified',
      }),
    );
    assert.equal((await db.asset.findUnique({ where: { id: asset.id } }))?.status, 'LOST');
  });
  await test('All report datasets and CSV, Excel, PDF exports work', async () => {
    for (const type of [
      'inventory',
      'assigned',
      'available',
      'employee-assets',
      'movements',
      'lost',
      'damaged',
      'repairs',
      'warranty',
      'offboarding',
    ]) {
      const data = ok(await api('GET', `/reports/${type}`, admin));
      assert.ok(Array.isArray(data.columns));
      assert.ok(Array.isArray(data.rows));
    }
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const r = await api('GET', `/reports/inventory?format=${format}`, admin);
      assert.equal(r.status, 200);
      const buffer = Buffer.from(r.body);
      assert.ok(buffer.length > 50);
      if (format === 'pdf') assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
      if (format === 'xlsx') assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    }
  });
  await test('Pagination, filtering, and search return matching persisted data', async () => {
    const r = await api(
      'GET',
      `/assets?search=${encodeURIComponent(laptop.assetTag)}&page=1&pageSize=5`,
      admin,
    );
    const data = ok(r);
    assert.equal(data.length, 1);
    assert.equal(data[0].id, laptop.id);
    assert.equal(r.body.meta.total, 1);
    const search = ok(await api('GET', `/search?q=${encodeURIComponent(laptop.assetTag)}`, admin));
    assert.ok(search.assets.some((a: any) => a.id === laptop.id));
  });
  await test('Soft deletion and restoration preserve asset history', async () => {
    const asset = await createAsset('ARCHIVE');
    const before = await db.assetHistory.count({ where: { assetId: asset.id } });
    ok(await api('DELETE', `/assets/${asset.id}`, admin));
    assert.ok((await db.asset.findUnique({ where: { id: asset.id } }))?.deletedAt);
    ok(await api('POST', `/assets/${asset.id}/restore`, admin));
    assert.equal((await db.asset.findUnique({ where: { id: asset.id } }))?.deletedAt, null);
    assert.ok((await db.assetHistory.count({ where: { assetId: asset.id } })) >= before);
  });
  await test('Audit records include important lifecycle actions without secrets', async () => {
    const records = await db.auditLog.findMany({ where: { entityId: laptop.id } });
    assert.ok(records.length >= 4);
    for (const record of records) assert.ok(!JSON.stringify(record).includes('passwordHash'));
    ok(await api('GET', '/audit-logs', admin));
  });
  await test('Database rejects edits to historical events', async () => {
    const history = await db.assetHistory.findFirstOrThrow({ where: { assetId: laptop.id } });
    await assert.rejects(() =>
      db.assetHistory.update({ where: { id: history.id }, data: { notes: 'Tampered history' } }),
    );
  });
  await test('Human-readable history and employee reports preserve prior custody after transfer and return', async () => {
    const events = ok(await api('GET', `/assets/${laptop.id}/history`, admin));
    const transferred = events.find((event: any) => event.eventType === 'ASSET_TRANSFERRED');
    assert.ok(transferred.notes.includes('John Test') && transferred.notes.includes('David Test'));
    const report = ok(await api('GET', `/reports/employee-assets?employeeId=${john.id}`, admin));
    assert.ok(report.rows.some((row: any) => row.assetTag === laptop.assetTag && row.status === 'Closed'));
    const movements = ok(await api('GET', `/reports/movements?ids=${laptop.id}`, admin));
    assert.ok(
      movements.rows.some(
        (row: any) =>
          row.event === 'ASSET_TRANSFERRED' &&
          row.fromEmployee === 'John Test' &&
          row.toEmployee === 'David Test',
      ),
    );
  });
  await test('A new assignment cannot overlap prior custody through backdating', async () => {
    const response = await api('POST', `/assets/${laptop.id}/assign`, admin, {
      employeeId: david.id,
      assignedAt: new Date(Date.now() - 86400000).toISOString(),
    });
    assert.equal(response.status, 422);
    assert.equal(await db.assetAssignment.count({ where: { assetId: laptop.id, returnedAt: null } }), 0);
  });
  await test('Asset updates preserve before and after values plus actor IP', async () => {
    ok(await api('PUT', `/assets/${laptop.id}`, admin, { model: 'Updated model for verification' }));
    const event = await db.assetHistory.findFirstOrThrow({
      where: { assetId: laptop.id, eventType: 'ASSET_UPDATED' },
      orderBy: { timestamp: 'desc' },
    });
    const metadata = event.metadata as any;
    assert.equal(metadata.changes.model.before, 'Lifecycle verification');
    assert.equal(metadata.changes.model.after, 'Updated model for verification');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: laptop.id, action: 'ASSET_UPDATED' },
    });
    assert.ok(audit.ip);
  });
  await test('Managers cannot deactivate employees linked to administrator accounts', async () => {
    const person = ok(
      await api('POST', '/employees', admin, {
        employeeId: `ADMIN-${suffix}`,
        name: 'Protected Administrator',
        email: `protected.${suffix}@example.test`,
      }),
    );
    const user = ok(
      await api('POST', '/users', admin, {
        name: person.name,
        email: person.email,
        employeeId: person.id,
        role: 'ADMIN',
        password: 'Protected@12345!',
      }),
    );
    assert.equal((await api('PUT', `/employees/${person.id}`, manager, { status: 'INACTIVE' })).status, 403);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).active, true);
  });
  await test('Offboarding loss exceptions require administrator approval', async () => {
    const person = ok(
      await api('POST', '/employees', admin, {
        employeeId: `LOSS-${suffix}`,
        name: 'Exit Loss Test',
        email: `exit.loss.${suffix}@example.test`,
      }),
    );
    const asset = await createAsset('EXIT-LOSS');
    ok(await api('POST', `/assets/${asset.id}/assign`, admin, { employeeId: person.id }));
    const exit = ok(await api('POST', '/offboarding', admin, { employeeId: person.id }));
    assert.equal((await api('PATCH', `/assets/${asset.id}/status`, manager, { status: 'LOST' })).status, 403);
    assert.equal((await api('POST', `/offboarding/${exit.id}/complete`, admin)).status, 409);
    ok(
      await api('PATCH', `/assets/${asset.id}/status`, admin, {
        status: 'LOST',
        notes: 'Authorized loss exception',
      }),
    );
    assert.equal(ok(await api('POST', `/offboarding/${exit.id}/complete`, admin)).status, 'COMPLETED');
  });
  await test('Required password change is reachable and invalidates old credentials and reset links', async () => {
    const person = ok(
      await api('POST', '/employees', admin, {
        employeeId: `AUTH-${suffix}`,
        name: 'Authentication Test',
        email: `auth.${suffix}@example.test`,
      }),
    );
    const user = ok(
      await api('POST', '/users', admin, {
        name: person.name,
        email: person.email,
        employeeId: person.id,
        role: 'EMPLOYEE',
        password: 'Initial@12345!',
      }),
    );
    assert.equal(user.mustChangePassword, true);
    const signedIn = ok(
      await api('POST', '/auth/login', undefined, { identifier: person.email, password: 'Initial@12345!' }),
    );
    assert.equal((await api('GET', '/dashboard/summary', signedIn.accessToken)).status, 403);
    ok(await api('GET', '/auth/me', signedIn.accessToken));
    const firstReset = ok(await api('POST', '/auth/forgot-password', undefined, { email: person.email }));
    const secondReset = ok(await api('POST', '/auth/forgot-password', undefined, { email: person.email }));
    const firstToken = new URL(firstReset.resetUrl).searchParams.get('token');
    const secondToken = new URL(secondReset.resetUrl).searchParams.get('token');
    assert.equal(
      (await api('POST', '/auth/reset-password', undefined, { token: firstToken, password: 'Unused@12345!' }))
        .status,
      400,
    );
    const changed = ok(
      await api('POST', '/auth/change-password', signedIn.accessToken, {
        currentPassword: 'Initial@12345!',
        newPassword: 'Changed@12345!',
      }),
    );
    assert.equal(changed.user.mustChangePassword, false);
    ok(await api('GET', '/dashboard/summary', changed.accessToken));
    assert.equal((await api('GET', '/auth/me', signedIn.accessToken)).status, 401);
    assert.equal(
      (
        await api('POST', '/auth/reset-password', undefined, {
          token: secondToken,
          password: 'Unused@12345!',
        })
      ).status,
      400,
    );
    assert.equal(
      (await api('POST', '/auth/login', undefined, { identifier: person.email, password: 'Initial@12345!' }))
        .status,
      401,
    );
    ok(await api('POST', '/auth/login', undefined, { identifier: person.email, password: 'Changed@12345!' }));
    const thirdReset = ok(await api('POST', '/auth/forgot-password', undefined, { email: person.email }));
    ok(await api('POST', `/users/${user.id}/reset-password`, admin, { password: 'AdminReset@12345!' }));
    assert.equal(
      (
        await api('POST', '/auth/reset-password', undefined, {
          token: new URL(thirdReset.resetUrl).searchParams.get('token'),
          password: 'Unused@12345!',
        })
      ).status,
      400,
    );
    assert.equal((await api('GET', '/auth/me', changed.accessToken)).status, 401);
  });
  await test('Completed incident approvals leave the pending queue', async () => {
    const completed = await db.assetRequest.findFirstOrThrow({
      where: { description: 'Lost during travel', asset: { assetTag: `LOST-${suffix}` } },
    });
    assert.equal(completed.status, 'COMPLETED');
  });
  await test('Master lists search and paginate instead of silently ignoring controls', async () => {
    const result = await api('GET', '/categories?page=1&pageSize=2', admin);
    assert.equal(ok(result).length, 2);
    assert.ok(result.body.meta.total >= 5);
    const filtered = ok(
      await api('GET', `/categories?search=${encodeURIComponent(lookups.categories[0].name)}`, admin),
    );
    assert.ok(
      filtered.every((row: any) => row.name.toLowerCase().includes(lookups.categories[0].name.toLowerCase())),
    );
  });
  await test('Logout revokes refresh session', async () => {
    ok(await api('POST', '/auth/logout', admin, undefined, cookie));
    assert.equal((await api('POST', '/auth/refresh', undefined, undefined, cookie)).status, 401);
  });
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.$disconnect();
  console.log(`\nIntegration tests: ${results.filter((r) => r.passed).length}/${results.length} passed.`);
  // Keep test records in the isolated test database so append-only history remains intact.
  process.exit(results.some((r) => !r.passed) ? 1 : 0);
}
