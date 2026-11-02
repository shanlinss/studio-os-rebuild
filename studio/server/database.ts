import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { runtimeMode, stagingDatabaseUrl } from './runtime';

export function validateDatabaseUrl(value: string | undefined): string {
  if (!value)
    throw new Error('DATABASE_URL is required for the isolated test database');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55432' ||
    url.pathname !== '/studio_os_test' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'This development runtime only accepts the local studio_os_test database on port 55432',
    );
  }
  return value;
}

export function createDatabase(value = process.env.DATABASE_URL) {
  const connection =
    runtimeMode() === 'staging'
      ? stagingDatabaseUrl({ ...process.env, DATABASE_URL: value })
      : validateDatabaseUrl(value);
  const client = postgres(connection, {
    max: 4,
    connect_timeout: 5,
    idle_timeout: 20,
    onnotice: () => {},
  });
  return {
    client,
    orm: drizzle(client),
    close: () => client.end({ timeout: 5 }),
  };
}
export type StudioDatabase = ReturnType<typeof createDatabase>;
