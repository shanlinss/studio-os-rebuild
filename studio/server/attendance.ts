import {livePermission,currentPermission,freshIdentity,hasPermission} from './permissions';
import {publicValue,lockOwner,audit} from './attendance-support';
import { BadRequestException, ConflictException, NotFoundException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import type { Identity } from './auth';
import type { StudioDatabase } from './database';
import { requireAdministrator, requireContributor } from './access';
import { objectInput, longText, optionalLongText, uuid, version } from './validation';

function calendar(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new BadRequestException('日期格式无效');
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new BadRequestException('日期无效');
  return value;
}
function proposedTime(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new BadRequestException('补卡时间须包含时区');
  calendar(value.slice(0, 10));
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new BadRequestException('补卡时间无效');
  return d.toISOString();
}
function expectedTime(value: unknown) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new BadRequestException('预计时间格式无效');
  return value;
}
function direction(value: unknown) {
  if (value !== 'in' && value !== 'out') throw new BadRequestException();
  return value;
}
async function member(tx: TransactionSql, actor: string) {
  const [m] = await tx`SELECT id,display_name,active FROM studio_os.members WHERE login_account_id=${actor}`;
  if (!m) throw new ConflictException('请先联系管理员关联成员档案');
  if(!m.active)throw new ForbiddenException('成员已停用');
  return m;
}
async function activeStudio(tx: TransactionSql, owner: string) {
  return tx`SELECT id FROM studio_os.attendance_periods WHERE owner_id=${owner} AND kind='studio' AND coalesce(adjusted_in,original_in) IS NOT NULL AND coalesce(adjusted_out,original_out) IS NULL`;
}

async function validateCorrectionTime(tx:TransactionSql,p:any,dir:string,proposed:any){
 if(p.kind==='field'&&p.approval_status!=='approved')throw new ConflictException('外勤须先获批准');
 if(p.kind==='studio'){const [day]=await tx`SELECT (${proposed}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date=${p.work_date}::date AS valid`;if(!day.valid)throw new BadRequestException('补正时间须属于原工作日');}
 const start=dir==='in'?proposed:p.adjusted_in||p.original_in,end=dir==='out'?proposed:p.adjusted_out||p.original_out;
 if(end&&(!start||new Date(end).getTime()<new Date(start).getTime()))throw new BadRequestException('开始结束顺序不成立');
}

