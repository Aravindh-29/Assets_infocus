import { describe, expect, it, beforeAll, vi } from 'vitest';
import { assetSchema, assignSchema, employeeSchema, password, returnSchema } from '../src/validators.js';

vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('DATABASE_URL', 'postgresql://unit:unit@127.0.0.1:5432/unit_tests');
vi.stubEnv('JWT_SECRET', 'unit-test-access-secret-not-used-in-production');
vi.stubEnv('JWT_REFRESH_SECRET', 'unit-test-refresh-secret-not-used-in-production');
const { assertTransition, assertChronology, availableAfterReturn } =
  await import('../src/services/lifecycle.js');
const { csvCell, safeSpreadsheetText } = await import('../src/routes/reports.js');
const { durationMilliseconds } = await import('../src/config.js');

describe('Lifecycle invariants', () => {
  it('requires assignment workflow to transition an available asset to assigned', () =>
    expect(() => assertTransition('AVAILABLE', 'ASSIGNED', false, 'ADMIN')).toThrow());
  it('requires return workflow to clear custody', () =>
    expect(() => assertTransition('ASSIGNED', 'AVAILABLE', true, 'ADMIN')).toThrow());
  it('prevents retirement while employee custody is active', () =>
    expect(() => assertTransition('DAMAGED', 'RETIRED', true, 'ADMIN')).toThrow());
  it('allows recording damage while custody remains active', () =>
    expect(() => assertTransition('ASSIGNED', 'DAMAGED', true, 'ASSET_MANAGER')).not.toThrow());
  it('requires an administrator to recover a lost asset', () =>
    expect(() => assertTransition('LOST', 'AVAILABLE', false, 'ASSET_MANAGER')).toThrow());
  it('allows an administrator to recover a lost asset', () =>
    expect(() => assertTransition('LOST', 'AVAILABLE', false, 'ADMIN')).not.toThrow());
  it('requires an administrator to dispose of retired assets', () =>
    expect(() => assertTransition('RETIRED', 'DISPOSED', false, 'ASSET_MANAGER')).toThrow());
  it('cannot reactivate a disposed asset', () =>
    expect(() => assertTransition('DISPOSED', 'AVAILABLE', false, 'ADMIN')).toThrow());
  it('cannot reactivate a retired asset by status patch', () =>
    expect(() => assertTransition('RETIRED', 'AVAILABLE', false, 'ADMIN')).toThrow());
  it.each(['DAMAGED', 'UNUSABLE', 'POOR'])('keeps %s returns unavailable', (condition) =>
    expect(availableAfterReturn(condition)).toBe('DAMAGED'),
  );
  it.each(['NEW', 'EXCELLENT', 'GOOD', 'FAIR'])('makes serviceable %s returns available', (condition) =>
    expect(availableAfterReturn(condition)).toBe('AVAILABLE'),
  );
  it('rejects lifecycle events in the future', () =>
    expect(() => assertChronology(new Date(Date.now() + 86400000))).toThrow());
  it('rejects a return or assignment dated before previous custody', () =>
    expect(() => assertChronology(new Date('2025-01-01'), new Date('2025-02-01'))).toThrow());
  it('permits an event at the assignment instant', () =>
    expect(() => assertChronology(new Date('2025-01-01'), new Date('2025-01-01'))).not.toThrow());
});

describe('Input boundaries', () => {
  it('does not accept privileged asset fields through a CRUD payload', () =>
    expect(
      assetSchema.safeParse({
        assetTag: 'LAP-1',
        assetType: 'Laptop',
        categoryId: 'a64b8a35-f8a0-4420-a3e0-7c5de012a2f7',
        manufacturer: 'Dell',
        model: 'Latitude',
        status: 'ASSIGNED',
      }).success,
    ).toBe(false));
  it('rejects negative purchase costs', () =>
    expect(
      assetSchema.safeParse({
        assetTag: 'LAP-1',
        assetType: 'Laptop',
        categoryId: 'a64b8a35-f8a0-4420-a3e0-7c5de012a2f7',
        manufacturer: 'Dell',
        model: 'Latitude',
        purchaseCost: -1,
      }).success,
    ).toBe(false));
  it('requires a UUID employee reference on assignment', () =>
    expect(assignSchema.safeParse({ employeeId: 'someone' }).success).toBe(false));
  it('requires a condition on return', () => expect(returnSchema.safeParse({}).success).toBe(false));
  it('normalizes employee emails', () =>
    expect(employeeSchema.parse({ employeeId: 'EMP01', name: 'Jane', email: 'JANE@EXAMPLE.COM' }).email).toBe(
      'jane@example.com',
    ));
  it.each(['short', 'lowercase12345!', 'UPPERCASE12345!', 'MissingNumber!', 'MissingSymbol123'])(
    'rejects weak password %s',
    (value) => expect(password.safeParse(value).success).toBe(false),
  );
  it('accepts a sufficiently complex passphrase', () =>
    expect(password.safeParse('A-long-and-unique-phrase-42!').success).toBe(true));
  it('rejects Unicode passwords longer than bcrypt’s 72-byte boundary', () =>
    expect(password.safeParse(`Aa1!${'🌍'.repeat(20)}`).success).toBe(false));
});

describe('Spreadsheet export safety', () => {
  it.each(['=HYPERLINK("https://example.com")', '+1+1', '-1+1', '@SUM(A1)', ' =1+1', '\t=1+1', '\r=1+1'])(
    'neutralizes spreadsheet formula input %s',
    (value) => expect(safeSpreadsheetText(value).startsWith("'")).toBe(true),
  );
  it('preserves ordinary asset tags and names', () =>
    expect(safeSpreadsheetText('LAP-0001')).toBe('LAP-0001'));
  it('quotes CSV commas, quotes and multiline values', () =>
    expect(csvCell('ACME, "Laptop"\nReturned')).toBe('"ACME, ""Laptop""\nReturned"'));
});
describe('Refresh session configuration', () => {
  it('interprets days and hours consistently', () =>
    expect(durationMilliseconds('1d')).toBe(durationMilliseconds('24h')));
  it('supports configured seven-day sessions', () => expect(durationMilliseconds('7d')).toBe(604800000));
  it.each(['0d', '366d', '10', '-1h', 'forever'])('rejects invalid duration %s', (value) =>
    expect(() => durationMilliseconds(value)).toThrow(),
  );
});
