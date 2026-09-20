import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { z } from 'zod';

class BootstrapError extends Error {}

const accountSchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
  name: z.string().trim().min(1).max(200),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/[0-9]/, 'Password must include a number.')
    .regex(/[^a-zA-Z0-9]/, 'Password must include a symbol.')
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= 72,
      'Password must be at most 72 UTF-8 bytes (bcrypt limit).',
    ),
});

/** Read without echoing characters or placing the password in shell history. */
async function hiddenQuestion(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new BootstrapError(
      'Interactive password input requires a terminal. Inject ADMIN_PASSWORD through a one-time secret environment variable instead.',
    );
  }
  return new Promise((resolve, reject) => {
    let password = '';
    const wasRaw = stdin.isRaw;
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.off('error', onError);
      stdin.off('end', onEnd);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(password);
      password = '';
    };
    const onError = () => finish(new BootstrapError('Could not read password from the terminal.'));
    const onEnd = () => finish(new BootstrapError('Password input ended unexpectedly.'));
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003' || character === '\u0004') {
          finish(new BootstrapError('Administrator bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\b' || character === '\u007f') {
          password = [...password].slice(0, -1).join('');
        } else if (character >= ' ' && character !== '\u001b') {
          password += character;
        }
        if (password.length > 128) {
          finish(new BootstrapError('Password exceeds the maximum length.'));
          return;
        }
      }
    };
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdin.once('error', onError);
    stdin.once('end', onEnd);
  });
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Create the first administrator in an already-migrated database.');
    console.log('Run from backend: npm run admin:create');
    console.log('Requires DATABASE_URL. Prompts for email, name, and a hidden password.');
    console.log('For automation, inject ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD using your secret manager.');
    console.log(
      'Refuses if any administrator or the chosen email already exists. Never updates accounts or seeds demo data.',
    );
    return;
  }
  if (!process.env.DATABASE_URL)
    throw new BootstrapError('DATABASE_URL must point to the intended, migrated database.');

  let email = process.env.ADMIN_EMAIL;
  let name = process.env.ADMIN_NAME;
  let password = process.env.ADMIN_PASSWORD;
  // Avoid retaining the one-time credential in the environment of this process.
  delete process.env.ADMIN_PASSWORD;

  if (!email || !name) {
    if (!stdin.isTTY || !stdout.isTTY)
      throw new BootstrapError('Set ADMIN_EMAIL and ADMIN_NAME for non-interactive bootstrap.');
    const prompts = createInterface({ input: stdin, output: stdout });
    try {
      email ??= await prompts.question('Administrator email: ');
      name ??= await prompts.question('Administrator name: ');
    } finally {
      prompts.close();
    }
  }
  if (!password) {
    password = await hiddenQuestion('Administrator password (hidden): ');
    const confirmation = await hiddenQuestion('Confirm password (hidden): ');
    if (password !== confirmation)
      throw new BootstrapError('Passwords do not match. No account was created.');
  }

  const parsed = accountSchema.safeParse({ email, name, password });
  password = undefined;
  if (!parsed.success) {
    throw new BootstrapError(
      `Invalid administrator details: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' ')}`,
    );
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  parsed.data.password = '';
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(
      async (tx) => {
        // Serialize concurrent bootstrap attempts without introducing persistent state.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73003812)`;
        if (await tx.user.count({ where: { role: 'ADMIN' } })) {
          throw new BootstrapError(
            'An administrator already exists. Sign in and manage users through the application. Bootstrap will not replace or reactivate an account.',
          );
        }
        if (await tx.user.findUnique({ where: { email: parsed.data.email } })) {
          throw new BootstrapError(
            'The selected email already belongs to an account. No account was changed.',
          );
        }
        const administrator = await tx.user.create({
          data: {
            email: parsed.data.email,
            name: parsed.data.name,
            passwordHash,
            role: 'ADMIN',
            active: true,
            mustChangePassword: true,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: administrator.id,
            userName: administrator.name,
            action: 'ADMIN_BOOTSTRAPPED',
            entityType: 'User',
            entityId: administrator.id,
            details: { source: 'administrator-bootstrap-cli', mustChangePassword: true },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
    );
    console.log(
      'Administrator created. Sign in and change the one-time password before using the application.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // Do not print Prisma query arguments, environment values, hashes, or stacks.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(
      error.code === 'P2002'
        ? 'Bootstrap refused: an account with this email already exists.'
        : 'Administrator bootstrap failed at the database. Verify migrations, connectivity, and database permissions.',
    );
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    console.error('Cannot connect to the database. Verify DATABASE_URL and database permissions.');
  } else {
    console.error(
      error instanceof BootstrapError
        ? error.message
        : 'Administrator bootstrap failed. No account changes were committed.',
    );
  }
  process.exitCode = 1;
});
