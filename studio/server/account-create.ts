import { createDatabase } from './database';
import { hashPassword } from './auth';
import { migrate } from './migrations';

// Deliberate local operator action only; no public registration or default account.
async function main() {
  const [username, role] = process.argv.slice(2);
  if (
    !/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username ?? '') ||
    !['admin', 'employee'].includes(role)
  )
    throw new Error('Expected username and admin|employee');
  if (process.stdin.isTTY)
    throw new Error('Supply password over stdin, never argv');
  let password = '';
  for await (const chunk of process.stdin) {
    password += chunk;
    if (password.length > 256) throw new Error('Input too long');
  }
  const hash = await hashPassword(password.replace(/\r?\n$/, ''));
  const db = createDatabase();
  try {
    await migrate(db);
    await db.client`INSERT INTO studio_os.accounts (username, password_hash, role) VALUES (${username}, ${hash}, ${role})`;
    console.log('Account created');
  } finally {
    await db.close();
  }
}
main().catch(() => {
  console.error(
    'Account creation failed; check input, uniqueness and local database',
  );
  process.exitCode = 1;
});
