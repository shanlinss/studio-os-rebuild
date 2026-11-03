import {ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import {objectInput,uuid,version} from './validation';
import {lockOwner,audit} from './attendance-support';
const millis=(v:unknown)=>v instanceof Date?v.getTime():new Date(String(v)).getTime();
const day=(v:unknown)=>new Date(millis(v)+8*3600000).toISOString().slice(0,10);
const iso=(v:unknown)=>v===null||v===undefined?null:new Date(millis(v)).toISOString();
async function clock(tx:TransactionSql){const [r]=await tx`WITH c AS (SELECT clock_timestamp() AS stamp) SELECT stamp,(stamp AT TIME ZONE 'Asia/Shanghai')::date::text AS today FROM c`;return r;}
async function records(tx:TransactionSql,owner:string,today:string){
 const rows=await tx`SELECT *,work_date::text AS work_date FROM studio_os.attendance_periods WHERE owner_id=${owner} AND kind='studio' AND work_date=${today}::date ORDER BY created_at,id`;
 const open=await tx`SELECT id FROM studio_os.attendance_periods WHERE owner_id=${owner} AND kind='studio' AND work_date<>${today}::date AND coalesce(adjusted_in,original_in) IS NOT NULL AND coalesce(adjusted_out,original_out) IS NULL`;
 return {rows,open};
}
function validPeriod(row:any,today:string){const start=row.adjusted_in||row.original_in,end=row.adjusted_out||row.original_out;return !!start&&day(start)===today&&(!end||day(end)===today);}
export async function startAttendanceAtLogin(tx:TransactionSql,who:Identity){
 if(who.role!=='employee')return;
 await lockOwner(tx,who.id);
 const [member]=await tx`SELECT id,active,start_date::text AS "startDate",end_date::text AS "endDate" FROM studio_os.members WHERE login_account_id=${who.id} FOR SHARE`;if(!member?.active)return;
 const {stamp,today}=await clock(tx);if((member.startDate&&today<member.startDate)||(member.endDate&&today>member.endDate))return;const {rows,open}=await records(tx,who.id,today);
 if(open.length||rows.length>1||(rows[0]&&!validPeriod(rows[0],today)))return;
 let period=rows[0];
 if(!period){
  [period]=await tx`INSERT INTO studio_os.attendance_periods(owner_id,member_id,kind,work_date,approval_status,original_in) VALUES(${who.id},${member.id},'studio',${today}::date,'not-required',${stamp}) RETURNING *`;
  await audit(tx,who,who.id,period.id,null,'login-started',null,period);
 }
 await tx`INSERT INTO studio_os.attendance_daily_links(owner_id,work_date,period_id,origin) VALUES(${who.id},${today}::date,${period.id},${rows.length?'legacy-adopted':'login'}) ON CONFLICT(owner_id,work_date) DO NOTHING`;
}
export function attendanceMetrics(inAt:string,outAt:string|null,today:string,serverNow:string){
 const start=new Date(inAt).getTime(),end=outAt?new Date(outAt).getTime():null,now=new Date(serverNow).getTime();
 if(!Number.isFinite(start)||!Number.isFinite(now)||(end!==null&&!Number.isFinite(end))||day(inAt)!==today||(outAt&&day(outAt)!==today)||start>now||(end!==null&&(end>now||end<start)))return null;
 return {durationMinutes:Math.floor(((end??now)-start)/60000),late:start>new Date(today+'T10:30:00+08:00').getTime(),insufficient:end===null?null:end-start<8*3600000};
}
export class DailyAttendance {
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity){
  return this.db.client.begin(async tx=>{
   await lockOwner(tx,who.id);const {stamp,today}=await clock(tx);
   const base={today,serverNow:iso(stamp),status:'not-applicable',issue:null as string|null,period:null as any,late:null as boolean|null,insufficient:null as boolean|null,durationMinutes:null as number|null};
   const [account]=await tx`SELECT active,role FROM studio_os.accounts WHERE id=${who.id}`;if(!account?.active)throw new UnauthorizedException();if(account.role!=='employee')return base;
   const [member]=await tx`SELECT active,start_date::text AS "startDate",end_date::text AS "endDate" FROM studio_os.members WHERE login_account_id=${who.id}`;if(!member?.active)return {...base,status:'unavailable',issue:'member-unavailable'};
   if((member.startDate&&today<member.startDate)||(member.endDate&&today>member.endDate))return {...base,status:'unavailable',issue:'outside-employment'};
   const {rows,open}=await records(tx,who.id,today),row=rows.length===1?rows[0]:null;
   if(row)base.period={id:String(row.id),workDate:row.work_date,version:Number(row.version),inAt:iso(row.adjusted_in||row.original_in),outAt:iso(row.adjusted_out||row.original_out)};
   if(open.length)return {...base,status:'needs-review',issue:'previous-open'};
   if(rows.length>1)return {...base,status:'needs-review',issue:'multiple-periods'};
   if(!row)return {...base,status:'not-started'};
   if(!validPeriod(row,today))return {...base,status:'needs-review',issue:'invalid-period'};
   const metrics=attendanceMetrics(base.period.inAt,base.period.outAt,today,iso(stamp)!);
   if(!metrics)return {...base,status:'needs-review',issue:'invalid-period'};
   return {...base,status:base.period.outAt?'finished':'working',...metrics};
  });
 }
 async end(who:Identity,tokenHash:string|undefined,value:unknown){
  if(who.role!=='employee')throw new ForbiddenException();if(!tokenHash)throw new UnauthorizedException();
  const b=objectInput(value,['requestKey','periodId','expectedVersion']),key=uuid(b.requestKey),id=uuid(b.periodId),expected=version(b.expectedVersion);
  const hash=createHash('sha256').update(JSON.stringify({id,expected})).digest('hex');
  return this.db.client.begin(async tx=>{
   const [account]=await tx`SELECT active,role FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`;if(!account?.active)throw new UnauthorizedException();if(account.role!=='employee')throw new ForbiddenException();
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'attendance-key:'+who.id+':'+key},0))`;
   await lockOwner(tx,who.id);
   if(!(await tx`SELECT token_hash FROM studio_os.sessions WHERE token_hash=${tokenHash} AND account_id=${who.id} AND expires_at>clock_timestamp()`).length)throw new UnauthorizedException();
   const [old]=await tx`SELECT action,request_hash,result FROM studio_os.attendance_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.action!=='day-end'||old.request_hash!==hash)throw new ConflictException();await tx`DELETE FROM studio_os.sessions WHERE account_id=${who.id}`;return old.result;}
   const [member]=await tx`SELECT active,start_date::text AS "startDate",end_date::text AS "endDate" FROM studio_os.members WHERE login_account_id=${who.id} FOR SHARE`;if(!member?.active)throw new ConflictException();
   const {stamp,today}=await clock(tx);if((member.startDate&&today<member.startDate)||(member.endDate&&today>member.endDate))throw new ConflictException('当前日期不在入离职适用期间，请先核对人员资料');const {rows,open}=await records(tx,who.id,today);
   if(open.length||rows.length!==1||!validPeriod(rows[0],today))throw new ConflictException('存在待核对的考勤记录');
   const [before]=await tx`SELECT * FROM studio_os.attendance_periods WHERE id=${id} AND owner_id=${who.id} AND kind='studio' FOR UPDATE`;if(!before)throw new NotFoundException();
   if(before.id!==rows[0].id||before.version!==expected||before.adjusted_out||before.original_out)throw new ConflictException();
   if(millis(before.adjusted_in||before.original_in)>millis(stamp))throw new ConflictException();
   const [after]=await tx`UPDATE studio_os.attendance_periods SET original_out=${stamp},version=version+1,updated_at=now() WHERE id=${id} RETURNING *`;
   await audit(tx,who,who.id,id,null,'day-ended',before,after);
   const result={id,workDate:today,outAt:iso(stamp)};
   await tx`INSERT INTO studio_os.attendance_receipts(actor_id,request_key,action,request_hash,result) VALUES(${who.id},${key},'day-end',${hash},${JSON.stringify(result)}::jsonb)`;
   await tx`DELETE FROM studio_os.sessions WHERE account_id=${who.id}`;
   return result;
  });
 }
}
