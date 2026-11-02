import { createDatabase } from './database';
import { checkReadiness } from './readiness';
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error('Node >=22 required');
  const database = createDatabase();
  try {
    console.log(
      JSON.stringify({
        status: 'ok',
        mode: 'read-only',
        ...(await checkReadiness(database)),
      }),
    );
  } finally {
    await database.close();
  }
}
main().catch(() => {
  console.error(
    'Studio OS check failed: verify Node >=22, local DATABASE_URL, PostgreSQL and checked-in migrations; no changes were made',
  );
  process.exitCode = 1;
});
