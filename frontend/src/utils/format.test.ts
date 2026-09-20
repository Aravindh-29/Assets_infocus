import { describe, expect, it } from 'vitest';
import { clean, holder } from './format';
describe('lifecycle form serialization', () => {
  it('omits empty lifecycle timestamps so the server records the actual handover time', () => {
    expect(
      clean({ employeeId: 'employee-1', assignedAt: '', expectedReturnAt: '', notes: 'Equipment issued' }, [
        'assignedAt',
        'expectedReturnAt',
      ]),
    ).toEqual({ employeeId: 'employee-1', notes: 'Equipment issued' });
  });
  it('converts explicit local dates to instants without dropping false and zero values', () => {
    const date = '2026-09-21T15:42';
    expect(clean({ returnedAt: date, cost: '0', active: false }, ['returnedAt'], ['cost'])).toEqual({
      returnedAt: new Date(date).toISOString(),
      cost: 0,
      active: false,
    });
  });
  it('allows optional fields to be cleared on edit', () => {
    expect(
      clean({ serialNumber: '', purchaseCost: '', locationId: undefined }, [], ['purchaseCost'], true),
    ).toEqual({ serialNumber: null, purchaseCost: null });
  });
  it('never treats a closed historical assignment as the current holder', () => {
    const current = { employeeId: 'new-holder', returnedAt: null };
    expect(
      holder({ assignments: [{ employeeId: 'old-holder', returnedAt: '2026-01-01' }, current] }),
    ).toEqual(current);
    expect(holder({ assignments: [{ employeeId: 'old-holder', returnedAt: '2026-01-01' }] })).toBeUndefined();
  });
});
