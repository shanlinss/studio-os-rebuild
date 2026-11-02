import { createDatabase } from './database';
import { createStudioApp } from './app';
import { migrate } from './migrations';
import { runtimeMode } from './runtime';

async function main() {
  const database = createDatabase();
  try {
    await migrate(database);
    const app = await createStudioApp(database);
    // Staging is reachable only via the Compose loopback mapping, never host networking.
    await app.listen(
      3100,
      runtimeMode() === 'staging' ? '0.0.0.0' : '127.0.0.1',
    );
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await app.close();
      await database.close();
    };
    process.once('SIGTERM', () => {
      void stop();
    });
    process.once('SIGINT', () => {
      void stop();
    });
    console.log(`Studio OS ${runtimeMode()} server ready on port 3100`);
  } catch (error) {
    await database.close();
    throw error;
  }
}
main().catch(() => {
  console.error(
    'Studio OS startup failed; check the isolated database, migrations, and port 3100',
  );
  process.exitCode = 1;
});