export class Attendance {
  constructor(private readonly db: StudioDatabase) {}
  private async write(identity: Identity, action: string, b: Record<string, unknown>, work: (tx: TransactionSql) => Promise<{ id: string }>) {
    requireContributor(identity);
    const decision=action.startsWith('decision:');
    if(decision?identity.role!=='admin':identity.role!=='employee')throw new ForbiddenException();
    const key = uuid(b.requestKey), canonical = Object.fromEntries(Object.keys(b).sort().map(k => [k, b[k]]));
    const hash = createHash('sha256').update(JSON.stringify({ action, body: canonical })).digest('hex');
    return this.db.client.begin(async tx => {
      const [actor]=await tx`SELECT active,role FROM studio_os.accounts WHERE id=${identity.id} FOR SHARE`;if(!actor?.active)throw new UnauthorizedException();if(decision?actor.role!=='admin':actor.role!=='employee')throw new ForbiddenException();if(decision)await livePermission(tx,identity.id,'personnel');
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'attendance-key:' + identity.id + ':' + key},0))`;
      const [old] = await tx`SELECT action,request_hash,result FROM studio_os.attendance_receipts WHERE actor_id=${identity.id} AND request_key=${key}`;
      if (old) {
        if (old.action !== action || old.request_hash !== hash) throw new ConflictException('请求键已用于不同操作');
        return old.result;
      }
      const result = await work(tx);
      await tx`INSERT INTO studio_os.attendance_receipts(actor_id,request_key,action,request_hash,result) VALUES(${identity.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;
      return result;
    });
  }
  async receipt(identity: Identity, key: string) {
    identity=await freshIdentity(this.db,identity);
    requireContributor(identity); uuid(key);
    const [row] = await this.db.client`SELECT action,result FROM studio_os.attendance_receipts WHERE actor_id=${identity.id} AND request_key=${key}`;
    if (!row || (row.action.startsWith('decision:') && !hasPermission(identity,'personnel'))) throw new NotFoundException();
    return row.result;
  }
  async state(identity: Identity) {
    requireContributor(identity);
    const [m] = await this.db.client`SELECT id,display_name AS "displayName" FROM studio_os.members WHERE login_account_id=${identity.id}`;
    const [open] = await this.db.client`SELECT *,work_date::text AS work_date FROM studio_os.attendance_periods WHERE owner_id=${identity.id} AND kind='studio' AND coalesce(adjusted_in,original_in) IS NOT NULL AND coalesce(adjusted_out,original_out) IS NULL ORDER BY created_at DESC,id LIMIT 1`;
    const [todayStudio] = await this.db.client`SELECT *,work_date::text AS work_date FROM studio_os.attendance_periods WHERE owner_id=${identity.id} AND kind='studio' AND work_date=(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date ORDER BY created_at DESC,id LIMIT 1`;
    const [clock] = await this.db.client`SELECT clock_timestamp() AS "serverNow"`;
    const tasks = m ? await this.db.client`SELECT t.id,p.title FROM studio_os.tasks t JOIN studio_os.plans p ON p.id=t.plan_id WHERE t.member_id=${m.id} AND EXISTS(SELECT 1 FROM studio_os.members own WHERE own.id=t.member_id AND own.active) ORDER BY p.created_at DESC,t.id` : [];
    return { member: m ?? null, studio: open ? publicValue(open) : null, tasks, todayStudio: todayStudio ? publicValue(todayStudio) : null, serverNow: new Date(clock.serverNow).toISOString() };
  }
  private filters(identity: Identity, query: Record<string, unknown>, corrections = false) {
    requireContributor(identity);
    const q = objectInput(query, ['view','memberId','from','to','offset',...(corrections ? ['periodId','status'] : [])]);
    if (q.view !== undefined && !['own','team'].includes(String(q.view))) throw new BadRequestException();
    const team = q.view === 'team';
    if(team&&!hasPermission(identity,'personnel'))throw new ForbiddenException();
    if (!team && q.memberId !== undefined) throw new BadRequestException();
    const memberId = q.memberId ? uuid(q.memberId) : null, from = q.from ? calendar(q.from) : null, to = q.to ? calendar(q.to) : null;
    if (from && to && from > to) throw new BadRequestException();
    const offset = q.offset === undefined ? 0 : Number(q.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) throw new BadRequestException();
    const status=q.status===undefined?'all':String(q.status);if(!['all','pending','approved','rejected'].includes(status))throw new BadRequestException();
    return { team, memberId, from, to, offset,status, periodId: q.periodId ? uuid(q.periodId) : null };
  }
  async list(identity: Identity, query: Record<string, unknown>, corrections = false) {
    identity=await freshIdentity(this.db,identity);
    const { team, memberId, from, to, offset, periodId,status } = this.filters(identity, query, corrections);
    return this.db.client.begin(async tx=>{
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    if (corrections) {
      const where = tx`(${team} OR c.owner_id=${identity.id}) AND (${memberId}::uuid IS NULL OR c.member_id=${memberId}) AND (${from}::date IS NULL OR (c.proposed_at AT TIME ZONE 'Asia/Shanghai')::date>=${from}) AND (${to}::date IS NULL OR (c.proposed_at AT TIME ZONE 'Asia/Shanghai')::date<=${to}) AND (${periodId}::uuid IS NULL OR c.period_id=${periodId}) AND (${status}='all' OR c.status=${status})`;
      const rows = await tx`SELECT c.*,m.display_name AS "memberName" FROM studio_os.attendance_corrections c JOIN studio_os.members m ON m.id=c.member_id WHERE ${where} ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET ${offset}`;
      const [count] = await tx`SELECT count(*) FROM studio_os.attendance_corrections c WHERE ${where}`;
      return { rows: rows.map(publicValue), total: Number(count.count), offset, limit: 50 };
    }
    const where = tx`(${team} OR p.owner_id=${identity.id}) AND (${memberId}::uuid IS NULL OR p.member_id=${memberId}) AND (${from}::date IS NULL OR p.work_date>=${from}) AND (${to}::date IS NULL OR p.work_date<=${to})`;
    const rows = await tx`SELECT p.*,p.work_date::text AS work_date,m.display_name AS "memberName" FROM studio_os.attendance_periods p JOIN studio_os.members m ON m.id=p.member_id WHERE ${where} ORDER BY p.work_date DESC,p.created_at DESC,p.id LIMIT 50 OFFSET ${offset}`;
    const [count] = await tx`SELECT count(*) FROM studio_os.attendance_periods p WHERE ${where}`;
    return { rows: rows.map(publicValue), total: Number(count.count), offset, limit: 50 };
    });
  }
  async detail(identity:Identity,id:string,query:unknown,correction=false){
    identity=await freshIdentity(this.db,identity);
    requireContributor(identity);uuid(id);objectInput(query,[]);
    return this.db.client.begin(async tx=>{
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      const [row]=correction?await tx`SELECT c.*,m.display_name AS "memberName" FROM studio_os.attendance_corrections c JOIN studio_os.members m ON m.id=c.member_id WHERE c.id=${id} AND (${hasPermission(identity,'personnel')} OR c.owner_id=${identity.id})`:await tx`SELECT p.*,p.work_date::text AS work_date,m.display_name AS "memberName" FROM studio_os.attendance_periods p JOIN studio_os.members m ON m.id=p.member_id WHERE p.id=${id} AND (${hasPermission(identity,'personnel')} OR p.owner_id=${identity.id})`;
      if(!row)throw new NotFoundException();
      const [period]=correction&&row.period_id?await tx`SELECT *,work_date::text AS work_date FROM studio_os.attendance_periods WHERE id=${row.period_id} AND owner_id=${row.owner_id}`:[];
      let approvalBlocker:string|null=null;
      if(correction&&row.status==='pending'){
        if(period&&period.version!==row.period_version)approvalBlocker='source-changed';
        if(!row.period_id){if((await tx`SELECT id FROM studio_os.attendance_periods WHERE owner_id=${row.owner_id} AND kind='studio' AND work_date=(${row.proposed_at}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date`).length)approvalBlocker='day-already-exists';else if((await activeStudio(tx,row.owner_id)).length)approvalBlocker='other-open-period';}
      }
      const [clock]=await tx`SELECT clock_timestamp() AS now`;
      return {record:publicValue(row),period:correction?(period?publicValue(period):null):publicValue(row),serverNow:new Date(clock.now).toISOString(),approvalBlocker};
    });
  }
  async history(identity: Identity, id: string, query: Record<string, unknown>, correction = false) {
    identity=await freshIdentity(this.db,identity);
    requireContributor(identity); uuid(id); objectInput(query, ['offset']);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) throw new BadRequestException();
    return this.db.client.begin(async tx=>{
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const [p] = correction ? await tx`SELECT id FROM studio_os.attendance_corrections WHERE id=${id} AND (${hasPermission(identity,'personnel')} OR owner_id=${identity.id})` : await tx`SELECT id FROM studio_os.attendance_periods WHERE id=${id} AND (${hasPermission(identity,'personnel')} OR owner_id=${identity.id})`;
    if (!p) throw new NotFoundException();
    const where = correction ? tx`correction_id=${id}` : tx`(period_id=${id} OR correction_id IN (SELECT id FROM studio_os.attendance_corrections WHERE period_id=${id}))`;
    const rows = await tx`SELECT id,actor_id,actor_name,action,before_value,after_value,created_at FROM studio_os.attendance_events WHERE ${where} ORDER BY created_at,id LIMIT 50 OFFSET ${offset}`;
    const [count] = await tx`SELECT count(*) FROM studio_os.attendance_events WHERE ${where}`;
    return { rows: rows.map(publicValue), total: Number(count.count), offset, limit: 50 };
    });
  }
  async studioIn(identity: Identity, value: unknown) {
    const b=objectInput(value,['requestKey']);
    return this.write(identity,'studio:in',b,async tx=>{await lockOwner(tx,identity.id);throw new ConflictException('上班记录由成功登录生成，请重新登录');});
  }
  async field(identity: Identity, value: unknown) {
    const b = objectInput(value, ['requestKey','date','expectedFrom','expectedTo','reason','taskId']);
    const date = calendar(b.date), from = expectedTime(b.expectedFrom), to = expectedTime(b.expectedTo), reason = longText(b.reason, 2000), taskId = b.taskId === undefined || b.taskId === null || b.taskId === '' ? null : uuid(b.taskId);
    return this.write(identity, 'field:request', b, async tx => {
      await lockOwner(tx, identity.id); const m = await member(tx, identity.id);
      if (taskId && !(await tx`SELECT t.id FROM studio_os.tasks t JOIN studio_os.members own ON own.id=t.member_id AND own.active WHERE t.id=${taskId} AND t.member_id=${m.id}`).length) throw new NotFoundException();
      const [row] = await tx`INSERT INTO studio_os.attendance_periods(owner_id,member_id,kind,work_date,approval_status,expected_from,expected_to,reason,task_id) VALUES(${identity.id},${m.id},'field',${date},'pending',${from},${to},${reason},${taskId}) RETURNING *`;
      await audit(tx, identity, identity.id, row.id, null, 'field-requested', null, row); return { id: row.id };
    });
  }
  async clock(identity: Identity, id: string, which: string, value: unknown) {
    uuid(id); const dir = direction(which), b = objectInput(value, ['requestKey']);
    return this.write(identity, 'clock:' + id + ':' + dir, b, async tx => {
      await lockOwner(tx, identity.id);
      const [p] = await tx`SELECT * FROM studio_os.attendance_periods WHERE id=${id} AND owner_id=${identity.id} FOR UPDATE`;
      if (!p) throw new NotFoundException();
      if(p.kind==='studio'&&dir==='out')throw new ConflictException('请使用结束工作并退出');
      if (p.kind === 'field' && p.approval_status !== 'approved') throw new ConflictException('外勤未获批准，不能签到签退');
      const effectiveIn = p.adjusted_in || p.original_in, effectiveOut = p.adjusted_out || p.original_out;
      if (dir === 'in' && (p.kind !== 'field' || effectiveIn || effectiveOut)) throw new ConflictException('签到状态已变化，请核对');
      if (dir === 'out' && (!effectiveIn || effectiveOut)) throw new ConflictException('需先有签到/上班记录且尚未签退');
      if (dir === 'out' && new Date(effectiveIn).getTime() > Date.now()) throw new ConflictException('开始时间晚于服务器当前时间，请核对');
      const [after] = dir === 'in' ? await tx`UPDATE studio_os.attendance_periods SET original_in=clock_timestamp(),version=version+1,updated_at=now() WHERE id=${id} RETURNING *` : await tx`UPDATE studio_os.attendance_periods SET original_out=clock_timestamp(),version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
      await audit(tx, identity, identity.id, id, null, p.kind + '-' + dir, p, after); return { id };
    });
  }
  async decideField(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity); uuid(id);
    const b = objectInput(value, ['requestKey','expectedVersion','decision','note']), expected = version(b.expectedVersion), note = optionalLongText(b.note, 2000);
    if (!['approved','rejected'].includes(String(b.decision))) throw new BadRequestException();
    return this.write(identity, 'decision:field:' + id, b, async tx => {
      const [lookup] = await tx`SELECT owner_id FROM studio_os.attendance_periods WHERE id=${id}`; if (!lookup) throw new NotFoundException();
      await lockOwner(tx, lookup.owner_id);
      const [p] = await tx`SELECT * FROM studio_os.attendance_periods WHERE id=${id} FOR UPDATE`;
      if (p.kind !== 'field' || p.approval_status !== 'pending' || p.version !== expected) throw new ConflictException('申请已变化，请核对');
      const [after] = await tx`UPDATE studio_os.attendance_periods SET approval_status=${String(b.decision)},reviewed_by=${identity.id},reviewed_at=clock_timestamp(),review_note=${note},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
      await audit(tx, identity, p.owner_id, id, null, 'field-' + String(b.decision), p, after); return { id };
    });
  }
  async correction(identity: Identity, value: unknown, editId?: string) {
    if (editId) uuid(editId);
    const b = objectInput(value, editId ? ['requestKey','expectedVersion','proposedAt','reason'] : ['requestKey','periodId','direction','proposedAt','reason']);
    const proposed = proposedTime(b.proposedAt), reason = longText(b.reason, 2000), expected = editId ? version(b.expectedVersion) : 0;
    const periodId = !editId && b.periodId !== undefined && b.periodId !== null && b.periodId !== '' ? uuid(b.periodId) : null, dir = !editId ? direction(b.direction) : null;
    if (!editId && !periodId && dir !== 'in') throw new BadRequestException('无工作段时须先申请补工作室上班');
    return this.write(identity, 'correction:' + (editId || 'new'), b, async tx => {
      await lockOwner(tx, identity.id); const m = await member(tx, identity.id);
      const [clock] = await tx`SELECT ${proposed}::timestamptz<=clock_timestamp() AS valid`;
      if (!clock.valid) throw new BadRequestException('补卡不能申请尚未发生的时间');
      if (editId) {
        const [old] = await tx`SELECT * FROM studio_os.attendance_corrections WHERE id=${editId} AND owner_id=${identity.id} FOR UPDATE`;
        if (!old) throw new NotFoundException();
        if (old.status !== 'pending' || old.version !== expected) throw new ConflictException('申请已变化，请核对');
        let currentVersion=old.period_version;
        if(old.period_id){const [p]=await tx`SELECT * FROM studio_os.attendance_periods WHERE id=${old.period_id} AND owner_id=${identity.id} FOR UPDATE`;if(!p)throw new NotFoundException();await validateCorrectionTime(tx,p,old.direction,proposed);currentVersion=p.version;}
        else if((await tx`SELECT id FROM studio_os.attendance_periods WHERE owner_id=${identity.id} AND kind='studio' AND work_date=(${proposed}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date`).length)throw new ConflictException('该日已有记录，请从原记录申请');
        const [after] = await tx`UPDATE studio_os.attendance_corrections SET proposed_at=${proposed},reason=${reason},period_version=${currentVersion},version=version+1,updated_at=now() WHERE id=${editId} RETURNING *`;
        await audit(tx, identity, identity.id, old.period_id, editId, 'correction-edited', old, after); return { id: editId };
      }
      let periodVersion: number | null = null;
      if (periodId) {
        const [p] = await tx`SELECT * FROM studio_os.attendance_periods WHERE id=${periodId} AND owner_id=${identity.id} FOR UPDATE`;
        if (!p) throw new NotFoundException();
        if (p.kind === 'field' && p.approval_status !== 'approved') throw new ConflictException('外勤须先获批准');
        await validateCorrectionTime(tx,p,dir!,proposed);
        periodVersion = p.version;
      }
      if(!periodId&&(await tx`SELECT id FROM studio_os.attendance_periods WHERE owner_id=${identity.id} AND kind='studio' AND work_date=(${proposed}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date`).length)throw new ConflictException('该日已有记录，请从原记录申请');
      if((await tx`SELECT id FROM studio_os.attendance_corrections WHERE owner_id=${identity.id} AND status='pending' AND direction=${dir!} AND ((period_id=${periodId}) OR (period_id IS NULL AND ${periodId}::uuid IS NULL AND (proposed_at AT TIME ZONE 'Asia/Shanghai')::date=(${proposed}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date))`).length)throw new ConflictException('已有同方向待审核申请');
      const [row] = await tx`INSERT INTO studio_os.attendance_corrections(owner_id,member_id,period_id,direction,proposed_at,reason,period_version) VALUES(${identity.id},${m.id},${periodId},${dir!},${proposed},${reason},${periodVersion}) RETURNING *`;
      await audit(tx, identity, identity.id, periodId, row.id, 'correction-requested', null, row); return { id: row.id };
    });
  }
  async decideCorrection(identity: Identity, id: string, value: unknown) {
    requireAdministrator(identity); uuid(id);
    const b = objectInput(value, ['requestKey','expectedVersion','decision','note']), expected = version(b.expectedVersion), note = optionalLongText(b.note, 2000);
    if (typeof b.decision!=='string'||!['approved','rejected'].includes(b.decision)||(b.decision==='rejected'&&!note.trim())) throw new BadRequestException();
    return this.write(identity, 'decision:correction:' + id, b, async tx => {
      const [lookup] = await tx`SELECT owner_id FROM studio_os.attendance_corrections WHERE id=${id}`; if (!lookup) throw new NotFoundException();
      await lockOwner(tx, lookup.owner_id);
      const [c] = await tx`SELECT * FROM studio_os.attendance_corrections WHERE id=${id} FOR UPDATE`;
      if (c.status !== 'pending' || c.version !== expected) throw new ConflictException('申请已变化，请核对');
      let periodId = c.period_id;
      if (b.decision === 'approved') {
        const [clock] = await tx`SELECT ${c.proposed_at}::timestamptz<=clock_timestamp() AS valid`; if (!clock.valid) throw new ConflictException('补卡时间尚未发生');
        if (!periodId) {
          if((await tx`SELECT id FROM studio_os.attendance_periods WHERE owner_id=${c.owner_id} AND kind='studio' AND work_date=(${c.proposed_at}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date`).length)throw new ConflictException('该日已有上班记录，请引用原记录申请补正');
          if ((await activeStudio(tx, c.owner_id)).length) throw new ConflictException('有未结束工作室记录，请先核对');
          const [created] = await tx`INSERT INTO studio_os.attendance_periods(owner_id,member_id,kind,work_date,approval_status,adjusted_in) VALUES(${c.owner_id},${c.member_id},'studio',(${c.proposed_at}::timestamptz AT TIME ZONE 'Asia/Shanghai')::date,'not-required',${c.proposed_at}) RETURNING *`;
          periodId = created.id; await audit(tx, identity, c.owner_id, periodId, id, 'missing-studio-in-confirmed', null, created);
        } else {
          const [p] = await tx`SELECT * FROM studio_os.attendance_periods WHERE id=${periodId} AND owner_id=${c.owner_id} FOR UPDATE`;
          if (!p || p.version !== c.period_version || (p.kind === 'field' && p.approval_status !== 'approved')) throw new ConflictException('原记录已变化，请重新核对申请');
          await validateCorrectionTime(tx,p,c.direction,c.proposed_at);
          const nextIn = c.direction === 'in' ? c.proposed_at : p.adjusted_in || p.original_in, nextOut = c.direction === 'out' ? c.proposed_at : p.adjusted_out || p.original_out;
          if (nextOut && (!nextIn || new Date(nextOut).getTime() < new Date(nextIn).getTime())) throw new ConflictException('补卡开始/结束顺序不成立');
          const [after] = c.direction === 'in' ? await tx`UPDATE studio_os.attendance_periods SET adjusted_in=${c.proposed_at},version=version+1,updated_at=now() WHERE id=${periodId} RETURNING *` : await tx`UPDATE studio_os.attendance_periods SET adjusted_out=${c.proposed_at},version=version+1,updated_at=now() WHERE id=${periodId} RETURNING *`;
          await audit(tx, identity, c.owner_id, periodId, id, 'correction-applied', p, after);
        }
      }
      const [after] = await tx`UPDATE studio_os.attendance_corrections SET period_id=${periodId},status=${String(b.decision)},reviewed_by=${identity.id},reviewed_at=clock_timestamp(),review_note=${note},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
      await audit(tx, identity, c.owner_id, periodId, id, 'correction-' + String(b.decision), c, after); return { id };
    });
  }
}
