import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';
export { hashPassword } from './password';
import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { StudioDatabase } from './database';

export type Identity = {
  id: string;
  username: string;
  role: 'admin' | 'employee';
};
export type AuthRequest = Request & {
  identity?: Identity;
  csrf?: string;
  tokenHash?: string;
};
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export class Authentication {
  constructor(private readonly db: StudioDatabase) {}
  async login(username: unknown, password: unknown, address: string) {
    // Charge the direct peer BEFORE validation or account bucket creation. A blocked
    // IP cannot grow the table by cycling usernames or spoofing forwarding headers.
    const charge = async (key: string) => {
      const rows = await this.db
        .client`INSERT INTO studio_os.login_limits (key, attempts, reset_at)
        VALUES (${key}, 1, now() + interval '15 minutes') ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN login_limits.reset_at <= now() THEN 1 ELSE LEAST(login_limits.attempts, 20) + 1 END,
        reset_at = CASE WHEN login_limits.reset_at <= now() THEN now() + interval '15 minutes' ELSE login_limits.reset_at END
        RETURNING attempts`;
      if (rows[0].attempts > 20)
        throw new HttpException('Try again later', 429);
    };
    await charge(digest(`ip:${address}`));
    if (
      typeof username !== 'string' ||
      !/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username) ||
      typeof password !== 'string' ||
      password.length > 128
    )
      throw new UnauthorizedException('Invalid credentials');
    await charge(digest(`user:${username}`));
    const [account] = await this.db
      .client`SELECT * FROM studio_os.accounts WHERE username = ${username}`;
    const verification = await verifyPassword(password, account?.password_hash);
    if (!verification.valid || !account?.active)
      throw new UnauthorizedException('Invalid credentials');
    if (verification.legacy) {
      const upgraded = await hashPassword(password);
      await this.db
        .client`UPDATE studio_os.accounts SET password_hash = ${upgraded}
        WHERE id = ${account.id} AND password_hash = ${account.password_hash}`;
    }
    await this.db
      .client`DELETE FROM studio_os.sessions WHERE expires_at <= now()`;
    await this.db
      .client`DELETE FROM studio_os.login_limits WHERE reset_at <= now()`;
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    await this.db
      .client`INSERT INTO studio_os.sessions (token_hash, account_id, csrf_token, expires_at)
      VALUES (${digest(token)}, ${account.id}, ${csrf}, now() + interval '8 hours')`;
    return {
      token,
      csrf,
      user: { id: account.id, username: account.username, role: account.role },
    };
  }
  async authenticate(req: AuthRequest) {
    const token = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith('studio_session='));
    if (token?.length !== 1) throw new UnauthorizedException();
    const value = token[0].slice('studio_session='.length);
    if (!/^[a-f0-9]{64}$/.test(value)) throw new UnauthorizedException();
    const [row] = await this.db
      .client`SELECT a.id, a.username, a.role, s.csrf_token FROM studio_os.sessions s
      JOIN studio_os.accounts a ON a.id = s.account_id
      WHERE s.token_hash = ${digest(value)} AND s.expires_at > now() AND a.active = true`;
    if (!row) throw new UnauthorizedException();
    req.identity = { id: row.id, username: row.username, role: row.role };
    req.csrf = row.csrf_token;
    req.tokenHash = digest(value);
  }
  csrf(req: AuthRequest) {
    if (!req.csrf || req.headers['x-csrf-token'] !== req.csrf)
      throw new ForbiddenException('CSRF token required');
  }
  async logout(req: AuthRequest) {
    await this.db
      .client`DELETE FROM studio_os.sessions WHERE token_hash = ${req.tokenHash!}`;
  }
}
