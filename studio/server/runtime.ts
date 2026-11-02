import { readFileSync } from 'node:fs';

// Staging is a separate, fixed Docker network destination, never an arbitrary URL.
export function runtimeMode(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.STUDIO_RUNTIME ?? 'development';
  if (!['development', 'staging'].includes(mode))
    throw new Error('Unsupported Studio OS runtime');
  return mode as 'development' | 'staging';
}

export function stagingDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  readSecret: () => string = () =>
    readFileSync('/run/secrets/database_password', 'utf8'),
) {
  if (runtimeMode(env) !== 'staging' || env.DATABASE_URL)
    throw new Error(
      'Staging requires its dedicated secret, without DATABASE_URL',
    );
  const password = readSecret().trim();
  if (!/^[a-f0-9]{64}$/.test(password))
    throw new Error('Invalid staging database secret');
  return `postgresql://studio_staging:${password}@db:5432/studio_os_staging`;
}
