import {livePermission,currentPermission,freshIdentity,hasPermission} from './permissions';
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import type {TransactionSql} from 'postgres';
import {requireContributor} from './access';
import {objectInput,uuid,version,shortText,longText} from './validation';
import {publicValue} from './attendance-support';
const statuses=['pending','approved','rejected','withdrawn','revoked'];
function calendar(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v)||v.startsWith('0000')||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new BadRequestException();return v;}
function time(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw new BadRequestException();calendar(v.slice(0,10));return new Date(v).toISOString();}
async function overlap(tx:TransactionSql,owner:string,start:string,end:string,id:string|null){if((await tx`SELECT id FROM studio_os.leave_requests WHERE owner_id=${owner} AND status IN('pending','approved') AND (${id}::uuid IS NULL OR id<>${id}) AND starts_at<${end}::timestamptz AND ends_at>${start}::timestamptz LIMIT 1`).length)throw new ConflictException('存在重叠的待审核或已批准请假');}
async function event(tx:TransactionSql,who:Identity,id:string,action:string,before:unknown,after:unknown){const [m]=await tx`SELECT display_name FROM studio_os.members WHERE login_account_id=${who.id}`;await tx`INSERT INTO studio_os.leave_events(leave_id,actor_id,actor_name,action,before_value,after_value) VALUES(${id},${who.id},${m?.display_name||who.username},${action},${before?JSON.stringify(publicValue(before)):null}::jsonb,${JSON.stringify(publicValue(after))}::jsonb)`;}
export class LeaveRequests {
 constructor(private readonly db:StudioDatabase){}
 private async write(who:Identity,action:string,b:Record<string,unknown>,admin:boolean,fn:(tx:TransactionSql)=>Promise<{id:string}>){
  requireContributor(who);if(who.role!==(admin?'admin':'employee'))throw new ForbiddenException();const key=uuid(b.requestKey),canonical=Object.fromEntries(Object.keys(b).sort().map(k=>[k,b[k]])),hash=createHash('sha256').update(JSON.stringify({action,body:canonical})).digest('hex');
  return this.db.client.begin(async tx=>{
   const [actor]=await tx`SELECT role,active FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`;if(!actor?.active)throw new UnauthorizedException();if(actor.role!==(admin?'admin':'employee'))throw new ForbiddenException();if(admin)await livePermission(tx,who.id,'personnel');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'leave-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT action,request_hash,result FROM studio_os.leave_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(old){if(old.action!==action||old.request_hash!==hash)throw new ConflictException();return old.result;}
   const result=await fn(tx);await tx`INSERT INTO studio_os.leave_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},${action},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });
 }
 private async ownMember(tx:TransactionSql,who:Identity){const [m]=await tx`SELECT id,active FROM studio_os.members WHERE login_account_id=${who.id} FOR SHARE`;if(!m?.active)throw new ConflictException('需关联有效成员');return m;}
 async receipt(who:Identity,key:string){who=await freshIdentity(this.db,who);requireContributor(who);uuid(key);const [r]=await this.db.client`SELECT result,action FROM studio_os.leave_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(!r||((r.action.startsWith('decision:')||r.action.startsWith('revoke:'))&&!hasPermission(who,'personnel')))throw new NotFoundException();return r.result;}
 async save(who:Identity,value:unknown,id?:string){
  if(id)uuid(id);const keys=['requestKey','leaveType','startsAt','endsAt','reason',...(id?['expectedVersion']:[])],b=objectInput(value,keys);if(keys.some(k=>!Object.hasOwn(b,k)))throw new BadRequestException();const type=shortText(b.leaveType,40),start=time(b.startsAt),end=time(b.endsAt),reason=longText(b.reason,2000),expected=id?version(b.expectedVersion):0;if(Date.parse(end)<=Date.parse(start))throw new BadRequestException('结束须晚于开始');
  return this.write(who,id?'edit:'+id:'create',b,false,async tx=>{
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'leave-owner:'+who.id},0))`;const member=await this.ownMember(tx,who);
   const [before]=id?await tx`SELECT * FROM studio_os.leave_requests WHERE id=${id} AND owner_id=${who.id} FOR UPDATE`:[];if(id&&!before)throw new NotFoundException();if(before&&(before.status!=='pending'||before.version!==expected||before.member_id!==member.id))throw new ConflictException();
   await overlap(tx,who.id,start,end,id||null);
   const [after]=id?await tx`UPDATE studio_os.leave_requests SET leave_type=${type},starts_at=${start},ends_at=${end},reason=${reason},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`:await tx`INSERT INTO studio_os.leave_requests(owner_id,member_id,leave_type,starts_at,ends_at,reason) VALUES(${who.id},${member.id},${type},${start},${end},${reason}) RETURNING *`;
   await event(tx,who,after.id,id?'edited':'submitted',before,after);return {id:String(after.id)};
  });
 }
 async act(who:Identity,id:string,action:string,value:unknown){
  uuid(id);if(!['decision','withdraw','revoke'].includes(action))throw new BadRequestException();const b=objectInput(value,['requestKey','expectedVersion','note',...(action==='decision'?['decision']:[])]),expected=version(b.expectedVersion),note=longText(b.note,2000);if(action==='decision'&&(typeof b.decision!=='string'||!['approved','rejected'].includes(b.decision)))throw new BadRequestException();
  return this.write(who,action+':'+id,b,action!=='withdraw',async tx=>{
   const [lookup]=await tx`SELECT owner_id FROM studio_os.leave_requests WHERE id=${id} AND (${action!=='withdraw'} OR owner_id=${who.id})`;if(!lookup)throw new NotFoundException();
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'leave-owner:'+lookup.owner_id},0))`;
   const [before]=await tx`SELECT * FROM studio_os.leave_requests WHERE id=${id} FOR UPDATE`;if(before.version!==expected||(action==='revoke'?before.status!=='approved':before.status!=='pending'))throw new ConflictException();
   if(action==='withdraw'){const m=await this.ownMember(tx,who);if(m.id!==before.member_id)throw new ConflictException();}
   if(action==='decision'&&b.decision==='approved')await overlap(tx,before.owner_id,new Date(before.starts_at).toISOString(),new Date(before.ends_at).toISOString(),id);
   const [after]=action==='decision'?await tx`UPDATE studio_os.leave_requests SET status=${String(b.decision)},reviewed_by=${who.id},reviewed_at=clock_timestamp(),review_note=${note},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`:action==='withdraw'?await tx`UPDATE studio_os.leave_requests SET status='withdrawn',withdrawn_at=clock_timestamp(),withdrawal_reason=${note},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`:await tx`UPDATE studio_os.leave_requests SET status='revoked',revoked_by=${who.id},revoked_at=clock_timestamp(),revoke_note=${note},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
   await event(tx,who,id,action==='decision'?String(b.decision):action==='withdraw'?'withdrawn':'revoked',before,after);return {id};
  });
 }
 async list(who:Identity,value:unknown){who=await freshIdentity(this.db,who);
  requireContributor(who);const b=objectInput(value,['view','status','from','to','memberId','offset']);if(b.view!==undefined&&!['own','team'].includes(String(b.view)))throw new BadRequestException();const team=b.view==='team';if(team&&!hasPermission(who,'personnel'))throw new ForbiddenException();if(!team&&b.memberId!==undefined)throw new BadRequestException();const member=b.memberId?uuid(b.memberId):null,status=b.status===undefined?'all':String(b.status),from=b.from?calendar(b.from):null,to=b.to?calendar(b.to):null,offset=b.offset===undefined?0:Number(b.offset);if(!['all',...statuses].includes(status)||(from&&to&&from>to)||!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;const where=tx`(${team} OR r.owner_id=${who.id}) AND (${member}::uuid IS NULL OR r.member_id=${member}) AND (${status}='all' OR r.status=${status}) AND (${from}::date IS NULL OR r.ends_at>(${from}::date::timestamp AT TIME ZONE 'Asia/Shanghai')) AND (${to}::date IS NULL OR r.starts_at<(((${to}::date+1)::timestamp) AT TIME ZONE 'Asia/Shanghai'))`;const rows=await tx`SELECT r.*,m.display_name AS "memberName" FROM studio_os.leave_requests r JOIN studio_os.members m ON m.id=r.member_id WHERE ${where} ORDER BY r.starts_at DESC,r.id LIMIT 50 OFFSET ${offset}`;const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.leave_requests r WHERE ${where}`;return {rows:rows.map(publicValue),total:n.n,offset,limit:50};});
 }
 async detail(who:Identity,id:string,query:unknown={}){who=await freshIdentity(this.db,who);requireContributor(who);uuid(id);objectInput(query,[]);const [r]=await this.db.client`SELECT r.*,m.display_name AS "memberName" FROM studio_os.leave_requests r JOIN studio_os.members m ON m.id=r.member_id WHERE r.id=${id} AND (${hasPermission(who,'personnel')} OR r.owner_id=${who.id})`;if(!r)throw new NotFoundException();return publicValue(r);}
 async history(who:Identity,id:string,value:unknown){who=await freshIdentity(this.db,who);requireContributor(who);uuid(id);const b=objectInput(value,['offset']),offset=b.offset===undefined?0:Number(b.offset);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;if(!(await tx`SELECT id FROM studio_os.leave_requests WHERE id=${id} AND (${hasPermission(who,'personnel')} OR owner_id=${who.id})`).length)throw new NotFoundException();const rows=await tx`SELECT * FROM studio_os.leave_events WHERE leave_id=${id} ORDER BY created_at,id LIMIT 50 OFFSET ${offset}`;const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.leave_events WHERE leave_id=${id}`;return {rows:rows.map(publicValue),total:n.n,offset,limit:50};});}
}
