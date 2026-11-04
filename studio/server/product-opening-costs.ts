import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,longText} from './validation';
import {optionalMoney} from './money';
const MAX=2147483647;
const projection=`v.id,v.version,v.total_cents AS "totalCents",v.source_reference AS "sourceReference",v.reason,v.actor_name AS actor,v.created_at AS "createdAt",
 (SELECT jsonb_agg(jsonb_build_object('movementId',l.movement_id,'quantity',l.quantity,'totalCents',l.total_cents,'snapshot',l.item_snapshot) ORDER BY l.movement_id)
 FROM studio_os.product_opening_cost_lines l WHERE l.version_id=v.id) AS lines`;
async function source(tx:TransactionSql,id:string,lock=false){
 const [sku]=await tx`SELECT k.id,k.code,w.id AS "itemId",w.name,w.unit FROM studio_os.product_skus k
  JOIN studio_os.warehouse_items w ON w.id=k.warehouse_item_id WHERE k.id=${id} ${lock?tx`FOR SHARE OF k,w`:tx``}`;
 if(!sku)throw new NotFoundException();
 const lines=await tx`SELECT m.id,m.quantity,m.item_snapshot AS snapshot,(m.created_at AT TIME ZONE 'Asia/Shanghai')::date::text AS day
  FROM studio_os.warehouse_movements m WHERE m.item_id=${sku.itemId} AND m.type='opening' AND m.quantity>0
  AND NOT(m.packaging_balance_id IS NOT NULL AND EXISTS(SELECT 1 FROM studio_os.warehouse_movements old
   WHERE old.item_id=m.item_id AND old.type='opening' AND old.packaging_balance_id IS NULL)) ORDER BY m.id`;
 return {sku,lines};
}
export class ProductOpeningCosts{
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string){
  await currentPermission(this.db,who,'finance');id=uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const data=await source(tx,id);
   const [record]=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.product_opening_cost_versions v WHERE v.item_id=${data.sku.itemId} ORDER BY v.version DESC LIMIT 1`;
   return {...data,record:record??null};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','sourceReference','reason','lines']),key=uuid(b.requestKey);
  const reference=shortText(b.sourceReference,200),reason=longText(b.reason,2000).trim();
  if(!reason||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||Number(b.expectedVersion)>=MAX||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)throw new BadRequestException();
  const lines=b.lines.map(value=>{const line=objectInput(value,['movementId','amount']),cents=optionalMoney(line.amount);
   if(cents===null)throw new BadRequestException('请填写有依据的期初总成本，确认零成本时填写 0');return {movementId:uuid(line.movementId),cents};
  }).sort((a,b)=>a.movementId.localeCompare(b.movementId));
  if(new Set(lines.map(line=>line.movementId)).size!==lines.length)throw new BadRequestException('期初明细不能重复');
  const total=lines.reduce((sum,line)=>sum+line.cents,0);if(total>MAX)throw new BadRequestException('期初成本超过容量');
  const hash=createHash('sha256').update(JSON.stringify({id,expectedVersion:b.expectedVersion,reference,reason,lines})).digest('hex');
  return this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'opening-cost-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT sku_id,request_hash,result FROM studio_os.product_opening_cost_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.sku_id!==id||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他期初成本');return old.result;}
   const data=await source(tx,id,true);
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'opening-cost-item:'+data.sku.itemId},0))`;
   if(lines.length!==data.lines.length||lines.some(line=>!data.lines.some(original=>original.id===line.movementId)))throw new BadRequestException('须覆盖全部原始非零期初明细，不能引用分账复制或其他流水');
   const [latest]=await tx`SELECT version FROM studio_os.product_opening_cost_versions WHERE item_id=${data.sku.itemId} ORDER BY version DESC LIMIT 1`;
   if((latest?.version??0)!==b.expectedVersion)throw new ConflictException('期初成本依据已变化，请重新核对');
   const [record]=await tx`INSERT INTO studio_os.product_opening_cost_versions(item_id,version,total_cents,source_reference,reason,actor_id,actor_name)
    VALUES(${data.sku.itemId},${Number(b.expectedVersion)+1},${total},${reference},${reason},${who.id},${actor.username}) RETURNING id,version`;
   for(const line of lines){const original=data.lines.find(row=>row.id===line.movementId)!;
    await tx`INSERT INTO studio_os.product_opening_cost_lines(version_id,movement_id,quantity,total_cents,item_snapshot)
     VALUES(${record.id},${line.movementId},${original.quantity},${line.cents},${JSON.stringify(original.snapshot)}::jsonb)`;
   }
   const result={id,recordId:record.id,version:record.version};
   await tx`INSERT INTO studio_os.product_opening_cost_receipts(actor_id,request_key,sku_id,request_hash,result)
    VALUES(${who.id},${key},${id},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });
 }
 async history(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['offset']),offset=Number(q.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const {sku}=await source(tx,id);
   const rows=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.product_opening_cost_versions v WHERE v.item_id=${sku.itemId} ORDER BY v.version DESC LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.product_opening_cost_versions WHERE item_id=${sku.itemId}`;
   return {rows,total:count.total,offset,limit:50};
  });
 }
 async receipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'finance');await currentPermission(this.db,who,'resources');id=uuid(id);key=uuid(key);
  const [row]=await this.db.client`SELECT result FROM studio_os.product_opening_cost_receipts WHERE actor_id=${who.id} AND sku_id=${id} AND request_key=${key}`;
  if(!row)throw new NotFoundException();return row.result;
 }
}
