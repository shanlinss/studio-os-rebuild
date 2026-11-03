import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import type {TransactionSql} from 'postgres';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import {requireContributor,requireAdministrator} from './access';
import {objectInput,uuid,longText} from './validation';
import {publicValue} from './attendance-support';
import {AttendanceMonthly,attendanceMonth,attendanceSourceHash} from './attendance-monthly';
const hash=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new BadRequestException();return v;};
function notes(value:unknown,m:string){if(!Array.isArray(value)||value.length>31)throw new BadRequestException();const result=value.map(v=>{const b=objectInput(v,['date','note']);if(typeof b.date!=='string'||!b.date.startsWith(m+'-')||!/^\d{4}-\d\d-\d\d$/.test(b.date)||!Number.isFinite(Date.parse(b.date+'T00:00:00Z'))||new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date)throw new BadRequestException();return {date:b.date,note:longText(b.note,2000)};});if(new Set(result.map(n=>n.date)).size!==result.length)throw new BadRequestException();return result.sort((a,b)=>a.date.localeCompare(b.date));}
function metadata(row:any){if(!row)return null;const {snapshot,...r}=row;return publicValue(r);}
function readiness(current:any){
 const blockers:string[]=[];if(!current.member)return {blockers:['no-member'],requiredDates:[]};
 if(current.month>=current.today.slice(0,7))blockers.push('month-open');
 if(!current.member.startDate)blockers.push('missing-start-date');
 if(current.summary.pendingCorrections)blockers.push('pending-corrections');
 if(current.days.some((d:any)=>d.leaves.some((l:any)=>l.status==='pending')))blockers.push('pending-leaves');
 if(current.summary.pendingExceptions)blockers.push('pending-exceptions');
 const requiredDates=current.days.filter((d:any)=>d.employed&&d.date<=current.today&&(['needs-review','legacy-field','leave-review'].includes(d.state)||(d.workday&&d.state==='unverified-absence'))).map((d:any)=>({date:d.date,state:d.state}));
 return {blockers,requiredDates};
}
export class AttendanceClosures {
 private monthly:AttendanceMonthly;
 constructor(private readonly db:StudioDatabase){this.monthly=new AttendanceMonthly(db);}
 private async current(tx:TransactionSql,who:Identity,value:unknown,includeSources=false){return this.monthly.read(tx,who,value,includeSources) as Promise<any>;}
 async state(who:Identity,value:unknown){requireContributor(who);return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;return this.read(tx,who,value);});}
 async read(tx:TransactionSql,who:Identity,value:unknown){requireContributor(who);const current=await this.current(tx,who,value);
  // Member identity is selected by the same scoped monthly read; employee history also keeps original owner scope.
  const [row]=current.member?await tx`SELECT * FROM studio_os.attendance_month_closures WHERE member_id=${current.member.id} AND month=${current.month} AND (${who.role==='admin'} OR owner_id=${who.id}) ORDER BY revision DESC LIMIT 1`:[];
  return {current,latest:metadata(row),status:row?.action==='lock'?'locked':row?'reopened':'unlocked',drift:row?.action==='lock'&&row.source_hash!==current.sourceHash,...readiness(current)};
 }
 async save(who:Identity,value:unknown){
  requireAdministrator(who);const b=objectInput(value,['requestKey','month','memberId','action','expectedLatestId','expectedSourceHash','note','dayNotes']),key=uuid(b.requestKey),m=attendanceMonth(b.month),memberId=uuid(b.memberId),expected=b.expectedLatestId===null?null:uuid(b.expectedLatestId),expectedHash=hash(b.expectedSourceHash),note=longText(b.note,2000),dayNotes=notes(b.dayNotes,m);if(!['lock','reopen'].includes(String(b.action)))throw new BadRequestException();const action=String(b.action);if(action==='reopen'&&dayNotes.length)throw new BadRequestException();const requestHash=attendanceSourceHash({m,memberId,expected,expectedHash,note,dayNotes,action});
  // Waiting for another confirmation under repeatable-read may require a fresh snapshot.
  for(let attempt=0;attempt<3;attempt++)try{return await this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
   const [actor]=await tx`SELECT role,active FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`;if(!actor?.active)throw new UnauthorizedException();if(actor.role!=='admin')throw new ForbiddenException();
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'month-closure-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT request_hash,result FROM studio_os.attendance_month_closure_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(old){if(old.request_hash!==requestHash)throw new ConflictException();return old.result;}
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'attendance-month-closure:'+memberId+':'+m},0))`;
   const current=await this.current(tx,who,{month:m,memberId},true);const [latest]=await tx`SELECT * FROM studio_os.attendance_month_closures WHERE member_id=${memberId} AND month=${m} ORDER BY revision DESC LIMIT 1`;
   if((latest?.id||null)!==expected)throw new ConflictException('核定版本已变化，请重新读取');
   if(action==='lock'){
    if(latest?.action==='lock')throw new ConflictException('请先说明原因并重新开放核定');
    if(current.sourceHash!==expectedHash)throw new ConflictException('考勤来源已变化，请重新核对');
    const ready=readiness(current);if(ready.blockers.length)throw new ConflictException('请先处理核定前的阻塞事项');
    if(dayNotes.length!==ready.requiredDates.length||ready.requiredDates.some((d:any)=>!dayNotes.some(n=>n.date===d.date)))throw new BadRequestException('待核对日期必须逐日说明');
   }else if(latest?.action!=='lock'||latest.source_hash!==expectedHash)throw new ConflictException('当前没有匹配的锁定版本');
   const [member]=await tx`SELECT display_name FROM studio_os.members WHERE login_account_id=${who.id}`;
   const snapshot=action==='lock'?{...current,roster:[current.member]}:null;
   const [event]=await tx`INSERT INTO studio_os.attendance_month_closures(member_id,owner_id,month,revision,previous_id,action,source_hash,snapshot,day_notes,note,actor_id,actor_name) VALUES(${memberId},(SELECT login_account_id FROM studio_os.members WHERE id=${memberId}),${m},${(latest?.revision||0)+1},${latest?.id||null},${action},${action==='lock'?current.sourceHash:latest.source_hash},${snapshot?JSON.stringify(snapshot):null}::jsonb,${JSON.stringify(dayNotes)}::jsonb,${note},${who.id},${member?.display_name||who.username}) RETURNING id,revision`;
   const result={id:String(event.id),revision:event.revision};await tx`INSERT INTO studio_os.attendance_month_closure_receipts(actor_id,request_key,request_hash,result) VALUES(${who.id},${key},${requestHash},${JSON.stringify(result)}::jsonb)`;return result;
  });}catch(e){if(['40001','23505'].includes((e as any).code)){if(attempt<2)continue;throw new ConflictException('核定正在变化，请重新读取');}throw e;}
 }
 async detail(who:Identity,id:string,value:unknown){requireContributor(who);uuid(id);objectInput(value,[]);const [row]=await this.db.client`SELECT * FROM studio_os.attendance_month_closures WHERE id=${id} AND (${who.role==='admin'} OR owner_id=${who.id})`;if(!row)throw new NotFoundException();return publicValue(row);}
 async history(who:Identity,value:unknown){requireContributor(who);const b=objectInput(value,['month','memberId','offset']),offset=b.offset===undefined?0:Number(b.offset);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();const m=attendanceMonth(b.month),memberId=uuid(b.memberId);return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;if(who.role!=='admin'){const [member]=await tx`SELECT id FROM studio_os.members WHERE id=${memberId} AND login_account_id=${who.id}`;if(!member)throw new NotFoundException();}const rows=await tx`SELECT * FROM studio_os.attendance_month_closures WHERE member_id=${memberId} AND month=${m} AND (${who.role==='admin'} OR owner_id=${who.id}) ORDER BY revision DESC LIMIT 50 OFFSET ${offset}`,[n]=await tx`SELECT count(*)::int AS n FROM studio_os.attendance_month_closures WHERE member_id=${memberId} AND month=${m} AND (${who.role==='admin'} OR owner_id=${who.id})`;return {rows:rows.map(metadata),total:n.n,offset,limit:50};});}
 async receipt(who:Identity,key:string){requireAdministrator(who);uuid(key);const [r]=await this.db.client`SELECT result FROM studio_os.attendance_month_closure_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(!r)throw new NotFoundException();return r.result;}
}
