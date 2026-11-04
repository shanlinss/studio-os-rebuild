import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,longText} from './validation';
import {optionalMoney} from './money';
import {attendanceMonth} from './attendance-monthly';
export const referenceProjection=`id,version,effective_month AS "effectiveMonth",unit_cents AS "unitCents",fulfillment_mode AS "fulfillmentMode",source_reference AS "sourceReference",reason,actor_name AS actor,created_at AS "createdAt"`;
export async function referenceAt(tx:TransactionSql,sku:string,month:string){const [r]=await tx`SELECT ${tx.unsafe(referenceProjection)} FROM studio_os.product_reference_costs WHERE sku_id=${sku} AND effective_month<=${month} ORDER BY effective_month DESC,version DESC LIMIT 1`;return r??null;}
export async function costSku(tx:TransactionSql,id:string,lock=false){const [r]=await tx`SELECT k.id,k.code,k.unit,k.specification,k.active,p.name,p.active AS "productActive" FROM studio_os.product_skus k JOIN studio_os.products p ON p.id=k.product_id WHERE k.id=${id} ${lock?tx`FOR SHARE OF k,p`:tx``}`;if(!r)throw new NotFoundException();return r;}
export class ProductReferenceCosts{
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['month','offset']),month=attendanceMonth(q.month),offset=Number(q.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const sku=await costSku(tx,id),current=await referenceAt(tx,id,month);
   const rows=await tx`SELECT ${tx.unsafe(referenceProjection)} FROM studio_os.product_reference_costs WHERE sku_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total,coalesce(max(version),0)::int AS version FROM studio_os.product_reference_costs WHERE sku_id=${id}`;
   return {sku,month,current,version:count.version,history:{rows,total:count.total,offset,limit:50}};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','effectiveMonth','unitPrice','fulfillmentMode','sourceReference','reason']);
  const key=uuid(b.requestKey),month=attendanceMonth(b.effectiveMonth),unit=optionalMoney(b.unitPrice),reference=shortText(b.sourceReference,200),reason=longText(b.reason,2000).trim();
  if(!reason||typeof b.fulfillmentMode!=='string'||!['stocked','dropship'].includes(b.fulfillmentMode)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||Number(b.expectedVersion)>=2147483647)throw new BadRequestException();
  const hash=createHash('sha256').update(JSON.stringify({id,expected:b.expectedVersion,month,unit,mode:b.fulfillmentMode,reference,reason})).digest('hex');
  return this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'reference-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT sku_id,request_hash,result FROM studio_os.product_reference_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.sku_id!==id||old.request_hash!==hash)throw new ConflictException();return old.result;}
   await costSku(tx,id,true);await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'reference-sku:'+id},0))`;
   const [latest]=await tx`SELECT coalesce(max(version),0)::int AS version FROM studio_os.product_reference_costs WHERE sku_id=${id}`;
   if(latest.version!==b.expectedVersion)throw new ConflictException('参考成本已变化，请重新核对');
   const [r]=await tx`INSERT INTO studio_os.product_reference_costs(sku_id,version,effective_month,unit_cents,fulfillment_mode,source_reference,reason,actor_id,actor_name)
    VALUES(${id},${latest.version+1},${month},${unit},${String(b.fulfillmentMode)},${reference},${reason},${who.id},${actor.username}) RETURNING id,version`;
   const result={id,recordId:r.id,version:r.version};
   await tx`INSERT INTO studio_os.product_reference_receipts(actor_id,request_key,sku_id,request_hash,result) VALUES(${who.id},${key},${id},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });
 }
 async receipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'finance');await currentPermission(this.db,who,'resources');id=uuid(id);key=uuid(key);
  const [r]=await this.db.client`SELECT result FROM studio_os.product_reference_receipts WHERE actor_id=${who.id} AND sku_id=${id} AND request_key=${key}`;
  if(!r)throw new NotFoundException();return r.result;
 }
}
