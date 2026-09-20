import type { Lookups, RecordData } from '../types';
import { CONDITIONS } from '../types';
export type ImportRow = {
  line: number;
  data: RecordData;
  errors: string[];
  state: 'ready' | 'imported' | 'failed';
  message?: string;
};
/** RFC-4180 style parser supporting escaped quotes, CRLF and newlines inside quoted cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let afterQuote = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else value += ch;
    } else if (ch === '"') {
      if (value.trim() || afterQuote)
        throw new Error('Invalid CSV: a quote appears inside an unquoted value.');
      quoted = true;
      value = '';
    } else if (ch === ',') {
      row.push(value.trim());
      value = '';
      afterQuote = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
      afterQuote = false;
    } else {
      if (afterQuote && ch.trim()) throw new Error('Invalid CSV: unexpected content after a closing quote.');
      value += ch;
    }
  }
  if (quoted) throw new Error('Invalid CSV: a quoted value was not closed.');
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
const fields = [
  'assetTag',
  'assetType',
  'categoryId',
  'manufacturer',
  'model',
  'serialNumber',
  'condition',
  'purchaseDate',
  'purchaseCost',
  'vendor',
  'invoiceNumber',
  'warrantyStart',
  'warrantyExpiry',
  'locationId',
  'departmentId',
  'description',
  'notes',
  'qrCode',
  'barcode',
];
const normalized = (value: string) => value.toLowerCase().replace(/[\s_-]/g, '');
const aliases: Record<string, string> = {
  category: 'categoryId',
  department: 'departmentId',
  location: 'locationId',
  type: 'assetType',
  tag: 'assetTag',
  serial: 'serialNumber',
  warrantyend: 'warrantyExpiry',
};
const dateFields = ['purchaseDate', 'warrantyStart', 'warrantyExpiry'];
export function prepareAssetImport(text: string, lookups: Lookups): ImportRow[] {
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error('The CSV must include a header row and at least one asset.');
  if (parsed.length > 501) throw new Error('Import up to 500 assets at a time.');
  const headers = parsed[0].map(
    (h) => fields.find((f) => normalized(f) === normalized(h)) ?? aliases[normalized(h)],
  );
  const unsupported = parsed[0].filter((_, i) => !headers[i]);
  if (unsupported.length)
    throw new Error(`Unrecognized columns: ${unsupported.join(', ')}. Use the downloadable template.`);
  if (new Set(headers).size !== headers.length) throw new Error('The CSV contains duplicate column headers.');
  const required = ['assetTag', 'assetType', 'categoryId', 'manufacturer', 'model'];
  const missing = required.filter((f) => !headers.includes(f));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}.`);
  const tags = new Set<string>();
  const serials = new Set<string>();
  return parsed.slice(1).map((cells, index) => {
    const errors: string[] = [];
    const data: RecordData = {};
    if (cells.length !== headers.length)
      errors.push(`Expected ${headers.length} cells, received ${cells.length}`);
    headers.forEach((header, i) => {
      if (header && cells[i]) data[header] = cells[i];
    });
    for (const key of required) if (!data[key]) errors.push(`${key} is required`);
    for (const [key, collection] of [
      ['categoryId', 'categories'],
      ['departmentId', 'departments'],
      ['locationId', 'locations'],
    ] as const) {
      if (data[key]) {
        const match = lookups[collection]?.find(
          (item) =>
            item.active !== false &&
            (item.id === data[key] || item.name.toLowerCase() === String(data[key]).toLowerCase()),
        );
        if (!match) errors.push(`${key.replace('Id', '')}: no active matching record`);
        else data[key] = match.id;
      }
    }
    data.condition = String(data.condition ?? 'GOOD')
      .toUpperCase()
      .replace(/\s+/g, '_');
    if (!CONDITIONS.includes(data.condition)) errors.push('Condition is not valid');
    for (const key of dateFields) {
      if (data[key]) {
        const input = String(data[key]);
        const date = new Date(`${input}T00:00:00.000Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(input) ||
          Number.isNaN(date.getTime()) ||
          date.toISOString().slice(0, 10) !== input
        )
          errors.push(`${key} must be a valid YYYY-MM-DD date`);
        else data[key] = date.toISOString();
      }
    }
    if (data.warrantyStart && data.warrantyExpiry && data.warrantyStart > data.warrantyExpiry)
      errors.push('Warranty expiry precedes start');
    if (data.purchaseCost !== undefined) {
      const number = Number(data.purchaseCost);
      if (!Number.isFinite(number) || number < 0 || number > 999999999)
        errors.push('Purchase cost must be between 0 and 999999999');
      else data.purchaseCost = number;
    }
    if (data.assetTag) {
      const tag = String(data.assetTag).toUpperCase();
      if (tags.has(tag)) errors.push('Duplicate asset tag in this file');
      tags.add(tag);
    }
    if (data.serialNumber && data.categoryId) {
      const category = lookups.categories.find((c) => c.id === data.categoryId) as RecordData | undefined;
      if (category?.serialRequiredUnique !== false) {
        const serial = `${data.categoryId}:${String(data.serialNumber).toUpperCase()}`;
        if (serials.has(serial)) errors.push('Duplicate category serial number in this file');
        serials.add(serial);
      }
    }
    return { line: index + 2, data, errors, state: 'ready' };
  });
}
const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
export function templateCsv(lookups: Lookups) {
  const headers = [
    'assetTag',
    'assetType',
    'category',
    'manufacturer',
    'model',
    'serialNumber',
    'condition',
    'location',
    'department',
    'purchaseDate',
    'purchaseCost',
    'vendor',
    'invoiceNumber',
    'warrantyStart',
    'warrantyExpiry',
    'description',
    'notes',
  ];
  const row = [
    'LAP-NEW-001',
    'Laptop',
    lookups.categories.find((row) => row.active !== false)?.id ?? 'CATEGORY-ID',
    'Dell',
    'Latitude 5440',
    'SERIAL-NEW-001',
    'GOOD',
    lookups.locations.find((row) => row.active !== false)?.id ?? '',
    lookups.departments.find((row) => row.active !== false)?.id ?? '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
  return [headers, row].map((r) => r.map(cell).join(',')).join('\r\n');
}
