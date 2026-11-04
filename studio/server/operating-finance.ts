import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,longText} from './validation';
import {optionalMoney} from './money';
import {purchaseDay,purchaseExpense} from './equipment-purchase';
import {attendanceMonth} from './attendance-monthly';
const MAX=2147483647;
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const projection=`r.id,r.kind,r.store_id AS "storeId",s.name AS "storeName",r.parent_id AS "parentId",r.expense_id AS "expenseId",r.source_reference AS "sourceReference",
 v.version,v.business_date::text AS "businessDate",v.amount_cents AS "amountCents",v.description,v.note,v.reason,v.status,v.parent_snapshot AS "parentSnapshot",v.expense_snapshot AS "expenseSnapshot",v.actor_name AS actor,v.created_at AS "createdAt",
 coalesce(e.version<>(v.expense_snapshot->>'version')::int,false) AS "sourceChanged"`;
async function latest(tx:TransactionSql,id:string){
 const [row]=await tx`SELECT r.*,v.version,v.business_date::text AS day,v.amount_cents,v.description,v.note,v.status,v.expense_snapshot,v.parent_snapshot
  FROM studio_os.operating_finance_records r JOIN LATERAL(SELECT * FROM studio_os.operating_finance_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true WHERE r.id=${id}`;
 if(!row)throw new NotFoundException();return row;
}
const start=(v:unknown)=>{const n=Number(v??0);if(!Number.isSafeInteger(n)||n<0||n>MAX)throw new BadRequestException();return n;};
function version(v:unknown,zero=false){if(!Number.isSafeInteger(v)||Number(v)<(zero?0:1)||Number(v)>MAX)throw new BadRequestException();return Number(v);}
export class OperatingFinance{
 constructor(private readonly db:StudioDatabase){}
 private async write(who:Identity,operation:string,target:string|null,key:string,body:unknown,fn:(tx:TransactionSql,actor:string)=>Promise<any>){
  const hash=createHash('sha256').update(JSON.stringify(canonical({operation,target,body}))).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'operating-finance-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT operation,target_id,request_hash,result FROM studio_os.operating_finance_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.operation!==operation||old.target_id!==target||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他收支内容');return old.result;}
   const result=await fn(tx,actor.username);
   await tx`INSERT INTO studio_os.operating_finance_receipts(actor_id,request_key,operation,target_id,request_hash,result) VALUES(${who.id},${key},${operation},${target},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('该店铺同类来源编号或关联支出已登记，作废记录仍保留原来源');throw e;}
 }
 async list(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month','kind','storeId','status','q','offset']);
  const month=q.month?attendanceMonth(q.month):null,kind=q.kind??'all',status=q.status??'active',store=q.storeId?uuid(q.storeId):null,offset=start(q.offset),search=q.q?shortText(q.q,100):'';
  if(!['all','sale','refund','fee'].includes(String(kind))||typeof kind!=='string'||!['all','active','void'].includes(String(status))||typeof status!=='string')throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const where=tx`(${month}::text IS NULL OR to_char(v.business_date,'YYYY-MM')=${month}) AND (${store}::uuid IS NULL OR r.store_id=${store})
    AND (${kind}='all' OR r.kind=${kind}) AND (${status}='all' OR v.status=${status}) AND strpos(lower(concat_ws(' ',r.source_reference,v.description,s.name)),lower(${search}))>0`;
   const joins=tx`FROM studio_os.operating_finance_records r JOIN studio_os.stores s ON s.id=r.store_id
    JOIN LATERAL(SELECT * FROM studio_os.operating_finance_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true LEFT JOIN studio_os.expense_records e ON e.id=r.expense_id`;
   const rows=await tx`SELECT ${tx.unsafe(projection)} ${joins} WHERE ${where} ORDER BY v.business_date DESC,r.created_at DESC,r.id LIMIT 50 OFFSET ${offset}`;
   const [summary]=await tx`SELECT count(*)::int AS total,
    coalesce(sum(v.amount_cents) FILTER(WHERE v.status='active' AND r.kind='sale'),0)::text AS "saleCents",
    coalesce(sum(v.amount_cents) FILTER(WHERE v.status='active' AND r.kind='refund'),0)::text AS "refundCents",
    coalesce(sum(v.amount_cents) FILTER(WHERE v.status='active' AND r.kind='fee'),0)::text AS "feeCents",
    count(*) FILTER(WHERE v.status='active' AND coalesce(e.version<>(v.expense_snapshot->>'version')::int,false))::int AS "changedSources" ${joins} WHERE ${where}`;
   const stores=await tx`SELECT id,name,active FROM studio_os.stores ORDER BY active DESC,name,id`;
   return {rows,total:summary.total,offset,limit:50,summary,stores};
  });
 }
 async detail(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['offset']),offset=start(q.offset);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [record]=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.operating_finance_records r JOIN studio_os.stores s ON s.id=r.store_id
    JOIN LATERAL(SELECT * FROM studio_os.operating_finance_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true
    LEFT JOIN studio_os.expense_records e ON e.id=r.expense_id WHERE r.id=${id}`;
   if(!record)throw new NotFoundException();
   const history=await tx`SELECT version,business_date::text AS "businessDate",amount_cents AS "amountCents",description,note,reason,status,parent_snapshot AS "parentSnapshot",expense_snapshot AS "expenseSnapshot",actor_name AS actor,created_at AS "createdAt" FROM studio_os.operating_finance_versions WHERE record_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.operating_finance_versions WHERE record_id=${id}`;
   const parent=record.parentId?await latest(tx,record.parentId):null;
   const [refunded]=await tx`SELECT coalesce(sum(v.amount_cents),0)::text AS cents FROM studio_os.operating_finance_records r
    JOIN LATERAL(SELECT * FROM studio_os.operating_finance_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true WHERE r.parent_id=${id} AND v.status='active'`;
   return {record,history:{rows:history,total:count.total,offset,limit:50},refundedCents:refunded.cents,parent:parent?{id:parent.id,version:parent.version,businessDate:parent.day,amountCents:parent.amount_cents,description:parent.description,status:parent.status}:null,
    parentChanged:!!parent&&parent.version!==record.parentSnapshot?.version};
  });
 }
 async save(who:Identity,id:string|null,value:unknown){
  if(id)id=uuid(id);
  const b=objectInput(value,id?['requestKey','expectedVersion','businessDate','amount','description','note','reason','parentVersion','expenseVersion']:['requestKey','kind','storeId','parentId','expenseId','sourceReference','businessDate','amount','description','note','reason','parentVersion','expenseVersion']);
  const key=uuid(b.requestKey),day=purchaseDay(b.businessDate),amount=optionalMoney(b.amount),description=shortText(b.description,500),reason=longText(b.reason,2000).trim(),note=typeof b.note==='string'&&!b.note.trim()?'':longText(b.note,2000),expected=id?version(b.expectedVersion):0;
  if(amount===null||amount<=0||!reason||expected>=MAX)throw new BadRequestException('请填写实际金额和登记依据');
  const input=id?null:{kind:b.kind,storeId:uuid(b.storeId),parentId:b.parentId===null?null:uuid(b.parentId),expenseId:b.expenseId===null?null:uuid(b.expenseId),sourceReference:shortText(b.sourceReference,200)};
  if(input&&(typeof input.kind!=='string'||!['sale','refund','fee'].includes(input.kind)||(input.kind==='refund')!==(input.parentId!==null)||input.expenseId&&input.kind!=='fee'))throw new BadRequestException();
  return this.write(who,id?'revise':'create',id,key,b,async(tx,actor)=>{
   const identity=id?await latest(tx,id):{kind:input!.kind as string,store_id:input!.storeId,parent_id:input!.parentId,expense_id:input!.expenseId};
   const root=identity.parent_id??id;
   if(root)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'operating-finance-root:'+root},0))`;
   const old=id?await latest(tx,id):null;
   if(old&&(old.version!==expected||old.status!=='active'))throw new ConflictException('记录已变化或已作废，请重新核对');
   const [store]=await tx`SELECT id,active FROM studio_os.stores WHERE id=${identity.store_id} FOR SHARE`;
   if(!store||!id&&!store.active&&identity.kind!=='refund')throw new ConflictException('请选择启用的业务店铺');
   let parent=null;
   if(identity.parent_id){parent=await latest(tx,identity.parent_id);
    if(parent.kind!=='sale'||parent.store_id!==identity.store_id||parent.status!=='active'||parent.version!==version(b.parentVersion))throw new ConflictException('原销售记录已变化或不属于该店铺');
    if(day<parent.day)throw new BadRequestException('退款日期不能早于原销售日期');
   }else if(b.parentVersion!==null)throw new BadRequestException();
   const base=identity.kind==='sale'?id:identity.parent_id;
   if(base){const [total]=await tx`SELECT coalesce(sum(v.amount_cents),0)::text AS cents FROM studio_os.operating_finance_records r
     JOIN LATERAL(SELECT * FROM studio_os.operating_finance_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true
     WHERE r.parent_id=${base} AND v.status='active' AND (${id}::uuid IS NULL OR r.id<>${id})`;
    if(BigInt(total.cents)+(identity.kind==='refund'?BigInt(amount):0n)>BigInt(parent?.amount_cents??amount))throw new ConflictException('有效退款合计不能超过原销售金额');
    if(identity.kind==='sale'){const [earliest]=await tx`SELECT min(v.business_date)::text AS day FROM studio_os.operating_finance_records r
      JOIN LATERAL(SELECT * FROM studio_os.operating_finance_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true WHERE r.parent_id=${id} AND v.status='active'`;
     if(earliest.day&&day>earliest.day)throw new ConflictException('销售日期不能晚于关联的有效退款');}
   }
   const expense=identity.expense_id?await purchaseExpense(tx,identity.expense_id,true):null;
   if(expense){if(expense.version!==version(b.expenseVersion)||expense.amountCents!==amount)throw new ConflictException('引用支出时，手续费金额须与当前支出金额一致');}
   else if(b.expenseVersion!==null)throw new BadRequestException();
   let recordId=id;
   if(!recordId){const [created]=await tx`INSERT INTO studio_os.operating_finance_records(kind,store_id,parent_id,expense_id,source_reference,actor_id)
     VALUES(${identity.kind},${identity.store_id},${identity.parent_id},${identity.expense_id},${input!.sourceReference},${who.id}) RETURNING id`;recordId=created.id;}
   const snapshot=parent?{id:parent.id,version:parent.version,businessDate:parent.day,amountCents:parent.amount_cents,description:parent.description}:null;
   await tx`INSERT INTO studio_os.operating_finance_versions(record_id,version,business_date,amount_cents,description,note,reason,status,parent_snapshot,expense_snapshot,actor_id,actor_name)
    VALUES(${recordId},${expected+1},${day},${amount},${description},${note},${reason},'active',${snapshot?JSON.stringify(snapshot):null}::jsonb,${expense?JSON.stringify(expense):null}::jsonb,${who.id},${actor})`;
   return {id:recordId,version:expected+1};
  });
 }
 async void(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','reason']),key=uuid(b.requestKey),expected=version(b.expectedVersion),reason=longText(b.reason,2000).trim();if(!reason||expected>=MAX)throw new BadRequestException();
  return this.write(who,'void',id,key,b,async(tx,actor)=>{
   const initial=await latest(tx,id);await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'operating-finance-root:'+(initial.parent_id??id)},0))`;
   const old=await latest(tx,id);if(old.version!==expected||old.status!=='active')throw new ConflictException('记录已变化或已作废');
   if(old.kind==='sale'&&(await tx`SELECT r.id FROM studio_os.operating_finance_records r JOIN LATERAL(SELECT status FROM studio_os.operating_finance_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true WHERE r.parent_id=${id} AND v.status='active'`).length)throw new ConflictException('请先核对并作废关联的有效退款');
   await tx`INSERT INTO studio_os.operating_finance_versions(record_id,version,business_date,amount_cents,description,note,reason,status,parent_snapshot,expense_snapshot,actor_id,actor_name)
    VALUES(${id},${expected+1},${old.day},${old.amount_cents},${old.description},${old.note},${reason},'void',${old.parent_snapshot?JSON.stringify(old.parent_snapshot):null}::jsonb,${old.expense_snapshot?JSON.stringify(old.expense_snapshot):null}::jsonb,${who.id},${actor})`;
   return {id,version:expected+1};
  });
 }
 async receipt(who:Identity,key:string,operation:string,target:string|null){
  await currentPermission(this.db,who,'finance');key=uuid(key);if(target)target=uuid(target);
  if(!['create','revise','void'].includes(operation)||(operation==='create')!==(target===null))throw new BadRequestException();
  const [row]=await this.db.client`SELECT result FROM studio_os.operating_finance_receipts WHERE actor_id=${who.id} AND request_key=${key} AND operation=${operation} AND target_id IS NOT DISTINCT FROM ${target}::uuid`;
  if(!row)throw new NotFoundException();return row.result;
 }
}
