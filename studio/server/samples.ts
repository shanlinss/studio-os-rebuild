import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import type { Identity } from './auth';
import type { StudioDatabase } from './database';
import { requireAdministrator, requireContributor } from './access';
import { objectInput, shortText, optionalLongText, longText, uuid, version } from './validation';
const MAX = 2147483647;
function quantity(value: unknown, zero = false) {
  if (!Number.isSafeInteger(value) || Number(value) < (zero ? 0 : 1) || Number(value) > MAX) throw new BadRequestException('数量须为有效整数件数');
  return Number(value);
}
function optionalId(value: unknown) { return value === undefined || value === null || value === '' ? null : uuid(value); }
function normalized(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key, ['created_at','updated_at'].includes(key) && typeof item === 'string' ? new Date(item).toISOString() : normalized(item)]));
  return value;
}
async function borrower(tx: TransactionSql, actor: string) {
  const [m] = await tx`SELECT id,display_name,active FROM studio_os.members WHERE login_account_id=${actor} FOR SHARE`;
  if (!m) throw new ConflictException('请先关联成员档案');
  if (!m.active) throw new ForbiddenException('成员已停用，请管理员核对');
  return m;
}
async function sample(tx: TransactionSql, id: string) {
  const [row] = await tx`SELECT * FROM studio_os.shooting_samples WHERE id=${id} FOR UPDATE`;
  if (!row) throw new NotFoundException(); return row;
}
async function event(tx: TransactionSql, who: Identity, sampleId: string, loanId: string | null, action: string, delta: number, before: unknown, after: unknown, note = '') {
  const [m] = await tx`SELECT display_name FROM studio_os.members WHERE login_account_id=${who.id}`;
  const [saved] = await tx`INSERT INTO studio_os.shooting_sample_events(sample_id,loan_id,actor_id,actor_name,action,quantity_delta,before_value,after_value,note) VALUES(${sampleId},${loanId},${who.id},${m?.display_name || who.username},${action},${delta},${before ? JSON.stringify(normalized(before)) : null}::jsonb,${JSON.stringify(normalized(after))}::jsonb,${note}) RETURNING id`;
  return String(saved.id);
}
// Shared transaction helpers: the original sample APIs and warehouse transfers
// call these on their existing transaction, never through a second HTTP request.
export async function registerSampleRecord(tx: TransactionSql, who: Identity, input: {name:string,productId:string|null,warehouseLocation:string,keeperMemberId:string|null,notes:string}) {
  requireAdministrator(who);
  const name=shortText(input.name,120),productId=optionalId(input.productId),location=shortText(input.warehouseLocation,150),keeper=optionalId(input.keeperMemberId),notes=optionalLongText(input.notes,2000);
  let productLabel:string|null=null;
  if(productId){const [p]=await tx`SELECT name FROM studio_os.products WHERE id=${productId} FOR SHARE`;if(!p)throw new NotFoundException();productLabel=p.name;}
  if(keeper&&!(await tx`SELECT id FROM studio_os.members WHERE id=${keeper} FOR SHARE`).length)throw new NotFoundException();
  const [row]=await tx`INSERT INTO studio_os.shooting_samples(name,product_id,product_label,warehouse_location,keeper_member_id,notes,created_by) VALUES(${name},${productId},${productLabel},${location},${keeper},${notes},${who.id}) RETURNING *`;
  await event(tx,who,row.id,null,'registered',0,null,row);
  return row;
}
export async function stockInSampleRecord(tx: TransactionSql, who: Identity, id:string, count:number, expected:number, note:string, origin?:{warehouseTransferId:string,warehouseItemId:string,warehouseMovementId:string}) {
  requireAdministrator(who);uuid(id);quantity(count);version(expected);
  const before=await sample(tx,id);
  if(before.version!==expected||(origin&&!before.active))throw new ConflictException('样品数量或状态已变化');
  const next=before.available_quantity+count;if(next>MAX)throw new ConflictException('数量超过整数容量');
  const [after]=await tx`UPDATE studio_os.shooting_samples SET available_quantity=${next},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
  const eventId=await event(tx,who,id,null,'stock-in',count,before,origin?{...after,origin}:after,note);
  return {before,after,eventId};
}
export class ShootingSamples {
  constructor(private readonly db: StudioDatabase) {}
  private async write(who: Identity, action: string, b: Record<string, unknown>, fn: (tx: TransactionSql) => Promise<{id: string}>) {
    requireContributor(who); const key = uuid(b.requestKey), canonical = Object.fromEntries(Object.keys(b).sort().map(k => [k,b[k]]));
    const hash = createHash('sha256').update(JSON.stringify({action,body:canonical})).digest('hex');
    return this.db.client.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'sample-key:'+who.id+':'+key},0))`;
      const [old] = await tx`SELECT action,request_hash,result FROM studio_os.shooting_sample_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
      if (old) { if (old.action !== action || old.request_hash !== hash) throw new ConflictException('请求键已用于其他内容'); return old.result; }
      const result = await fn(tx);
      await tx`INSERT INTO studio_os.shooting_sample_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;
      return result;
    });
  }
  async receipt(who: Identity, key: string) {
    requireContributor(who); uuid(key);
    const [r] = await this.db.client`SELECT action,result FROM studio_os.shooting_sample_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
    if (!r || (r.action.startsWith('admin:') && who.role !== 'admin')) throw new NotFoundException(); return r.result;
  }
  async state(who: Identity) {
    requireContributor(who);
    const [m] = await this.db.client`SELECT id,display_name AS "displayName",active FROM studio_os.members WHERE login_account_id=${who.id}`;
    const shooting = (who.role === 'admin' || m?.active) ? await this.db.client`SELECT id,title FROM studio_os.shooting_requests ORDER BY created_at DESC,id` : [];
    return { member: m ? {id:m.id,displayName:m.displayName} : null, canBorrow: !!m?.active, shooting };
  }
  private query(who: Identity, value: unknown, loans = false) {
    requireContributor(who); const b = objectInput(value, loans ? ['view','memberId','sampleId','status','offset'] : ['q','active','offset']);
    const offset = b.offset === undefined ? 0 : Number(b.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX) throw new BadRequestException();
    const team = b.view === 'team';
    if (b.view !== undefined && !['own','team'].includes(String(b.view))) throw new BadRequestException();
    if (team || b.active === 'all') requireAdministrator(who);
    if (!team && b.memberId !== undefined) throw new BadRequestException();
    const status = b.status === undefined ? 'all' : String(b.status);
    if (!['all','open','returned'].includes(status) || (b.active !== undefined && !['active','all'].includes(String(b.active)))) throw new BadRequestException();
    return {offset,team,memberId:optionalId(b.memberId),sampleId:optionalId(b.sampleId),status,q:b.q ? shortText(b.q,100) : '',all:b.active === 'all'};
  }
  async catalog(who: Identity, value: unknown) {
    const q = this.query(who,value);
    const where = this.db.client`(${q.all} OR s.active) AND strpos(lower(concat_ws(' ',s.name,p.name,s.product_label,s.warehouse_location)),lower(${q.q}))>0`;
    const projection = who.role === 'admin' ? this.db.client`s.*,coalesce(p.name,s.product_label) AS "productName",m.display_name AS "keeperName",(SELECT coalesce(sum(l.quantity-l.returned_quantity),0)::text FROM studio_os.shooting_sample_loans l WHERE l.sample_id=s.id) AS "outstandingQuantity"` : this.db.client`s.id,s.name,s.product_id,coalesce(p.name,s.product_label) AS "productName",s.warehouse_location,m.display_name AS "keeperName",s.available_quantity,s.version,s.active`;
    const rows = await this.db.client`SELECT ${projection} FROM studio_os.shooting_samples s LEFT JOIN studio_os.products p ON p.id=s.product_id LEFT JOIN studio_os.members m ON m.id=s.keeper_member_id WHERE ${where} ORDER BY s.created_at DESC,s.id LIMIT 50 OFFSET ${q.offset}`;
    const [n] = await this.db.client`SELECT count(*) FROM studio_os.shooting_samples s LEFT JOIN studio_os.products p ON p.id=s.product_id WHERE ${where}`;
    return {rows:rows.map(normalized),total:Number(n.count),offset:q.offset,limit:50};
  }
  async loans(who: Identity, value: unknown) {
    const q = this.query(who,value,true);
    const where = this.db.client`(${q.team} OR l.owner_id=${who.id}) AND (${q.memberId}::uuid IS NULL OR l.member_id=${q.memberId}) AND (${q.sampleId}::uuid IS NULL OR l.sample_id=${q.sampleId}) AND (${q.status}='all' OR (${q.status}='open' AND l.returned_quantity<l.quantity) OR (${q.status}='returned' AND l.returned_quantity=l.quantity))`;
    const rows = await this.db.client`SELECT l.*,s.name AS "sampleName",s.active AS "sampleActive",s.warehouse_location AS "warehouseLocation",m.display_name AS "borrowerName" FROM studio_os.shooting_sample_loans l JOIN studio_os.shooting_samples s ON s.id=l.sample_id JOIN studio_os.members m ON m.id=l.member_id WHERE ${where} ORDER BY l.created_at DESC,l.id LIMIT 50 OFFSET ${q.offset}`;
    const [n] = await this.db.client`SELECT count(*) FROM studio_os.shooting_sample_loans l WHERE ${where}`;
    return {rows:rows.map(normalized),total:Number(n.count),offset:q.offset,limit:50};
  }
  async history(who: Identity, id: string, value: unknown, loan = false) {
    requireContributor(who); uuid(id); const b = objectInput(value,['offset']); const offset = b.offset === undefined ? 0 : Number(b.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX) throw new BadRequestException();
    if (!loan) requireAdministrator(who);
    const rows = loan ? await this.db.client`SELECT id FROM studio_os.shooting_sample_loans WHERE id=${id} AND (${who.role === 'admin'} OR owner_id=${who.id})` : await this.db.client`SELECT id FROM studio_os.shooting_samples WHERE id=${id}`;
    if (!rows.length) throw new NotFoundException();
    const where = loan ? this.db.client`loan_id=${id}` : this.db.client`sample_id=${id}`;
    const events = await this.db.client`SELECT id,actor_id,actor_name,action,quantity_delta,before_value,after_value,note,created_at FROM studio_os.shooting_sample_events WHERE ${where} ORDER BY created_at,id LIMIT 50 OFFSET ${offset}`;
    const [n] = await this.db.client`SELECT count(*) FROM studio_os.shooting_sample_events WHERE ${where}`;
    const visible = who.role === 'admin' ? events : events.map(e => ({...e, before_value: e.before_value ? {loan:e.before_value.loan} : null, after_value:{loan:e.after_value.loan}}));
    return {rows:visible.map(normalized),total:Number(n.count),offset,limit:50};
  }
  async save(who: Identity, value: unknown, id?: string) {
    requireAdministrator(who); if (id) uuid(id);
    const b = objectInput(value,['requestKey','name','productId','warehouseLocation','keeperMemberId','notes',...(id ? ['expectedVersion','active'] : [])]);
    const name = shortText(b.name,120), location = shortText(b.warehouseLocation,150), productId = optionalId(b.productId), keeper = optionalId(b.keeperMemberId), notes = optionalLongText(b.notes,2000);
    const expected = id ? version(b.expectedVersion) : 0;
    if (b.active !== undefined && typeof b.active !== 'boolean') throw new BadRequestException();
    return this.write(who,'admin:save:'+(id || 'new'),b,async tx => {
      if(!id){const created=await registerSampleRecord(tx,who,{name,productId,warehouseLocation:location,keeperMemberId:keeper,notes});return {id:created.id};}
      const old = id ? await sample(tx,id) : null;
      if (old && old.version !== expected) throw new ConflictException('样品资料已变化，请重新核对');
      let productLabel: string | null = null;
      if (productId) { const [p] = await tx`SELECT name FROM studio_os.products WHERE id=${productId} FOR SHARE`; if (!p) throw new NotFoundException(); productLabel=p.name; }
      if (keeper && !(await tx`SELECT id FROM studio_os.members WHERE id=${keeper} FOR SHARE`).length) throw new NotFoundException();
      const [row] = await tx`UPDATE studio_os.shooting_samples SET name=${name},product_id=${productId},product_label=${productLabel},warehouse_location=${location},keeper_member_id=${keeper},notes=${notes},active=${b.active === undefined ? old!.active : b.active},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
      await event(tx,who,row.id,null,id?'edited':'registered',0,old,row);return {id:row.id};
    });
  }
  async stock(who: Identity, id: string, value: unknown, count = false) {
    requireAdministrator(who); uuid(id);
    const b = objectInput(value,['requestKey','quantity','note','expectedVersion']); const qty=quantity(b.quantity,count), expected=version(b.expectedVersion), note=count ? longText(b.note,2000) : optionalLongText(b.note,2000);
    return this.write(who,'admin:'+(count?'stocktake:':'stock-in:')+id,b,async tx => {
      if(!count){await stockInSampleRecord(tx,who,id,qty,expected,note);return {id};}
      const old=await sample(tx,id);if(old.version!==expected)throw new ConflictException('数量已变化，请核对后再操作');
      const next=count?qty:old.available_quantity+qty;if(next>MAX)throw new ConflictException('数量超过整数容量');
      const [row]=await tx`UPDATE studio_os.shooting_samples SET available_quantity=${next},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
      await event(tx,who,id,null,count?'stocktake':'stock-in',next-old.available_quantity,old,row,note);return {id};
    });
  }
  async borrow(who: Identity, id: string, value: unknown) {
    uuid(id);const b=objectInput(value,['requestKey','quantity','location','shootingRequestId','note']),qty=quantity(b.quantity),location=shortText(b.location,150),shootingId=optionalId(b.shootingRequestId),note=optionalLongText(b.note,2000);
    return this.write(who,'borrow:'+id,b,async tx => {
      const m=await borrower(tx,who.id),old=await sample(tx,id);
      if(!old.active || old.available_quantity<qty)throw new ConflictException('样品暂停领用或当前可领数量不足');
      let shootingTitle: string | null=null;
      if(shootingId){const [s]=await tx`SELECT title FROM studio_os.shooting_requests WHERE id=${shootingId} FOR SHARE`;if(!s)throw new NotFoundException();shootingTitle=s.title;}
      const [loan]=await tx`INSERT INTO studio_os.shooting_sample_loans(sample_id,owner_id,member_id,quantity,location,shooting_request_id,shooting_title,note) VALUES(${id},${who.id},${m.id},${qty},${location},${shootingId},${shootingTitle},${note}) RETURNING *`;
      const [after]=await tx`UPDATE studio_os.shooting_samples SET available_quantity=available_quantity-${qty},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
      await event(tx,who,id,loan.id,'borrowed',-qty,{sample:old},{sample:after,loan},note);return {id:loan.id};
    });
  }
  async ownLoan(who: Identity, id: string, value: unknown, relocate = false) {
    uuid(id);const b=objectInput(value,relocate?['requestKey','expectedVersion','location','note']:['requestKey','expectedVersion','quantity','note']);const expected=version(b.expectedVersion),qty=relocate?0:quantity(b.quantity),location=relocate?shortText(b.location,150):null,note=optionalLongText(b.note,2000);
    return this.write(who,(relocate?'relocate:':'return:')+id,b,async tx => {
      await borrower(tx,who.id);
      const [lookup]=await tx`SELECT sample_id FROM studio_os.shooting_sample_loans WHERE id=${id} AND owner_id=${who.id}`;if(!lookup)throw new NotFoundException();
      const oldSample=await sample(tx,lookup.sample_id);
      const [old]=await tx`SELECT * FROM studio_os.shooting_sample_loans WHERE id=${id} AND owner_id=${who.id} FOR UPDATE`;
      if(old.version!==expected || old.returned_quantity===old.quantity)throw new ConflictException('领用记录已变化或已全部归还');
      if(!relocate && (qty>old.quantity-old.returned_quantity || oldSample.available_quantity+qty>MAX))throw new ConflictException('不能超出未归还数量/整数容量');
      const [loan]=relocate?await tx`UPDATE studio_os.shooting_sample_loans SET location=${location!},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`:await tx`UPDATE studio_os.shooting_sample_loans SET returned_quantity=returned_quantity+${qty},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
      const [afterSample]=relocate?[oldSample]:await tx`UPDATE studio_os.shooting_samples SET available_quantity=available_quantity+${qty},version=version+1,updated_at=now() WHERE id=${old.sample_id} RETURNING *`;
      await event(tx,who,old.sample_id,id,relocate?'relocated':'returned',qty,{sample:oldSample,loan:old},{sample:afterSample,loan},note);return {id};
    });
  }
}
