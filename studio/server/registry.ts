import {livePermission} from './permissions';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { StudioDatabase } from './database';
import { objectInput, shortText, uuid, version } from './validation';
function optionalFact(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  return value === null || value === '' ? null : shortText(value, max);
}
function basicFacts(body: Record<string, unknown>) {
  const jobTitle = optionalFact(body.jobTitle, 100);
  const employmentStatus = optionalFact(body.employmentStatus, 40);
  let startDate: string | null | undefined;
  if (body.startDate !== undefined) {
    if (body.startDate === null || body.startDate === '') startDate = null;
    else {
      if (typeof body.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) throw new BadRequestException();
      const date = new Date(body.startDate + 'T00:00:00Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.startDate || body.startDate.startsWith('0000')) throw new BadRequestException();
      startDate = body.startDate;
    }
  }
  return { jobTitle, startDate, employmentStatus };
}
export class Members {
  constructor(private readonly db: StudioDatabase) {}
  list() {
    return this.db
      .client`SELECT m.id, m.display_name AS "displayName", m.login_account_id AS "loginAccountId", m.active, m.version, m.job_title AS "jobTitle", m.start_date::text AS "startDate", m.employment_status AS "employmentStatus",
      a.username, a.role, a.active AS "loginActive" FROM studio_os.members m LEFT JOIN studio_os.accounts a ON a.id = m.login_account_id ORDER BY m.display_name, m.id`;
  }
  async ownProfile(actor: string, query: unknown) {
    objectInput(query, []);
    // No SELECT * or caller-supplied member ID: never reuse the admin directory projection.
    const [profile] = await this.db.client`SELECT id, display_name AS "displayName", job_title AS "jobTitle", start_date::text AS "startDate", employment_status AS "employmentStatus" FROM studio_os.members WHERE login_account_id = ${actor}`;
    return { profile: profile ?? null };
  }
  async create(value: unknown, actor: string) {
    const body = objectInput(value, ['displayName', 'loginAccountId', 'jobTitle', 'startDate', 'employmentStatus']);
    const facts = basicFacts(body);
    const name = shortText(body.displayName);
    const login =
      body.loginAccountId === undefined || body.loginAccountId === null
        ? null
        : uuid(body.loginAccountId);
    try {
      return await this.db.client.begin(async (tx) => {
        if(login)await livePermission(tx,actor,'account_security');
        if (login) {
          const [account] =
            await tx`SELECT id FROM studio_os.accounts WHERE id = ${login} AND active FOR SHARE`;
          if (!account) throw new BadRequestException();
        }
        const [row] =
          await tx`INSERT INTO studio_os.members (display_name, login_account_id, job_title, start_date, employment_status) VALUES (${name}, ${login}, ${facts.jobTitle ?? null}, ${facts.startDate ?? null}, ${facts.employmentStatus ?? null}) RETURNING id, display_name AS "displayName", login_account_id AS "loginAccountId", active, version, job_title AS "jobTitle", start_date::text AS "startDate", employment_status AS "employmentStatus"`;
        await tx`INSERT INTO studio_os.identity_events (entity_type, entity_id, actor_id, action, after_value) VALUES ('member', ${row.id}, ${actor}, 'created', ${JSON.stringify(row)})`;
        return row;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException();
      throw error;
    }
  }
  async update(id: string, value: unknown, actor: string) {
    uuid(id);
    const body = objectInput(value, [
      'displayName',
      'active',
      'expectedVersion',
      'loginAccountId',
      'jobTitle', 'startDate', 'employmentStatus',
    ]);
    const expected = version(body.expectedVersion);
    const facts = basicFacts(body);
    if (
      body.displayName === undefined &&
      body.active === undefined &&
      body.loginAccountId === undefined &&
      body.jobTitle === undefined && body.startDate === undefined && body.employmentStatus === undefined
    )
      throw new BadRequestException();
    if (body.active !== undefined && typeof body.active !== 'boolean')
      throw new BadRequestException();
    const name =
      body.displayName !== undefined ? shortText(body.displayName) : undefined;
    const login =
      body.loginAccountId !== undefined ? uuid(body.loginAccountId) : undefined;
    try {
      return await this.db.client.begin(async (tx) => {
        if(login)await livePermission(tx,actor,'account_security');
        const [before] =
          await tx`SELECT id, display_name AS "displayName", login_account_id AS "loginAccountId", active, version, job_title AS "jobTitle", start_date::text AS "startDate", employment_status AS "employmentStatus" FROM studio_os.members WHERE id = ${id} FOR UPDATE`;
        if (!before) throw new NotFoundException();
        if (
          before.version !== expected ||
          (login && before.loginAccountId && before.loginAccountId !== login)
        )
          throw new ConflictException();
        if (login) {
          if (
            !(
              await tx`SELECT id FROM studio_os.accounts WHERE id = ${login} AND active FOR SHARE`
            ).length
          )
            throw new BadRequestException();
        }
        const [row] =
          await tx`UPDATE studio_os.members SET display_name = ${name ?? before.displayName}, active = ${body.active ?? before.active}, login_account_id = ${login ?? before.loginAccountId}, job_title = ${facts.jobTitle === undefined ? before.jobTitle : facts.jobTitle}, start_date = ${facts.startDate === undefined ? before.startDate : facts.startDate}, employment_status = ${facts.employmentStatus === undefined ? before.employmentStatus : facts.employmentStatus}, version = version + 1, updated_at = now() WHERE id = ${id} RETURNING id, display_name AS "displayName", login_account_id AS "loginAccountId", active, version, job_title AS "jobTitle", start_date::text AS "startDate", employment_status AS "employmentStatus"`;
        await tx`INSERT INTO studio_os.identity_events (entity_type, entity_id, actor_id, action, before_value, after_value) VALUES ('member', ${row.id}, ${actor}, 'updated', ${JSON.stringify(before)}, ${JSON.stringify(row)})`;
        return row;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException();
      throw error;
    }
  }
}
