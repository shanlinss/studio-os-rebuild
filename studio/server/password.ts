import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';

// Explicit version/cost; 64 MiB per operation. Limit in-flight work, never queue
// unbounded password jobs or block the event loop with synchronous scrypt.
const cost = { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };
const prefix = 'scrypt-v1:65536:8:2:';
let active = 0;
async function derive(password: string, salt: string, legacy = false) {
  if (active >= 2) throw new HttpException('Try again later', 429);
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        64,
        legacy ? { N: 16384, r: 8, p: 1 } : cost,
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
  } finally {
    active--;
  }
}
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new Error('Password must contain 12 to 128 characters');
  const salt = randomBytes(16).toString('hex');
  return `${prefix}${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(
  password: string,
  encoded: string | undefined,
) {
  const legacy = !!encoded && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded);
  const current =
    !!encoded &&
    /^scrypt-v1:65536:8:2:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded);
  // Unknown/corrupt accounts still pay the current verification cost, fail closed.
  const parts = (
    legacy ? encoded! : current ? encoded!.slice(prefix.length) : ''
  ).split(':');
  const actual = await derive(
    password,
    parts[0] || '00000000000000000000000000000000',
    legacy,
  );
  const expected = Buffer.from(parts[1] || '00'.repeat(64), 'hex');
  return {
    valid: timingSafeEqual(actual, expected) && (legacy || current),
    legacy,
  };
}
