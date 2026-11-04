import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,longText} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {purchaseDay} from './equipment-purchase';
import {optionalMoney} from './money';
const MAX=2147483647;
const integer=(v:unknown,min=0)=>{if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>MAX)throw new BadRequestException();return Number(v);};
const offset=(v:unknown)=>integer(v===undefined?0:Number(v));
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const projection=`r.id,r.direction,r.account_label AS "accountLabel",r.source_reference AS "sourceReference",v.version,v.paid_date::text AS "paidDate",v.amount_cents AS "amountCents",v.description,v.lines,v.status,v.reason,v.actor_name AS actor,v.created_at AS "createdAt"`;
const sourceKey=(r:any)=>r.kind==='income'?`income:${r.storeId}:${r.month}`:`expense:${r.expenseId}`;
async function source(tx:TransactionSql,line:any,lock=false):Promise<any>{
 if(line.kind==='income'){
  if(lock)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'month-income:'+line.storeId+':'+line.month},0))`;
  const [s]=await tx`SELECT v.store_id AS "storeId",s.name,v.month,v.version,v.amount_cents AS "amountCents",v.status,v.source_reference AS "sourceReference" FROM studio_os.store_month_income_versions v JOIN studio_os.stores s ON s.id=v.store_id WHERE v.store_id=${line.storeId} AND v.month=${line.month} ORDER BY v.version DESC LIMIT 1`;
  return s?{...s,kind:'income',expenseId:null,key:sourceKey(line),label:s.name+' · '+s.month+' 月度收入'}:null;
 }
 const [s]=await tx`SELECT id AS "expenseId",version,amount_cents AS "amountCents",description AS label,expense_date::text AS "businessDate",payment_mode AS "paymentMode",expense_scope AS scope,expense_use AS use,store_id AS "storeId" FROM studio_os.expense_records WHERE id=${line.expenseId} ${lock?tx`FOR SHARE`:tx``}`;
 return s?{...s,kind:'expense',month:s.businessDate.slice(0,7),key:sourceKey(line),status:s.paymentMode==='company'?'company':'advance'}:null;
}
async function allocated(tx:TransactionSql,key:string,except:string|null=null){
 const [r]=await tx`SELECT coalesce(sum((l.value->>'amountCents')::bigint),0)::text AS cents FROM studio_os.cash_movement_records r JOIN LATERAL(SELECT lines,status FROM studio_os.cash_movement_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true CROSS JOIN LATERAL jsonb_array_elements(v.lines) l(value) WHERE v.status='active' AND l.value->>'key'=${key} AND (${except}::uuid IS NULL OR r.id<>${except})`;
 return r.cents as string;
}
async function match(tx:TransactionSql,line:any){
 const current=await source(tx,line),cashCents=await allocated(tx,line.key),valid=!!current&&(current.kind==='income'?current.status==='confirmed':current.paymentMode==='company');
 return {line,current,cashCents,differenceCents:current?(BigInt(current.amountCents)-BigInt(cashCents)).toString():null,
  sourceChanged:!valid||current?.version!==line.snapshot.version,overmatched:!!current&&current.kind==='expense'&&BigInt(cashCents)>BigInt(current.amountCents)};
}
export class CashCorrespondence{
 constructor(private readonly db:StudioDatabase){}
 private async write(who:Identity,operation:string,id:string|null,key:string,body:any,fn:(tx:TransactionSql,name:string)=>Promise<any>){
  const hash=createHash('sha256').update(JSON.stringify(canonical({operation,id,body}))).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'cash-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT operation,target_id,request_hash,result FROM studio_os.cash_movement_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.operation!==operation||old.target_id!==id||old.request_hash!==hash)throw new ConflictException('该请求已用于其他资金核对');return old.result;}
   const result=await fn(tx,actor.username);await tx`INSERT INTO studio_os.cash_movement_receipts(actor_id,request_key,operation,target_id,request_hash,result) VALUES(${who.id},${key},${operation},${id},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('该账户或渠道下的流水编号已登记，作废后仍保留原编号');throw e;}
 }
 async sources(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month','kind','q','offset']),month=attendanceMonth(q.month),kind=q.kind??'income',search=q.q?shortText(q.q,100):'',start=offset(q.offset);if(typeof kind!=='string'||!['income','expense'].includes(kind))throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=kind==='income'?await tx`SELECT DISTINCT ON(v.store_id) v.store_id AS "storeId",v.month,v.version,v.amount_cents AS "amountCents",v.status,s.name AS label,v.source_reference AS "sourceReference",NULL::uuid AS "expenseId" FROM studio_os.store_month_income_versions v JOIN studio_os.stores s ON s.id=v.store_id WHERE v.month=${month} ORDER BY v.store_id,v.version DESC`:
    await tx`SELECT id AS "expenseId",NULL::uuid AS "storeId",to_char(expense_date,'YYYY-MM') AS month,version,amount_cents AS "amountCents",description AS label,'company' AS status FROM studio_os.expense_records WHERE payment_mode='company' AND to_char(expense_date,'YYYY-MM')=${month}`;
   const filtered=rows.filter(r=>r.status!=='withdrawn'&&JSON.stringify(r).toLowerCase().includes(search.toLowerCase())).sort((a,b)=>a.label.localeCompare(b.label)||String(a.storeId??a.expenseId).localeCompare(String(b.storeId??b.expenseId)));
   const result=[];for(const r of filtered.slice(start,start+50)){const line={...r,kind},key=sourceKey(line),cashCents=await allocated(tx,key);result.push({...line,key,cashCents,differenceCents:(BigInt(r.amountCents)-BigInt(cashCents)).toString()});}
   return {rows:result,month,kind,total:filtered.length,offset:start,limit:50};
  });
 }
 async list(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month','direction','status','q','offset']),month=attendanceMonth(q.month),direction=String(q.direction??'all'),status=String(q.status??'active'),search=q.q?shortText(q.q,100):'',start=offset(q.offset);
  if(q.direction!==undefined&&typeof q.direction!=='string'||q.status!==undefined&&typeof q.status!=='string'||!['all','in','out'].includes(String(direction))||!['active','void','all'].includes(String(status)))throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const entries=tx`WITH entries AS (
    SELECT r.id,'manual' AS origin,r.direction,r.account_label AS "accountLabel",r.source_reference AS "sourceReference",v.version,v.paid_date::text AS "paidDate",v.amount_cents::bigint AS "amountCents",v.description,v.status,r.created_at AS posted_at,
     v.amount_cents::bigint-coalesce((SELECT sum((l.value->>'amountCents')::bigint) FROM jsonb_array_elements(v.lines) l(value)),0) AS "unmatchedCents",NULL::uuid AS "settlementId"
    FROM studio_os.cash_movement_records r JOIN LATERAL(SELECT * FROM studio_os.cash_movement_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true
    UNION ALL SELECT p.id,'reimbursement','out',NULL,p.id::text,NULL,p.paid_date::text,p.amount_cents::bigint,'报销付款 · '||m.display_name,'active',p.created_at,0::bigint,p.settlement_id
    FROM studio_os.expense_reimbursements p JOIN studio_os.members m ON m.id=p.payer_id)
    SELECT * FROM entries WHERE left("paidDate",7)=${month} AND (${direction}='all' OR direction=${direction}) AND (${status}='all' OR status=${status}) AND strpos(lower(concat_ws(' ',description,"accountLabel","sourceReference")),lower(${search}))>0`;
   const rows=await tx`SELECT * FROM (${entries}) e ORDER BY "paidDate" DESC,posted_at DESC,id LIMIT 50 OFFSET ${start}`;
   const [summary]=await tx`SELECT count(*)::int AS total,coalesce(sum("amountCents") FILTER(WHERE status='active' AND direction='in'),0)::text AS "inCents",coalesce(sum("amountCents") FILTER(WHERE status='active' AND direction='out'),0)::text AS "outCents",coalesce(sum("amountCents") FILTER(WHERE origin='reimbursement'),0)::text AS "reimbursementCents",coalesce(sum("unmatchedCents") FILTER(WHERE status='active'),0)::text AS "unmatchedCents" FROM (${entries}) e`;
   return {rows:rows.map(r=>({...r,amountCents:String(r.amountCents),unmatchedCents:String(r.unmatchedCents)})),total:summary.total,offset:start,limit:50,month,summary};
  });
 }
 async detail(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['offset']),start=offset(q.offset);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [record]=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.cash_movement_records r JOIN LATERAL(SELECT * FROM studio_os.cash_movement_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true WHERE r.id=${id}`;if(!record)throw new NotFoundException();
   const matches=[];for(const line of record.lines)matches.push(await match(tx,line));
   const history=await tx`SELECT id,version,paid_date::text AS "paidDate",amount_cents AS "amountCents",description,lines,status,reason,actor_name AS actor,created_at AS "createdAt" FROM studio_os.cash_movement_versions WHERE record_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${start}`;
   const [n]=await tx`SELECT count(*)::int AS total FROM studio_os.cash_movement_versions WHERE record_id=${id}`;
   return {record,matches,unmatchedCents:(BigInt(record.amountCents)-record.lines.reduce((n:bigint,l:any)=>n+BigInt(l.amountCents),0n)).toString(),history:{rows:history,total:n.total,offset:start,limit:50}};
  });
 }
 async save(who:Identity,id:string|null,value:unknown){
  if(id)id=uuid(id);const b=objectInput(value,['requestKey',...(id?['expectedVersion']:['direction','accountLabel','sourceReference']),'paidDate','amount','description','lines','reason']),key=uuid(b.requestKey),date=purchaseDay(b.paidDate),amount=optionalMoney(b.amount),description=shortText(b.description,500),reason=longText(b.reason,2000),expected=id?integer(b.expectedVersion,1):0;
  if(!amount||expected>=MAX||!Array.isArray(b.lines)||b.lines.length>50)throw new BadRequestException();
  const input=id?null:{direction:b.direction,accountLabel:shortText(b.accountLabel,100),sourceReference:shortText(b.sourceReference,200)};if(input&&(typeof input.direction!=='string'||!['in','out'].includes(input.direction)))throw new BadRequestException();
  const lines=b.lines.map(v=>{const r=objectInput(v,['kind','storeId','month','expenseId','amount','sourceVersion']),cents=optionalMoney(r.amount),version=integer(r.sourceVersion,1);if(!cents||typeof r.kind!=='string'||!['income','expense'].includes(r.kind))throw new BadRequestException();const line={kind:String(r.kind),storeId:r.kind==='income'?uuid(r.storeId):null,month:r.kind==='income'?attendanceMonth(r.month):null,expenseId:r.kind==='expense'?uuid(r.expenseId):null,amountCents:cents,sourceVersion:version};if(r.kind==='income'&&r.expenseId!==null||r.kind==='expense'&&(r.storeId!==null||r.month!==null))throw new BadRequestException();return {...line,key:sourceKey(line)};});
  if(new Set(lines.map(l=>l.key)).size!==lines.length||lines.reduce((n,l)=>n+BigInt(l.amountCents),0n)>BigInt(amount))throw new BadRequestException('对应金额不能重复或超过本次资金金额');
  return this.write(who,id?'revise':'create',id,key,{input,date,amount,description,reason,expected,lines},async(tx,name)=>{
   let original:any=null;if(id){const [r]=await tx`SELECT * FROM studio_os.cash_movement_records WHERE id=${id} FOR UPDATE`;if(!r)throw new NotFoundException();original=r;const [v]=await tx`SELECT version,status FROM studio_os.cash_movement_versions WHERE record_id=${id} ORDER BY version DESC LIMIT 1`;if(v.version!==expected||v.status!=='active')throw new ConflictException('资金记录已变化或作废');}
   const direction=original?.direction??input!.direction;
   if(lines.some(l=>(direction==='in')!==(l.kind==='income')))throw new BadRequestException('到账对应月度收入；公司付款对应公司支付支出，垫付请沿用原报销');
   // One global, ordered source lock avoids write-skew across different cash movements.
   for(const line of [...lines].sort((a,b)=>a.key.localeCompare(b.key)))await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'cash-source:'+line.key},0))`;
   const savedLines=[];
   for(const line of [...lines].sort((a,b)=>a.key.localeCompare(b.key))){const current=await source(tx,line,true);if(!current||current.version!==line.sourceVersion||(line.kind==='income'?current.status!=='confirmed':current.paymentMode!=='company'))throw new ConflictException('原收入或公司支出已有变化，请重新核对；个人垫付沿用结算报销');
    const used=BigInt(await allocated(tx,line.key,id));if(line.kind==='expense'&&used+BigInt(line.amountCents)>BigInt(current.amountCents))throw new ConflictException('该公司支出累计对应付款已超过原金额');
    savedLines.push({key:line.key,kind:line.kind,storeId:line.kind==='income'?line.storeId:null,month:line.kind==='income'?line.month:null,expenseId:line.expenseId,amountCents:line.amountCents,snapshot:current});
   }
   if(!id){const [r]=await tx`INSERT INTO studio_os.cash_movement_records(direction,account_label,source_reference,created_by) VALUES(${String(input!.direction)},${input!.accountLabel},${input!.sourceReference},${who.id}) RETURNING id`;id=r.id;}
   for(const line of savedLines)await tx`INSERT INTO studio_os.cash_source_references(record_id,source_key,expense_id,store_id,month) VALUES(${id!},${line.key},${line.expenseId},${line.storeId},${line.month}) ON CONFLICT DO NOTHING`;
   const [v]=await tx`INSERT INTO studio_os.cash_movement_versions(record_id,version,paid_date,amount_cents,description,lines,status,reason,actor_id,actor_name) VALUES(${id!},${expected+1},${date}::date,${amount},${description},${JSON.stringify(savedLines)}::jsonb,'active',${reason},${who.id},${name}) RETURNING id,version`;
   return {id,recordId:v.id,version:v.version};
  });
 }
 async void(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','reason']),key=uuid(b.requestKey),expected=integer(b.expectedVersion,1),reason=longText(b.reason,2000);if(expected>=MAX)throw new BadRequestException();
  return this.write(who,'void',id,key,{expected,reason},async(tx,name)=>{
   if(!(await tx`SELECT id FROM studio_os.cash_movement_records WHERE id=${id} FOR UPDATE`).length)throw new NotFoundException();const [v]=await tx`SELECT * FROM studio_os.cash_movement_versions WHERE record_id=${id} ORDER BY version DESC LIMIT 1`;if(v.version!==expected||v.status!=='active')throw new ConflictException();
   const [r]=await tx`INSERT INTO studio_os.cash_movement_versions(record_id,version,paid_date,amount_cents,description,lines,status,reason,actor_id,actor_name) VALUES(${id},${expected+1},${v.paid_date},${v.amount_cents},${v.description},${JSON.stringify(v.lines)}::jsonb,'void',${reason},${who.id},${name}) RETURNING id,version`;return {id,recordId:r.id,version:r.version};
  });
 }
 async receipt(who:Identity,key:string,operation:string,target:string|null){
  await currentPermission(this.db,who,'finance');key=uuid(key);if(!['create','revise','void'].includes(operation)||(operation==='create')!==(target===null))throw new BadRequestException();if(target)target=uuid(target);
  const [r]=await this.db.client`SELECT result FROM studio_os.cash_movement_receipts WHERE actor_id=${who.id} AND request_key=${key} AND operation=${operation} AND target_id IS NOT DISTINCT FROM ${target}`;if(!r)throw new NotFoundException();return r.result;
 }
}

