import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,longText} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {optionalMoney} from './money';
export const incomeProjection=`id,version,amount_cents AS "amountCents",source_reference AS "sourceReference",reason,status,actor_name AS actor,created_at AS "createdAt"`;
export class StoreMonthIncome{
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['month','offset']),month=attendanceMonth(q.month),offset=Number(q.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [store]=await tx`SELECT id,name,active FROM studio_os.stores WHERE id=${id}`;if(!store)throw new NotFoundException();
   const [record]=await tx`SELECT ${tx.unsafe(incomeProjection)} FROM studio_os.store_month_income_versions WHERE store_id=${id} AND month=${month} ORDER BY version DESC LIMIT 1`;
   const rows=await tx`SELECT ${tx.unsafe(incomeProjection)} FROM studio_os.store_month_income_versions WHERE store_id=${id} AND month=${month} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.store_month_income_versions WHERE store_id=${id} AND month=${month}`;
   return {store,month,record:record??null,history:{rows,total:count.total,offset,limit:50}};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','month','amount','sourceReference','reason','status']),key=uuid(b.requestKey),month=attendanceMonth(b.month),reference=shortText(b.sourceReference,200),reason=longText(b.reason,2000);
  if(typeof b.amount!=='string')throw new BadRequestException();const negative=b.amount.startsWith('-'),absolute=optionalMoney(negative?b.amount.slice(1):b.amount);
  if(absolute===null||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||Number(b.expectedVersion)>=2147483647||typeof b.status!=='string'||!['confirmed','withdrawn'].includes(b.status))throw new BadRequestException();
  const amount=negative?-absolute:absolute,hash=createHash('sha256').update(JSON.stringify({id,month,expected:b.expectedVersion,amount,reference,reason,status:b.status})).digest('hex');
  return this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'month-income-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT store_id,month,request_hash,result FROM studio_os.store_month_income_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.store_id!==id||old.month!==month||old.request_hash!==hash)throw new ConflictException();return old.result;}
   if(!(await tx`SELECT id FROM studio_os.stores WHERE id=${id} FOR SHARE`).length)throw new NotFoundException();
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'month-income:'+id+':'+month},0))`;
   const [latest]=await tx`SELECT version,amount_cents,status FROM studio_os.store_month_income_versions WHERE store_id=${id} AND month=${month} ORDER BY version DESC LIMIT 1`;
   if((latest?.version??0)!==b.expectedVersion)throw new ConflictException('该店铺本月收入已有新版本，请重新核对');
   if(b.status==='withdrawn'&&(!latest||latest.status!=='confirmed'||latest.amount_cents!==amount))throw new ConflictException('撤回时保留原确认金额，需引用当前有效确认');
   const [r]=await tx`INSERT INTO studio_os.store_month_income_versions(store_id,month,version,amount_cents,source_reference,reason,status,actor_id,actor_name)
    VALUES(${id},${month},${Number(b.expectedVersion)+1},${amount},${reference},${reason},${String(b.status)},${who.id},${actor.username}) RETURNING id,version`;
   const result={id,month,recordId:r.id,version:r.version};
   await tx`INSERT INTO studio_os.store_month_income_receipts(actor_id,request_key,store_id,month,request_hash,result) VALUES(${who.id},${key},${id},${month},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });
 }
 async receipt(who:Identity,id:string,key:string,month:string){
  await currentPermission(this.db,who,'finance');id=uuid(id);key=uuid(key);month=attendanceMonth(month);
  const [r]=await this.db.client`SELECT result FROM studio_os.store_month_income_receipts WHERE actor_id=${who.id} AND request_key=${key} AND store_id=${id} AND month=${month}`;
  if(!r)throw new NotFoundException();return r.result;
 }
}
