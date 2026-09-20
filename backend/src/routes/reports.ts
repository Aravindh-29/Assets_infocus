import { Router, type Request, type Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError, managers, ok, param, queryString } from '../http.js';
import { uuid } from '../validators.js';
import { assetWhere } from './assets.js';
import { assetInclude } from '../services/lifecycle.js';
import { audit } from '../services/audit.js';

export const reportsRouter = Router();
type Report = { columns: { key: string; label: string }[]; rows: Record<string, string | number>[] };
const limit = 100000;
const columns = (labels: Record<string, string>) =>
  Object.entries(labels).map(([key, label]) => ({ key, label }));
const iso = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? '';
async function reportData(req: Request, type: string): Promise<Report> {
  const where = assetWhere(req, type !== 'employee-assets');
  const ids = queryString(req.query.ids)?.split(',').filter(Boolean);
  if (ids?.length) where.id = { in: z.array(uuid).max(1000).parse(ids) };
  const employeeId = queryString(req.query.employeeId);
  if (employeeId) uuid.parse(employeeId);
  if (type === 'employee-assets') {
    const rows = await prisma.assetAssignment.findMany({
      where: { asset: where, ...(employeeId ? { employeeId } : {}) },
      include: { employee: { include: { department: true } }, asset: true },
      orderBy: { assignedAt: 'desc' },
      take: limit + 1,
    });
    return {
      columns: columns({
        employeeId: 'Employee ID',
        employee: 'Employee',
        department: 'Department',
        assetTag: 'Asset tag',
        model: 'Model',
        serialNumber: 'Serial number',
        assignedAt: 'Assigned',
        returnedAt: 'Returned',
        condition: 'Assigned condition',
        status: 'Custody',
      }),
      rows: rows.map((r) => ({
        employeeId: r.employee.employeeId,
        employee: r.employee.name,
        department: r.employee.department?.name ?? '',
        assetTag: r.asset.assetTag,
        model: r.asset.model,
        serialNumber: r.asset.serialNumber ?? '',
        assignedAt: iso(r.assignedAt),
        returnedAt: iso(r.returnedAt),
        condition: r.conditionAtAssignment,
        status: r.returnedAt ? 'Closed' : 'Current',
      })),
    };
  }
  if (type === 'movements') {
    const rows = await prisma.assetHistory.findMany({
      where: {
        asset: where,
        eventType: { in: ['ASSET_ASSIGNED', 'ASSET_TRANSFERRED', 'ASSET_RETURNED', 'ASSET_MOVED'] },
      },
      include: { asset: true },
      orderBy: { timestamp: 'desc' },
      take: limit + 1,
    });
    const employeeIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.previousEmployeeId, r.newEmployeeId])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const locationIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.previousLocationId, r.newLocationId])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [employees, locations] = await Promise.all([
      prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, name: true } }),
      prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } }),
    ]);
    return {
      columns: columns({
        assetTag: 'Asset tag',
        model: 'Model',
        event: 'Event',
        date: 'Date',
        fromEmployee: 'From employee',
        toEmployee: 'To employee',
        fromLocation: 'From location',
        toLocation: 'To location',
        actor: 'Performed by',
        notes: 'Notes',
      }),
      rows: rows.map((r) => ({
        assetTag: r.asset.assetTag,
        model: r.asset.model,
        event: r.eventType,
        date: r.timestamp.toISOString(),
        fromEmployee: employees.find((e) => e.id === r.previousEmployeeId)?.name ?? '',
        toEmployee: employees.find((e) => e.id === r.newEmployeeId)?.name ?? '',
        fromLocation: locations.find((l) => l.id === r.previousLocationId)?.name ?? '',
        toLocation: locations.find((l) => l.id === r.newLocationId)?.name ?? '',
        actor: r.performedByName ?? '',
        notes: r.notes ?? '',
      })),
    };
  }
  if (type === 'repairs') {
    const rows = await prisma.assetRepair.findMany({
      where: { asset: where },
      include: { asset: true },
      orderBy: { openedAt: 'desc' },
      take: limit + 1,
    });
    return {
      columns: columns({
        assetTag: 'Asset tag',
        model: 'Model',
        issue: 'Issue',
        vendor: 'Vendor',
        status: 'Status',
        cost: 'Repair cost',
        opened: 'Opened',
        closed: 'Closed',
      }),
      rows: rows.map((r) => ({
        assetTag: r.asset.assetTag,
        model: r.asset.model,
        issue: r.issue,
        vendor: r.vendor ?? '',
        status: r.status,
        cost: r.cost?.toString() ?? '',
        opened: iso(r.openedAt),
        closed: iso(r.closedAt),
      })),
    };
  }
  if (type === 'offboarding') {
    const rows = await prisma.offboarding.findMany({
      where: employeeId ? { employeeId } : {},
      include: { employee: true, items: { include: { asset: true } } },
      orderBy: { startedAt: 'desc' },
      take: limit + 1,
    });
    return {
      columns: columns({
        employeeId: 'Employee ID',
        employee: 'Employee',
        status: 'Exit status',
        assetTag: 'Asset tag',
        model: 'Model',
        resolution: 'Resolution',
        started: 'Started',
        completed: 'Completed',
      }),
      rows: rows.flatMap((r) =>
        r.items.length
          ? r.items.map((item) => ({
              employeeId: r.employee.employeeId,
              employee: r.employee.name,
              status: r.status,
              assetTag: item.asset.assetTag,
              model: item.asset.model,
              resolution: item.resolution,
              started: iso(r.startedAt),
              completed: iso(r.completedAt),
            }))
          : [
              {
                employeeId: r.employee.employeeId,
                employee: r.employee.name,
                status: r.status,
                assetTag: '',
                model: '',
                resolution: 'NO_ASSETS',
                started: iso(r.startedAt),
                completed: iso(r.completedAt),
              },
            ],
      ),
    };
  }
  const allowed = ['inventory', 'assigned', 'available', 'lost', 'damaged', 'warranty'];
  if (!allowed.includes(type)) throw new AppError(404, 'Report not found.', 'NOT_FOUND');
  if (['assigned', 'available', 'lost', 'damaged'].includes(type)) where.status = type.toUpperCase();
  if (type === 'warranty' && !where.warrantyExpiry) {
    const setting = await prisma.setting.findUnique({ where: { key: 'warrantyAlertDays' } });
    where.warrantyExpiry = {
      not: null,
      lte: new Date(Date.now() + (typeof setting?.value === 'number' ? setting.value : 30) * 86400000),
    };
  }
  const rows = await prisma.asset.findMany({
    where,
    include: assetInclude,
    orderBy: { assetTag: 'asc' },
    take: limit + 1,
  });
  return {
    columns: columns({
      assetTag: 'Asset tag',
      category: 'Category',
      manufacturer: 'Manufacturer',
      model: 'Model',
      serialNumber: 'Serial number',
      status: 'Status',
      condition: 'Condition',
      holder: 'Current holder',
      department: 'Department',
      location: 'Location',
      purchaseDate: 'Purchased',
      purchaseCost: 'Purchase cost',
      warrantyExpiry: 'Warranty expiry',
    }),
    rows: rows.map((r) => ({
      assetTag: r.assetTag,
      category: r.category.name,
      manufacturer: r.manufacturer,
      model: r.model,
      serialNumber: r.serialNumber ?? '',
      status: r.status,
      condition: r.condition,
      holder: r.assignments[0]?.employee.name ?? '',
      department: r.department?.name ?? '',
      location: r.location?.name ?? '',
      purchaseDate: iso(r.purchaseDate),
      purchaseCost: r.purchaseCost?.toString() ?? '',
      warrantyExpiry: iso(r.warrantyExpiry),
    })),
  };
}
export const safeSpreadsheetText = (value: unknown) => {
  const text = String(value ?? '');
  return /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};
