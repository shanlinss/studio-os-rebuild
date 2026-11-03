import type {TransactionSql} from 'postgres';
import type {Identity} from './auth';
const timeFields = new Set(['original_in','original_out','adjusted_in','adjusted_out','proposed_at','reviewed_at','created_at','updated_at','serverNow']);
export function publicValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (timeFields.has(key) && typeof item === 'string') {
      const time = new Date(item);
      return [key, Number.isFinite(time.getTime()) ? time.toISOString() : item];
    }
    return [key, publicValue(item)];
  }));
  return value;
}
export async function lockOwner(tx: TransactionSql, owner: string) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'attendance-owner:' + owner},0))`;
}
export async function audit(tx: TransactionSql, identity: Identity, owner: string, periodId: string | null, correctionId: string | null, action: string, before: unknown, after: unknown) {
  const [name] = await tx`SELECT display_name FROM studio_os.members WHERE login_account_id=${identity.id}`;
  await tx`INSERT INTO studio_os.attendance_events(owner_id,period_id,correction_id,actor_id,actor_name,action,before_value,after_value,created_at) VALUES(${owner},${periodId},${correctionId},${identity.id},${name?.display_name || (identity.role === 'admin' ? '管理员' : '员工')},${action},${before ? JSON.stringify(publicValue(before)) : null}::jsonb,${JSON.stringify(publicValue(after))}::jsonb,clock_timestamp())`;
}
