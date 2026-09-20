import { describe, expect, it } from 'vitest';
import type { Lookups } from '../types';
import { parseCsv, prepareAssetImport, templateCsv } from './assetCsv';
import { commonAssetActions, statusTargets } from './assetCapabilities';

const lookups: Lookups = {
  categories: [
    { id: 'cat-laptop', name: 'Laptop', active: true },
    { id: 'cat-old', name: 'Inactive', active: false },
    {
      id: 'cat-cable',
      name: 'Cable',
      active: true,
      serialRequiredUnique: false,
    } as Lookups['categories'][number],
  ],
  departments: [{ id: 'dep-it', name: 'IT', active: true }],
  locations: [{ id: 'loc-sg', name: 'Singapore', active: true }],
  employees: [],
};
const header = 'assetTag,assetType,category,manufacturer,model';

describe('asset CSV registration preview', () => {
  it('parses BOM, CRLF, escaped quotes and multiline descriptions', () => {
    expect(
      parseCsv('\uFEFFtag,description\r\nA,"A \"\"quoted\"\" model, with comma\nsecond line"\r\n'),
    ).toEqual([
      ['tag', 'description'],
      ['A', 'A "quoted" model, with comma\nsecond line'],
    ]);
  });

  it('resolves aliases and active lookup names, converts valid dates and prices', () => {
    const rows = prepareAssetImport(
      'tag,type,Category,manufacturer,model,location,department,purchase_date,purchase_cost,condition\nL-1,Laptop,laptop,Dell,Latitude,SINGAPORE,IT,2024-02-29,1250.25,excellent',
      lookups,
    );
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].data).toMatchObject({
      assetTag: 'L-1',
      assetType: 'Laptop',
      categoryId: 'cat-laptop',
      locationId: 'loc-sg',
      departmentId: 'dep-it',
      purchaseDate: '2024-02-29T00:00:00.000Z',
      purchaseCost: 1250.25,
      condition: 'EXCELLENT',
    });
  });

  it('surfaces malformed rows, missing values, inactive references and bad condition', () => {
    const rows = prepareAssetImport(
      `${header},condition\n,Laptop,Inactive,Dell,Latitude,BROKEN\nL-2,Laptop,Laptop,Dell`,
      lookups,
    );
    expect(rows[0].errors).toEqual(
      expect.arrayContaining([
        'assetTag is required',
        'category: no active matching record',
        'Condition is not valid',
      ]),
    );
    expect(rows[1].errors).toEqual(
      expect.arrayContaining(['Expected 6 cells, received 4', 'model is required']),
    );
  });

  it('rejects impossible dates, negative costs and reversed warranty ranges', () => {
    const rows = prepareAssetImport(
      `${header},purchaseDate,purchaseCost,warrantyStart,warrantyExpiry\nL-1,Laptop,Laptop,Dell,Latitude,2025-02-29,-1,2026-05-01,2026-04-01`,
      lookups,
    );
    expect(rows[0].errors).toEqual(
      expect.arrayContaining([
        'purchaseDate must be a valid YYYY-MM-DD date',
        'Purchase cost must be between 0 and 999999999',
        'Warranty expiry precedes start',
      ]),
    );
  });

  it('identifies duplicate tags and category serials without rejecting permitted repeated serials', () => {
    const rows = prepareAssetImport(
      `${header},serialNumber\nL-1,Laptop,Laptop,Dell,Latitude,S-1\nl-1,Laptop,Laptop,Dell,Latitude,s-1\nC-1,Cable,Cable,Generic,Cable,Shared\nC-2,Cable,Cable,Generic,Cable,Shared`,
      lookups,
    );
    expect(rows[1].errors).toEqual(
      expect.arrayContaining([
        'Duplicate asset tag in this file',
        'Duplicate category serial number in this file',
      ]),
    );
    expect(rows[3].errors).toEqual([]);
  });

  it('rejects invalid file structure and imports over the bounded limit', () => {
    expect(() => parseCsv('a,b\n"open,value')).toThrow('not closed');
    expect(() => parseCsv('a,b\n"closed"invalid,value')).toThrow('unexpected content');
    expect(() =>
      prepareAssetImport(`${header},unsupported\nA,Laptop,Laptop,Dell,Latitude,x`, lookups),
    ).toThrow('Unrecognized columns');
    expect(() => prepareAssetImport(`${header},tag\nA,Laptop,Laptop,Dell,Latitude,A`, lookups)).toThrow(
      'duplicate column headers',
    );
    expect(() => prepareAssetImport('assetTag,model\nA,M', lookups)).toThrow('Missing required columns');
    expect(() =>
      prepareAssetImport(
        [header, ...Array.from({ length: 501 }, (_, i) => `L-${i},Laptop,Laptop,Dell,Latitude`)].join('\n'),
        lookups,
      ),
    ).toThrow('500 assets');
  });

  it('downloads a valid template using IDs instead of potentially executable lookup names', () => {
    const custom = {
      ...lookups,
      categories: [{ id: 'cat-safe', name: '=SUM(1,1)' }],
      locations: [{ id: 'loc-safe', name: '@malicious' }],
    };
    const template = templateCsv(custom);
    expect(template).not.toContain('=SUM');
    expect(template).not.toContain('@malicious');
    expect(prepareAssetImport(template, custom)[0].errors).toEqual([]);
  });
});

describe('visible asset operations', () => {
  it('enforces role restrictions and custody status prerequisites in contextual actions', () => {
    expect(statusTargets({ status: 'LOST' }, 'ASSET_MANAGER')).toEqual([]);
    expect(statusTargets({ status: 'RETIRED' }, 'ASSET_MANAGER')).toEqual([]);
    expect(statusTargets({ status: 'LOST' }, 'ADMIN')).toEqual(['AVAILABLE', 'DISPOSED']);
    expect(statusTargets({ status: 'AVAILABLE' }, 'ASSET_MANAGER')).toEqual(['DAMAGED', 'LOST', 'RETIRED']);
    expect(statusTargets({ status: 'DAMAGED', currentAssignment: { id: 'active' } }, 'ADMIN')).toEqual([
      'LOST',
    ]);
    expect(statusTargets({ status: 'AVAILABLE', deletedAt: '2026-01-01' }, 'ADMIN')).toEqual([]);
  });

  it('offers only operations common to the whole selection', () => {
    expect(commonAssetActions([], 'ADMIN')).toEqual({ assign: false, move: false, statuses: [] });
    expect(commonAssetActions([{ status: 'AVAILABLE' }, { status: 'ASSIGNED' }], 'ADMIN')).toEqual({
      assign: false,
      move: true,
      statuses: ['DAMAGED', 'LOST'],
    });
    expect(
      commonAssetActions([{ status: 'AVAILABLE' }, { status: 'AVAILABLE', deletedAt: 'today' }], 'ADMIN'),
    ).toEqual({ assign: false, move: false, statuses: [] });
    expect(commonAssetActions([{ status: 'AVAILABLE' }], 'EMPLOYEE')).toEqual({
      assign: false,
      move: false,
      statuses: [],
    });
  });
});
