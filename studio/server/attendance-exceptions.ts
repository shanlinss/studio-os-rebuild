import {BadRequestException,ConflictException,ForbiddenException,NotFoundException,UnauthorizedException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import {requireContributor,requireAdministrator} from './access';
import {objectInput,uuid,version,longText} from './validation';
import {publicValue,lockOwner,audit} from './attendance-support';
import {attendanceMetrics} from './daily-attendance';
const kinds=['late','insufficient'],outcomes=['confirmed','special','reopened'];
const iso=(v:any)=>v===null?null:new Date(v).toISOString();
function date(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v)||v.startsWith('0000')||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new BadRequestException();return v;}
function describe(p:any,now:string,count:number){
 if(p.kind!=='studio')return {eligible:false,issue:'legacy-field',metrics:null};
 if(count!==1)return {eligible:false,issue:'multiple-periods',metrics:null};
 const start=iso(p.adjusted_in||p.original_in),end=iso(p.adjusted_out||p.original_out);if(!start||!end)return {eligible:false,issue:'incomplete',metrics:null};
 const metrics=attendanceMetrics(start,end,p.work_date,now);return metrics?{eligible:true,issue:null,metrics}:{eligible:false,issue:'invalid-times',metrics:null};
}
function status(latest:any,p:any,flag:boolean,eligible:boolean){if(!eligible||!flag)return 'not-applicable';if(!latest)return 'pending';if(latest.period_version!==p.version)return 'stale';return latest.outcome==='reopened'?'pending':latest.outcome;}
async function readPeriod(tx:TransactionSql,who:Identity,id:string,lock=false){const rows=lock?await tx`SELECT p.*,p.work_date::text AS work_date,m.display_name AS "memberName" FROM studio_os.attendance_periods p JOIN studio_os.members m ON m.id=p.member_id WHERE p.id=${id} FOR UPDATE OF p`:await tx`SELECT p.*,p.work_date::text AS work_date,m.display_name AS "memberName" FROM studio_os.attendance_periods p JOIN studio_os.members m ON m.id=p.member_id WHERE p.id=${id} AND (${who.role==='admin'} OR p.owner_id=${who.id})`;if(!rows.length)throw new NotFoundException();return rows[0];}
export class AttendanceExceptions {
 constructor(private readonly db:StudioDatabase){}
 async detail(who:Identity,id:string,query:unknown={}){
  requireContributor(who);uuid(id);objectInput(query,[]);return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;const p=await readPeriod(tx,who,id),[count]=await tx`SELECT count(*)::int AS n FROM studio_os.attendance_periods WHERE owner_id=${p.owner_id} AND work_date=${p.work_date}::date AND kind='studio'`,[clock]=await tx`SELECT clock_timestamp() AS now`,info=describe(p,new Date(clock.now).toISOString(),count.n);
   const rows=[];for(const kind of kinds){const [latest]=await tx`SELECT * FROM studio_os.attendance_exception_reviews WHERE period_id=${id} AND kind=${kind} ORDER BY revision DESC LIMIT 1`;const flag=info.metrics?(kind==='late'?info.metrics.late:info.metrics.insufficient)===true:false;rows.push({kind,flag,reviewStatus:status(latest,p,flag,info.eligible),latest:latest?publicValue(latest):null});}
   return {period:publicValue(p),...info,rows};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  requireAdministrator(who);uuid(id);const b=objectInput(value,['requestKey','expectedPeriodVersion','expectedReviewId','kind','outcome','note']);const key=uuid(b.requestKey),expected=version(b.expectedPeriodVersion),previous=b.expectedReviewId===null?null:uuid(b.expectedReviewId),note=longText(b.note,2000);if(typeof b.kind!=='string'||!kinds.includes(b.kind)||typeof b.outcome!=='string'||!outcomes.includes(b.outcome))throw new BadRequestException();const kind=b.kind,outcome=b.outcome,hash=createHash('sha256').update(JSON.stringify({id,body:Object.fromEntries(Object.keys(b).sort().map(k=>[k,b[k]]))})).digest('hex');
  return this.db.client.begin(async tx=>{
   const [actor]=await tx`SELECT active,role FROM studio_os.accounts WHERE id=${who.id} FOR SHARE`;if(!actor?.active)throw new UnauthorizedException();if(actor.role!=='admin')throw new ForbiddenException();
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'exception-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT request_hash,result FROM studio_os.attendance_exception_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(old){if(old.request_hash!==hash)throw new ConflictException();return old.result;}
   const [lookup]=await tx`SELECT owner_id FROM studio_os.attendance_periods WHERE id=${id}`;if(!lookup)throw new NotFoundException();await lockOwner(tx,lookup.owner_id);const p=await readPeriod(tx,who,id,true);if(p.version!==expected)throw new ConflictException('原考勤已变化');
   const [count]=await tx`SELECT count(*)::int AS n FROM studio_os.attendance_periods WHERE owner_id=${p.owner_id} AND kind='studio' AND work_date=${p.work_date}::date`,[clock]=await tx`SELECT clock_timestamp() AS now`,info=describe(p,new Date(clock.now).toISOString(),count.n);if(!info.eligible||!info.metrics||(kind==='late'?!info.metrics.late:!info.metrics.insufficient))throw new ConflictException('当前没有可核实的同日已签退时间异常');
   const [latest]=await tx`SELECT * FROM studio_os.attendance_exception_reviews WHERE period_id=${id} AND kind=${kind} ORDER BY revision DESC LIMIT 1`;if((latest?.id||null)!==previous)throw new ConflictException('核实记录已变化');if(outcome==='reopened'&&(!latest||latest.period_version!==p.version||latest.outcome==='reopened'))throw new ConflictException();
   const revision=(latest?.revision||0)+1;if(revision>2147483647)throw new ConflictException();const [member]=await tx`SELECT display_name FROM studio_os.members WHERE login_account_id=${who.id}`;
   const [review]=await tx`INSERT INTO studio_os.attendance_exception_reviews(period_id,owner_id,member_id,kind,outcome,note,period_version,revision,previous_review_id,source_snapshot,actor_id,actor_name) VALUES(${id},${p.owner_id},${p.member_id},${kind},${outcome},${note},${p.version},${revision},${previous},${JSON.stringify(publicValue(p))}::jsonb,${who.id},${member?.display_name||who.username}) RETURNING *`;
   await audit(tx,who,p.owner_id,id,null,'exception-reviewed',latest,review);const result={id,reviewId:String(review.id)};await tx`INSERT INTO studio_os.attendance_exception_receipts(actor_id,request_key,request_hash,result) VALUES(${who.id},${key},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });
 }
 async receipt(who:Identity,key:string){requireAdministrator(who);uuid(key);const [r]=await this.db.client`SELECT result FROM studio_os.attendance_exception_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(!r)throw new NotFoundException();return r.result;}
 async history(who:Identity,id:string,value:unknown){requireContributor(who);uuid(id);const b=objectInput(value,['offset']),offset=b.offset===undefined?0:Number(b.offset);if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;await readPeriod(tx,who,id);const rows=await tx`SELECT * FROM studio_os.attendance_exception_reviews WHERE period_id=${id} ORDER BY created_at,id LIMIT 50 OFFSET ${offset}`;const [n]=await tx`SELECT count(*)::int AS n FROM studio_os.attendance_exception_reviews WHERE period_id=${id}`;return {rows:rows.map(publicValue),total:n.n,offset,limit:50};});}
 async list(who:Identity,value:unknown){
  requireContributor(who);const b=objectInput(value,['view','from','to','kind','status','offset']),team=b.view==='team';if(b.view!==undefined&&!['own','team'].includes(String(b.view)))throw new BadRequestException();if(team&&who.role!=='admin')throw new ForbiddenException();const from=b.from?date(b.from):null,to=b.to?date(b.to):null,kind=b.kind===undefined?'all':String(b.kind),filter=b.status===undefined?'pending':String(b.status),offset=b.offset===undefined?0:Number(b.offset);if((from&&to&&from>to)||!['all',...kinds].includes(kind)||!['all','pending','handled'].includes(filter)||!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const cte=tx`WITH raw AS (SELECT p.*,count(*) OVER(PARTITION BY owner_id,work_date) AS day_count,date_trunc('milliseconds',coalesce(adjusted_in,original_in)) AS actual_in,date_trunc('milliseconds',coalesce(adjusted_out,original_out)) AS actual_out FROM studio_os.attendance_periods p WHERE kind='studio'), valid AS (SELECT * FROM raw WHERE day_count=1 AND actual_in IS NOT NULL AND actual_out IS NOT NULL AND actual_out>=actual_in AND actual_out<=clock_timestamp() AND (actual_in AT TIME ZONE 'Asia/Shanghai')::date=work_date AND (actual_out AT TIME ZONE 'Asia/Shanghai')::date=work_date), queue AS (SELECT p.id::text||':'||k.kind AS id,p.id AS "periodId",p.version AS "periodVersion",p.work_date::text AS "workDate",m.display_name AS "memberName",k.kind,p.actual_in AS "effectiveIn",p.actual_out AS "effectiveOut",floor(extract(epoch FROM(p.actual_out-p.actual_in))/60)::int AS "durationMinutes",r.id AS "reviewId",r.note AS "lastNote",CASE WHEN r.id IS NULL THEN 'pending' WHEN r.period_version<>p.version THEN 'stale' WHEN r.outcome='reopened' THEN 'pending' ELSE r.outcome END AS "reviewStatus" FROM valid p JOIN studio_os.members m ON m.id=p.member_id CROSS JOIN(VALUES('late'),('insufficient')) k(kind) LEFT JOIN LATERAL(SELECT * FROM studio_os.attendance_exception_reviews WHERE period_id=p.id AND kind=k.kind ORDER BY revision DESC LIMIT 1) r ON true WHERE (${team} OR p.owner_id=${who.id}) AND (${from}::date IS NULL OR p.work_date>=${from}::date) AND (${to}::date IS NULL OR p.work_date<=${to}::date) AND (${kind}='all' OR k.kind=${kind}) AND ((k.kind='late' AND p.actual_in>((p.work_date::text||' 10:30:00')::timestamp AT TIME ZONE 'Asia/Shanghai')) OR(k.kind='insufficient' AND p.actual_out-p.actual_in<interval '8 hours'))) `;
   const where=tx`(${filter}='all' OR (${filter}='handled' AND "reviewStatus" IN('confirmed','special')) OR (${filter}='pending' AND "reviewStatus" IN('pending','stale')))`;
   const rows=await tx`${cte} SELECT * FROM queue WHERE ${where} ORDER BY "workDate" DESC,"periodId",kind LIMIT 50 OFFSET ${offset}`, [n]=await tx`${cte} SELECT count(*)::int AS n FROM queue WHERE ${where}`;
   // PostgreSQL's timestamp projection uses snake-case keys elsewhere; these aliases
   // require explicit normalization as well, never local-time browser inference.
   return {rows:rows.map(r=>({...r,effectiveIn:iso(r.effectiveIn),effectiveOut:iso(r.effectiveOut)})),total:n.n,offset,limit:50};
  });
 }
}
