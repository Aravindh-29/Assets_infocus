import { z } from 'zod';
export const uuid = z.string().uuid();
export const text = z.string().trim().max(4000);
export const name = z.string().trim().min(1).max(200);
export const date = z.coerce.date();
export const optDate = z.preprocess((v) => (v === '' ? null : v), date.nullable().optional());
export const optionalId = z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional());
export const password = z
  .string()
  .min(10)
  .max(72)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number')
  .regex(/[^a-zA-Z0-9]/, 'Include a symbol')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password cannot exceed 72 UTF-8 bytes');
export const conditions = z.enum(['NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'UNUSABLE']);
export const statuses = z.enum([
  'AVAILABLE',
  'ASSIGNED',
  'UNDER_REPAIR',
  'DAMAGED',
  'LOST',
  'RETIRED',
  'DISPOSED',
]);
export const assetSchema = z
  .object({
    assetTag: name,
    assetType: name,
    categoryId: uuid,
    manufacturer: name,
    model: name,
    serialNumber: text.nullable().optional(),
    condition: conditions.default('GOOD'),
    purchaseDate: optDate,
    purchaseCost: z.coerce.number().min(0).max(999999999).nullable().optional(),
    vendor: text.nullable().optional(),
    invoiceNumber: text.nullable().optional(),
    warrantyStart: optDate,
    warrantyExpiry: optDate,
    locationId: optionalId,
    departmentId: optionalId,
    description: text.nullable().optional(),
    notes: text.nullable().optional(),
    qrCode: text.nullable().optional(),
    barcode: text.nullable().optional(),
  })
  .strict();
export const employeeSchema = z
  .object({
    employeeId: name,
    name,
    email: z.string().trim().email().toLowerCase(),
    designation: text.nullable().optional(),
    departmentId: optionalId,
    locationId: optionalId,
    managerId: optionalId,
    status: z
      .enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED', 'OFFBOARDING', 'OFFBOARDED'])
      .default('ACTIVE'),
    joinedAt: optDate,
  })
  .strict();
export const assignSchema = z
  .object({
    employeeId: uuid,
    assignedAt: date.optional(),
    expectedReturnAt: optDate,
    condition: conditions.optional(),
    notes: text.optional(),
  })
  .strict();
export const transferSchema = z
  .object({ employeeId: uuid, transferredAt: date.optional(), reason: name, notes: text.optional() })
  .strict();
export const returnSchema = z
  .object({
    returnedAt: date.optional(),
    condition: conditions,
    accessories: z.array(name).max(50).default([]),
    damage: text.optional(),
    notes: text.optional(),
  })
  .strict();