// Shared read-only evidence for monthly review; uses the same source/version and cumulative allocation rules as cash detail.
export async function cashMonthEvidence(tx:TransactionSql,month:string):Promise<any[]>{
 const records=await tx`SELECT r.id,r.direction,r.account_label AS "accountLabel",r.source_reference AS "sourceReference",v.version,v.paid_date::text AS "paidDate",v.amount_cents AS "amountCents",v.description,v.lines
  FROM studio_os.cash_movement_records r JOIN LATERAL(SELECT * FROM studio_os.cash_movement_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true
  WHERE v.status='active' AND (to_char(v.paid_date,'YYYY-MM')=${month} OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.lines) l(value) LEFT JOIN studio_os.expense_records e ON e.id=(l.value->>'expenseId')::uuid
   WHERE l.value->>'month'=${month} OR l.value->'snapshot'->>'month'=${month} OR to_char(e.expense_date,'YYYY-MM')=${month})) ORDER BY r.id`;
 const rows=[];for(const r of records){const matches=[];for(const line of r.lines){const evidence=await match(tx,line);if(line.month===month||line.snapshot.month===month||evidence.current?.month===month||r.paidDate.startsWith(month))matches.push(evidence);}rows.push({...r,unmatchedCents:(BigInt(r.amountCents)-r.lines.reduce((n:bigint,l:any)=>n+BigInt(l.amountCents),0n)).toString(),matches});}
 return rows;
}
export async function matchedIncomeCents(tx:TransactionSql,storeId:string,month:string){return allocated(tx,`income:${storeId}:${month}`);}
