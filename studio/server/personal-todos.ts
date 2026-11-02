// Restores TodayPanel/DashboardPanel personal rows; server identity owns every row.
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Identity } from './auth';
import type { StudioDatabase } from './database';
import { requireContributor } from './access';
import { timestamp } from './workflow';
import {
  optionalLongText,
  objectInput,
  shortText,
  uuid,
  version,
} from './validation';
function fields(b: Record<string, unknown>) {
  const taskType = shortText(b.taskType),
    priority = shortText(b.priority),
    status = shortText(b.status);
  if (
    !['素材收集', '内容策划', '素材测试', '数据回填', '内容整理', '内容制作', '数据记录', '测试复盘', '其他事项'].includes(
      taskType,
    ) ||
    !['高', '中', '低'].includes(priority) ||
    !['待开始', '进行中', '已完成', '取消'].includes(status)
  )
    throw new BadRequestException();
  return {
    title: shortText(b.title, 200),
    taskType,
    priority,
    status,
    notes: optionalLongText(b.notes, 2000),
    // Absence means an old client: keep its replay hash and preserve existing
    // dates on update. An explicit null clears a date in the new client.
    ...(b.plannedOn !== undefined ? { plannedOn: plannedDate(b.plannedOn) } : {}),
    ...(b.dueAt !== undefined ? { dueAt: b.dueAt === null || b.dueAt === '' ? null : timestamp(b.dueAt) } : {}),
  };
}
function plannedDate(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.startsWith('0000') || !/^\d{4}-\d\d-\d\d$/.test(value)) throw new BadRequestException();
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new BadRequestException();
  return value;
}
function scheduleOrder(plannedOn: string | null, dueAt: string | null) {
  if (plannedOn && dueAt && Date.parse(dueAt) < Date.parse(plannedOn+'T00:00:00+08:00'))
    throw new BadRequestException('截止时间不能早于计划日期');
}
export class PersonalTodos {
  constructor(private readonly db: StudioDatabase) {}
  async list(identity: Identity, query: Record<string, unknown>) {
    requireContributor(identity);
    if (Object.keys(query).length) throw new BadRequestException();
    const rows = await this.db
      .client`SELECT id,request_key AS "requestKey",title,task_type AS "taskType",priority,status,notes,version,planned_on::text AS "plannedOn",due_at AS "dueAt",completed_at AS "completedAt",created_at AS "createdAt" FROM studio_os.personal_todos WHERE owner_id=${identity.id} AND deleted_at IS NULL ORDER BY created_at DESC,id`;
    return rows.map(row => ({ ...row,
      dueAt: row.dueAt === null ? null : new Date(row.dueAt).toISOString(),
      completedAt: row.completedAt === null ? null : new Date(row.completedAt).toISOString(),
    }));
  }
  async create(identity: Identity, value: unknown) {
    requireContributor(identity);
    const b = objectInput(value, [
        'requestKey',
        'title',
        'taskType',
        'priority',
        'status',
        'notes',
        'plannedOn',
        'dueAt',
      ]),
      requestKey = uuid(b.requestKey),
      row = fields(b);
    scheduleOrder(row.plannedOn ?? null, row.dueAt ?? null);
    const hash = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    return this.db.client.begin(async (tx) => {
      // Serializes a real replay before row lookup, without trusting an owner in the request.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identity.id + ':' + requestKey},0))`;
      const [old] =
        await tx`SELECT id,request_hash,deleted_at FROM studio_os.personal_todos WHERE owner_id=${identity.id} AND request_key=${requestKey}`;
      if (old) {
        if (old.request_hash !== hash || old.deleted_at)
          throw new ConflictException();
        return { id: old.id };
      }
      const [r] =
        await tx`INSERT INTO studio_os.personal_todos(owner_id,request_key,request_hash,title,task_type,priority,status,notes,planned_on,due_at,completed_at) VALUES(${identity.id},${requestKey},${hash},${row.title},${row.taskType},${row.priority},${row.status},${row.notes},${row.plannedOn ?? null},${row.dueAt ?? null},CASE WHEN ${row.status}='已完成' THEN now() ELSE NULL END) RETURNING id`;
      await tx`INSERT INTO studio_os.personal_todo_events(todo_id,actor_id,action,detail) VALUES(${r.id},${identity.id},'created',${JSON.stringify(row)}::jsonb)`;
      return r;
    });
  }
  async mutate(identity: Identity, id: string, value: unknown, remove = false) {
    requireContributor(identity);
    uuid(id);
    const b = objectInput(
      value,
      remove
        ? ['expectedVersion']
        : [
            'expectedVersion',
            'title',
            'taskType',
            'priority',
            'status',
            'notes',
            'plannedOn',
            'dueAt',
          ],
    );
    const expected = version(b.expectedVersion),
      next = remove ? null : fields(b);
    return this.db.client.begin(async (tx) => {
      const [old] =
        await tx`SELECT *,planned_on::text AS planned_date,due_at::text AS due_time FROM studio_os.personal_todos WHERE id=${id} AND owner_id=${identity.id} AND deleted_at IS NULL FOR UPDATE`;
      if (!old) throw new NotFoundException();
      if (old.version !== expected) throw new ConflictException();
      if (next) {
        const plannedOn = next.plannedOn === undefined ? old.planned_date : next.plannedOn;
        const dueAt = next.dueAt === undefined ? old.due_time : next.dueAt;
        scheduleOrder(plannedOn, dueAt);
        await tx`UPDATE studio_os.personal_todos SET title=${next.title},task_type=${next.taskType},priority=${next.priority},status=${next.status},notes=${next.notes},planned_on=${plannedOn},due_at=${dueAt},completed_at=CASE WHEN ${next.status}<>'已完成' THEN NULL WHEN status='已完成' THEN completed_at ELSE now() END,version=version+1,updated_at=now() WHERE id=${id}`;
        next.plannedOn = plannedOn;
        next.dueAt = dueAt;
      }
      else
        await tx`UPDATE studio_os.personal_todos SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=${id}`;
      await tx`INSERT INTO studio_os.personal_todo_events(todo_id,actor_id,action,detail) VALUES(${id},${identity.id},${remove ? 'deleted' : 'updated'},${JSON.stringify({ before: { title: old.title, taskType: old.task_type, priority: old.priority, status: old.status, notes: old.notes, plannedOn: old.planned_date, dueAt: old.due_time, completedAt: old.completed_at, version: old.version }, after: next })}::jsonb)`;
      return { id };
    });
  }
}
