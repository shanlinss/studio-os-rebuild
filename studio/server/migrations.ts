import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StudioDatabase } from './database';

export async function migrate(
  database: StudioDatabase,
  directory = path.resolve('studio/migrations'),
  schema = 'studio_os',
) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new Error('Invalid migration schema');
  const files = await readMigrationFiles(directory);
  return database.client.begin(async (tx) => {
    // Serialize startup/migration invocations before inspecting the version table.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`studio-os-migrations:${schema}`}))`;
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await tx.unsafe(`SET LOCAL search_path TO "${schema}", pg_catalog`);
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const previous = await tx<
      { name: string; checksum: string }[]
    >`SELECT name, checksum FROM schema_migrations ORDER BY name`;
    // Reject missing, edited, or inserted-before-existing migrations.
    for (const [index, row] of previous.entries()) {
      if (
        files[index]?.name !== row.name ||
        files[index]?.checksum !== row.checksum
      ) {
        throw new Error('Migration history differs from the checked-in files');
      }
    }
    let applied = 0;
    for (const file of files.slice(previous.length)) {
      let content = file.content;
      // 020 was applied locally with an explicit default-schema identifier. Keep
      // its immutable checksum; relocate only this exact known statement for the
      // existing isolated-schema recovery/readiness drills. Never rewrite SQL
      // strings or identifiers generically or route a test migration into studio_os.
      if (
        schema !== 'studio_os' &&
        file.name === '020_business_account_details.sql'
      ) {
        if (
          file.checksum !==
          '07e79f6e815aba2a4f0367d52efa74cb4868a45dc164fec6a4f6abe672a3cefd'
        )
          throw new Error('Unrecognized schema-qualified migration');
        content = content.replace(
          'ALTER TABLE studio_os.business_accounts',
          `ALTER TABLE "${schema}".business_accounts`,
        );
      }
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${file.name}, ${file.checksum})`;
      applied++;
    }
    return { applied, total: files.length };
  });
}

export async function readMigrationFiles(
  directory = path.resolve('studio/migrations'),
) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!names.length) throw new Error('No migration files found');
  return Promise.all(
    names.map(async (name) => {
      const content = await readFile(path.join(directory, name), 'utf8');
      return {
        name,
        content,
        checksum: createHash('sha256').update(content).digest('hex'),
      };
    }),
  );
}