export const csvCell = (value: unknown) => `"${safeSpreadsheetText(value).replaceAll('"', '""')}"`;
function pdf(res: Response, report: Report, title: string) {
  const doc = new PDFDocument({
    size: 'A3',
    layout: 'landscape',
    margin: 30,
    bufferPages: true,
    info: { Title: `${title} | Asset Management` },
  });
  doc.pipe(res);
  const left = 30;
  const right = doc.page.width - 30;
  const width = (right - left) / report.columns.length;
  const overflow: { label: string; text: string }[] = [];
  let y = 0;
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#10293b').text('Asset Management', left, 27);
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(
        `${title} • Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC • ${report.rows.length} records`,
        left,
        54,
      );
    y = 84;
    doc.rect(left, y, right - left, 32).fill('#143d46');
    report.columns.forEach((column, i) =>
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('white')
        .text(column.label, left + i * width + 5, y + 7, { width: width - 10, height: 23 }),
    );
    y += 32;
  };
  header();
  for (const [rowIndex, original] of report.rows.entries()) {
    const row = { ...original };
    doc.font('Helvetica').fontSize(8);
    for (const column of report.columns) {
      const value = String(row[column.key] ?? '');
      if (doc.heightOfString(value, { width: width - 10 }) > doc.page.height - 190) {
        overflow.push({
          label: `${original.assetTag ?? original.employee ?? `Record ${rowIndex + 1}`} — ${column.label}`,
          text: value,
        });
        row[column.key] = `Full text: appendix item ${overflow.length}`;
      }
    }
    const rowHeight = Math.max(
      26,
      ...report.columns.map((c) => doc.heightOfString(String(row[c.key] ?? ''), { width: width - 10 }) + 12),
    );
    const height = rowHeight;
    if (y + height > doc.page.height - 45) {
      doc.addPage();
      header();
    }
    doc.rect(left, y, right - left, height).fill(rowIndex % 2 ? '#f1f5f7' : '#ffffff');
    report.columns.forEach((column, i) =>
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#233746')
        .text(String(row[column.key] ?? ''), left + i * width + 5, y + 6, {
          width: width - 10,
          height: height - 10,
          ellipsis: true,
        }),
    );
    y += height;
  }
  if (overflow.length) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#10293b').text('Full text appendix', left, 30);
    doc.moveDown();
    for (const [index, entry] of overflow.entries()) {
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`${index + 1}. ${entry.label}`, { width: right - left });
      doc.moveDown(0.5);
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(entry.text, { width: right - left });
      doc.moveDown();
    }
  }
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    doc
      .fontSize(8)
      .fillColor('#65717c')
      .text(`Page ${page + 1} of ${range.count}`, 30, doc.page.height - 30, { lineBreak: false });
  }
  doc.end();
}
reportsRouter.get('/:type', managers, async (req, res) => {
  const type = param(req, 'type');
  const data = await reportData(req, type);
  if (data.rows.length > limit)
    throw new AppError(
      422,
      `This report exceeds ${limit.toLocaleString()} rows. Apply filters to narrow the export.`,
      'REPORT_TOO_LARGE',
    );
  const format = queryString(req.query.format);
  if (!format) {
    await audit(prisma, req.actor, 'REPORT_GENERATED', 'Report', type, { rows: data.rows.length });
    ok(res, data);
    return;
  }
  if (!['csv', 'xlsx', 'pdf'].includes(format))
    throw new AppError(422, 'Choose CSV, Excel, or PDF format.', 'INVALID_EXPORT_FORMAT');
  await audit(prisma, req.actor, 'REPORT_EXPORTED', 'Report', type, { format, rows: data.rows.length });
  res.attachment(`asset-management-${type}-${new Date().toISOString().slice(0, 10)}.${format}`);
  if (format === 'csv') {
    res
      .type('text/csv; charset=utf-8')
      .send(
        '\ufeff' +
          [
            data.columns.map((c) => csvCell(c.label)).join(','),
            ...data.rows.map((row) => data.columns.map((c) => csvCell(row[c.key])).join(',')),
          ].join('\r\n'),
      );
    return;
  }
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Asset Management';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(type, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = data.columns.map((c) => ({
      header: c.label,
      key: c.key,
      width: Math.min(c.key === 'notes' || c.key === 'issue' ? 60 : 28, Math.max(c.label.length + 5, 18)),
    }));
    for (const row of data.rows)
      sheet.addRow(
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === 'number' ? value : safeSpreadsheetText(value),
          ]),
        ),
      );
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143D46' } };
    sheet.getRow(1).height = 28;
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, data.rows.length + 1), column: data.columns.length },
    };
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await workbook.xlsx.write(res);
    res.end();
    return;
  }
  res.type('application/pdf');
  pdf(
    res,
    data,
    type.replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  );
});
