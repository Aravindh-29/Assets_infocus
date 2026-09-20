import 'dotenv/config';
import { Prisma, PrismaClient, type Employee } from '@prisma/client';
import bcrypt from 'bcryptjs';

// This script never updates an existing record, resets a password, or deletes data.
// Fixed IDs make every seeded event repeatable without duplicating audit history.
const environment = process.env.NODE_ENV;
if (environment !== 'development' && environment !== 'test') {
  throw new Error(
    'Demo seed is restricted to NODE_ENV=development or NODE_ENV=test. Production seeding is prohibited.',
  );
}

const prisma = new PrismaClient();
const seedId = (number: number) => `d3a00000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const day = 24 * 60 * 60 * 1000;
const now = new Date();
const daysAgo = (count: number) => new Date(now.getTime() - count * day);
const daysAhead = (count: number) => new Date(now.getTime() + count * day);

const employeeNames = [
  'John Smith',
  'David Kumar',
  'Aisha Rahman',
  'Emma Wilson',
  'Ravi Patel',
  'Sophie Chen',
  'Daniel Lee',
  'Priya Nair',
  'Oliver Brown',
  'Mei Tan',
];
const categorySpecs = [
  { name: 'Laptop', prefix: 'LAP', manufacturer: 'Dell', model: 'Latitude 5440', cost: 4200 },
  { name: 'Monitor', prefix: 'MON', manufacturer: 'Dell', model: 'P2422H', cost: 900 },
  { name: 'Mobile', prefix: 'MOB', manufacturer: 'Samsung', model: 'Galaxy A55', cost: 1800 },
  { name: 'Headset', prefix: 'HEAD', manufacturer: 'Jabra', model: 'Evolve2 40', cost: 550 },
  { name: 'Modem', prefix: 'MOD', manufacturer: 'Huawei', model: '5G CPE Pro', cost: 1200 },
];

async function main() {
  // Hash before acquiring a transaction. These credentials are development-only.
  const credentials = [
    { email: 'admin@example.com', name: 'System Administrator', role: 'ADMIN', password: 'Admin@12345!' },
    {
      email: 'assetmanager@example.com',
      name: 'Asset Manager',
      role: 'ASSET_MANAGER',
      password: 'Manager@12345!',
    },
    { email: 'employee@example.com', name: 'John Smith', role: 'EMPLOYEE', password: 'Employee@12345!' },
  ];
  const passwordHashes = await Promise.all(credentials.map((user) => bcrypt.hash(user.password, 12)));

  const outcome = await prisma.$transaction(
    async (tx) => {
      const departments = [];
      for (const [index, name] of ['Engineering', 'Finance', 'Human Resources', 'Operations'].entries()) {
        departments.push(
          await tx.department.upsert({
            where: { name },
            update: {},
            create: { id: seedId(100 + index), name },
          }),
        );
      }
      const locations = [];
      for (const [index, name] of ['Malaysia Office', 'Singapore Office', 'Warehouse'].entries()) {
        locations.push(
          await tx.location.upsert({
            where: { name },
            update: {},
            create: { id: seedId(200 + index), name },
          }),
        );
      }
      const categories = [];
      for (const [index, spec] of categorySpecs.entries()) {
        categories.push(
          await tx.assetCategory.upsert({
            where: { name: spec.name },
            update: {},
            create: {
              id: seedId(300 + index),
              name: spec.name,
              description: `Company ${spec.name.toLowerCase()} equipment`,
              serialRequiredUnique: true,
            },
          }),
        );
      }

      const employees: Employee[] = [];
      for (const [index, name] of employeeNames.entries()) {
        const employeeId = `EMP${1001 + index}`;
        const email =
          index === 0 ? 'employee@example.com' : `${name.toLowerCase().replaceAll(' ', '.')}@example.com`;
        const existing = await tx.employee.findFirst({ where: { OR: [{ employeeId }, { email }] } });
        employees.push(
          existing ??
            (await tx.employee.create({
              data: {
                id: seedId(400 + index),
                employeeId,
                name,
                email,
                designation: ['Software Engineer', 'Team Lead', 'Analyst', 'Operations Specialist'][
                  index % 4
                ],
                departmentId: departments[index % departments.length]!.id,
                locationId: locations[index % 2]!.id,
                joinedAt: daysAgo(365 + index * 20),
              },
            })),
        );
      }

      const users = [];
      for (const [index, user] of credentials.entries()) {
        users.push(
          await tx.user.upsert({
            where: { email: user.email },
            update: {},
            create: {
              id: seedId(500 + index),
              email: user.email,
              name: user.name,
              role: user.role,
              passwordHash: passwordHashes[index]!,
              employeeId: index === 2 ? employees[0]!.id : undefined,
              mustChangePassword: false,
            },
          }),
        );
      }
      const admin = users[0]!;
      let createdAssets = 0;
      let skippedAssets = 0;

      for (let index = 0; index < 20; index += 1) {
        const categoryIndex = Math.floor(index / 4);
        const spec = categorySpecs[categoryIndex]!;
        const category = categories[categoryIndex]!;
        const assetTag = `${spec.prefix}-${String((index % 4) + 1).padStart(4, '0')}`;
        const assetId = seedId(1000 + index);
        // If a user already registered this tag, leave that asset and its history alone.
        if (await tx.asset.findFirst({ where: { OR: [{ id: assetId }, { assetTag }] } })) {
          skippedAssets += 1;
          continue;
        }
        const serialNumber = `DEMO-${spec.prefix}-${String(index + 1).padStart(5, '0')}`;
        const serialUniqueKey = category.serialRequiredUnique
          ? `${category.id}:${serialNumber.toUpperCase()}`
          : null;
        if (serialUniqueKey && (await tx.asset.findUnique({ where: { serialUniqueKey } }))) {
          skippedAssets += 1;
          continue;
        }

        // Each asset has a self-contained, chronologically ordered example history.
        const eventBase = 10000 + index * 100;
        let eventSequence = 0;
        const history = async (
          eventType: string,
          data: Omit<
            Prisma.AssetHistoryUncheckedCreateInput,
            'id' | 'assetId' | 'eventType' | 'performedById'
          > = {},
        ) => {
          const eventId = eventBase + eventSequence++;
          const timestamp = data.timestamp ?? daysAgo(240);
          await tx.assetHistory.create({
            data: {
              id: seedId(eventId),
              assetId,
              eventType,
              performedById: admin.id,
              performedByName: admin.name,
              ...data,
              timestamp,
            },
          });
          await tx.auditLog.create({
            data: {
              id: seedId(eventId + 100000),
              userId: admin.id,
              userName: admin.name,
              action: eventType,
              entityType: 'Asset',
              entityId: assetId,
              timestamp,
              ip: '127.0.0.1',
              details: { assetTag, source: 'development-seed', notes: data.notes ?? null },
            },
          });
        };
        const initialLocation = locations[0]!;
        const assignedEmployeeIndex: Record<number, number> = {
          0: 1,
          1: 0,
          4: 2,
          5: 3,
          8: 5,
          12: 7,
          13: 8,
          16: 9,
        };
        const currentEmployeeIndex = assignedEmployeeIndex[index];
        const currentEmployee =
          currentEmployeeIndex === undefined ? undefined : employees[currentEmployeeIndex]!;
        let status = currentEmployee ? 'ASSIGNED' : 'AVAILABLE';
        if (index === 3) status = 'UNDER_REPAIR';
        if (index === 7) status = 'DAMAGED';
        if (index === 9) status = 'LOST';
        if (index === 11) status = 'RETIRED';
        if (index === 15) status = 'DISPOSED';

        const asset = await tx.asset.create({
          data: {
            id: assetId,
            assetTag,
            assetType: spec.name,
            categoryId: category.id,
            manufacturer: spec.manufacturer,
            model: spec.model,
            serialNumber,
            serialUniqueKey,
            status,
            condition: index === 7 ? 'DAMAGED' : index === 15 ? 'UNUSABLE' : 'GOOD',
            purchaseDate: daysAgo(254),
            purchaseCost: spec.cost,
            vendor: 'Corporate IT Supplier',
            invoiceNumber: `DEMO-INV-${2026}-${String(index + 1).padStart(4, '0')}`,
            warrantyStart: daysAgo(254),
            warrantyExpiry: index % 5 === 0 ? daysAhead(14) : index === 11 ? daysAgo(10) : daysAhead(111),
            locationId: index === 17 ? locations[1]!.id : (currentEmployee?.locationId ?? initialLocation.id),
            departmentId: currentEmployee?.departmentId ?? departments[index % departments.length]!.id,
            description: `${spec.manufacturer} ${spec.model} — demonstration asset`,
            notes: 'Development sample. Safe to use for local workflow exploration.',
            barcode: assetTag,
            qrCode: assetTag,
            createdById: admin.id,
            createdAt: daysAgo(240),
          },
        });
        createdAssets += 1;
        await history('ASSET_REGISTERED', {
          newStatus: 'AVAILABLE',
          newLocationId: index === 17 ? initialLocation.id : asset.locationId,
          notes: 'Asset registered in the company inventory.',
          timestamp: daysAgo(240),
        });

        const assign = async (
          slot: number,
          employeeIndex: number,
          assignedAt: Date,
          returnedAt?: Date,
          conditionAtReturn?: string,
        ) => {
          const employee = employees[employeeIndex]!;
          const assignment = await tx.assetAssignment.create({
            data: {
              id: seedId(20000 + index * 10 + slot),
              assetId,
              employeeId: employee.id,
              assignedAt,
              assignedById: admin.id,
              conditionAtAssignment: 'GOOD',
              returnedAt,
              returnedById: returnedAt ? admin.id : undefined,
              conditionAtReturn,
              notes: 'Development sample assignment.',
              createdAt: assignedAt,
            },
          });
          return assignment;
        };
        const assignmentHistory = async (employeeIndex: number, timestamp: Date) =>
          history('ASSET_ASSIGNED', {
            previousStatus: 'AVAILABLE',
            newStatus: 'ASSIGNED',
            newEmployeeId: employees[employeeIndex]!.id,
            notes: `Issued to ${employees[employeeIndex]!.name}.`,
            timestamp,
          });

        if (index === 0) {
          await assign(0, 0, daysAgo(230), daysAgo(60), 'GOOD');
          await assignmentHistory(0, daysAgo(230));
          await assign(1, 1, daysAgo(60));
          await tx.assetTransfer.create({
            data: {
              id: seedId(30000 + index),
              assetId,
              fromEmployeeId: employees[0]!.id,
              toEmployeeId: employees[1]!.id,
              transferredAt: daysAgo(60),
              performedById: admin.id,
              reason: 'Team reassignment',
              createdAt: daysAgo(60),
            },
          });
          await history('ASSET_TRANSFERRED', {
            previousStatus: 'ASSIGNED',
            newStatus: 'ASSIGNED',
            previousEmployeeId: employees[0]!.id,
            newEmployeeId: employees[1]!.id,
            notes: 'Transferred from John Smith to David Kumar.',
            timestamp: daysAgo(60),
          });
        } else if (currentEmployeeIndex !== undefined) {
          await assign(0, currentEmployeeIndex, daysAgo(180 - index * 3));
          await assignmentHistory(currentEmployeeIndex, daysAgo(180 - index * 3));
        } else if (index === 2 || index === 7) {
          const employeeIndex = index === 2 ? 0 : 4;
          const condition = index === 7 ? 'DAMAGED' : 'GOOD';
          await assign(0, employeeIndex, daysAgo(210), daysAgo(45), condition);
          await assignmentHistory(employeeIndex, daysAgo(210));
          await tx.assetReturn.create({
            data: {
              id: seedId(31000 + index),
              assetId,
              employeeId: employees[employeeIndex]!.id,
              returnedAt: daysAgo(45),
              condition,
              accessories: index === 2 ? ['Charger', 'Laptop Bag'] : ['Power Cable'],
              damage: index === 7 ? 'Cracked display panel' : undefined,
              notes: 'Returned to inventory.',
              performedById: admin.id,
              createdAt: daysAgo(45),
            },
          });
          await history('ASSET_RETURNED', {
            previousStatus: 'ASSIGNED',
            newStatus: status,
            previousEmployeeId: employees[employeeIndex]!.id,
            notes:
              index === 7
                ? 'Returned with a cracked display; unavailable for assignment.'
                : 'Returned in good condition.',
            timestamp: daysAgo(45),
          });
        } else if (index === 3 || index === 14) {
          await assign(0, 2, daysAgo(200), daysAgo(30), 'GOOD');
          await assignmentHistory(2, daysAgo(200));
          await tx.assetRepair.create({
            data: {
              id: seedId(32000 + index),
              assetId,
              issue: index === 3 ? 'Laptop battery failure' : 'Microphone not working',
              reportedById: admin.id,
              status: index === 3 ? 'IN_REPAIR' : 'CLOSED',
              vendor: 'ABC Technologies',
              cost: index === 3 ? 450 : 120,
              openedAt: daysAgo(30),
              closedAt: index === 14 ? daysAgo(20) : undefined,
              notes: index === 3 ? 'Replacement battery ordered.' : 'Microphone replaced and tested.',
              createdAt: daysAgo(30),
            },
          });
          await history('ASSET_SENT_FOR_REPAIR', {
            previousStatus: 'ASSIGNED',
            newStatus: 'UNDER_REPAIR',
            previousEmployeeId: employees[2]!.id,
            notes: 'Received for repair; employee custody closed.',
            timestamp: daysAgo(30),
          });
          if (index === 14)
            await history('ASSET_REPAIRED', {
              previousStatus: 'UNDER_REPAIR',
              newStatus: 'AVAILABLE',
              notes: 'Repair completed, quality checked, and returned to inventory.',
              timestamp: daysAgo(20),
            });
        } else if (index === 9) {
          await assign(0, 6, daysAgo(150), daysAgo(15));
          await assignmentHistory(6, daysAgo(150));
          await tx.assetRequest.create({
            data: {
              id: seedId(33000 + index),
              assetId,
              employeeId: employees[6]!.id,
              type: 'LOST',
              description: 'Mobile phone missing after business travel.',
              location: 'Malaysia Office',
              status: 'APPROVED',
              resolution: 'Loss confirmed and asset marked lost.',
              reviewedById: admin.id,
              reviewedAt: daysAgo(15),
              createdAt: daysAgo(16),
            },
          });
          await history('ASSET_REPORTED_LOST', {
            previousStatus: 'ASSIGNED',
            newStatus: 'LOST',
            previousEmployeeId: employees[6]!.id,
            notes: 'Loss report approved; responsible employee preserved in history.',
            timestamp: daysAgo(15),
          });
        } else if (index === 11 || index === 15) {
          await history('ASSET_RETIRED', {
            previousStatus: 'AVAILABLE',
            newStatus: 'RETIRED',
            notes: 'Retired at the end of useful service life.',
            timestamp: daysAgo(20),
          });
          if (index === 15)
            await history('ASSET_DISPOSED', {
              previousStatus: 'RETIRED',
              newStatus: 'DISPOSED',
              notes: 'Disposed through approved electronics recycling.',
              timestamp: daysAgo(10),
            });
        }

        if (index === 17) {
          await tx.assetMovement.create({
            data: {
              id: seedId(34000 + index),
              assetId,
              fromLocationId: initialLocation.id,
              toLocationId: locations[1]!.id,
              movedAt: daysAgo(25),
              performedById: admin.id,
              notes: 'Moved to Singapore inventory.',
              createdAt: daysAgo(25),
            },
          });
          await history('ASSET_MOVED', {
            previousLocationId: initialLocation.id,
            newLocationId: locations[1]!.id,
            notes: 'Moved from Malaysia Office to Singapore Office.',
            timestamp: daysAgo(25),
          });
        }
        if (index === 19) {
          await tx.assetMaintenance.create({
            data: {
              id: seedId(35000 + index),
              assetId,
              description: 'Quarterly firmware update and connectivity check',
              scheduledAt: daysAhead(7),
              status: 'SCHEDULED',
              performedById: admin.id,
            },
          });
          await history('MAINTENANCE_SCHEDULED', {
            notes: 'Quarterly firmware update and connectivity check scheduled.',
            timestamp: now,
          });
        }
        if (index === 1) {
          await tx.assetRequest.create({
            data: {
              id: seedId(36000 + index),
              assetId,
              employeeId: employees[0]!.id,
              type: 'DAMAGE',
              description: 'Keyboard key is sticking; please arrange an inspection.',
              status: 'PENDING',
              createdAt: daysAgo(1),
            },
          });
        }
        if (currentEmployee?.id === employees[0]!.id) {
          await tx.notification.create({
            data: {
              id: seedId(37000 + index),
              userId: users[2]!.id,
              title: 'Asset assigned',
              message: `${asset.assetTag} — ${asset.model} is assigned to you.`,
              link: `/assets/${assetId}`,
              createdAt: daysAgo(180 - index * 3),
            },
          });
        }
      }

      await tx.setting.upsert({
        where: { key: 'organizationName' },
        update: {},
        create: { key: 'organizationName', value: 'Company Asset Management' },
      });
      await tx.setting.upsert({
        where: { key: 'warrantyAlertDays' },
        update: {},
        create: { key: 'warrantyAlertDays', value: 30 },
      });
      if (!(await tx.auditLog.findUnique({ where: { id: seedId(999999) } }))) {
        await tx.auditLog.create({
          data: {
            id: seedId(999999),
            userId: admin.id,
            userName: admin.name,
            action: 'DEVELOPMENT_SEED',
            entityType: 'System',
            details: {
              description: 'Development demonstration data initialized without changing existing records.',
            },
            ip: '127.0.0.1',
          },
        });
      }
      return { createdAssets, skippedAssets };
    },
    { timeout: 60000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  console.log(
    `Development seed complete: ${outcome.createdAssets} assets created; ${outcome.skippedAssets} existing assets preserved.`,
  );
  console.log(
    'Demo users: admin@example.com, assetmanager@example.com, employee@example.com. Development passwords are documented in the README.',
  );
}

main()
  .catch((error) => {
    console.error('Seed failed. The transaction was rolled back.', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
