import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { createDatabase, type StudioDatabase } from './database';
import { hashPassword } from './password';
import { migrate } from './migrations';
import { runtimeMode } from './runtime';

// Explicit operator CLI, never a web endpoint/startup hook. No default passwords.
export async function createPreviewAccounts(
  db: StudioDatabase,
  filename: string,
) {
  const suffix = randomBytes(6).toString('hex');
  const accounts: {
    username: string;
    role: 'admin' | 'employee';
    password: string;
    hash: string;
  }[] = [];
  for (const [label, role] of [
    ['admin', 'admin'],
    ['staff_a', 'employee'],
    ['staff_b', 'employee'],
  ] as const) {
    const password = randomBytes(24).toString('hex');
    accounts.push({
      username: `preview_${label}_${suffix}`,
      role,
      password,
      hash: await hashPassword(password),
    });
  }
  // Refuse an existing handoff; never overwrite credentials or existing accounts.
  await writeFile(
    filename,
    JSON.stringify(
      {
        environment: 'studio-os-staging',
        accounts: accounts.map(({ username, role, password }) => ({
          username,
          role,
          password,
        })),
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  try {
    await db.client.begin(async (tx) => {
      for (const account of accounts)
        await tx`INSERT INTO studio_os.accounts(username,password_hash,role)
          VALUES (${account.username}, ${account.hash}, ${account.role})`;
    });
  } catch (error) {
    await unlink(filename);
    throw error;
  }
}

async function main() {
  if (runtimeMode() !== 'staging') throw new Error('Staging operator only');
  const db = createDatabase();
  try {
    await migrate(db);
    await createPreviewAccounts(db, '/handoff/accounts.json');
    console.log(
      'Preview accounts created; credentials are only in the private handoff file',
    );
  } finally {
    await db.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Preview account initialization failed; private handoff was not overwritten',
    );
    process.exitCode = 1;
  });
