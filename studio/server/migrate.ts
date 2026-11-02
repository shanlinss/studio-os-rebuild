import { createDatabase } from './database';
import { migrate } from './migrations';

async function main() {
  const database = createDatabase();
  try {
    console.log('Studio OS migrations:', await migrate(database));
  } finally {
    await database.close();
  }
}
main().catch(() => {
  console.error(
    'Studio OS migration failed; check local database and migration history',
  );
  process.exitCode = 1;
});
