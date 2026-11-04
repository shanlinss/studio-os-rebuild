import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,version,shortText,longText} from './validation';
import {purchaseDay,purchaseExpense} from './equipment-purchase';
import {optionalMoney} from './money';
const MAX=2147483647;
const projection=`v.id,v.version,v.stock_correction_version AS "stockCorrectionVersion",v.purchase_date::text AS "purchaseDate",v.supplier,v.goods_cents AS "goodsCents",
 v.additional_cents AS "additionalCents",v.total_cents AS "totalCents",v.expense_id AS "expenseId",v.expense_snapshot AS "expenseSnapshot",
 v.reason,v.actor_name AS actor,v.created_at AS "createdAt",
 (SELECT jsonb_agg(jsonb_build_object('movementId',l.movement_id,'quantity',l.quantity,'unitCents',l.unit_cents,'goodsCents',l.goods_cents,
  'additionalCents',l.additional_cents,'totalCents',l.total_cents,'snapshot',l.item_snapshot) ORDER BY l.movement_id)
  FROM studio_os.product_purchase_lines l WHERE l.version_id=v.id) AS lines`;
async function inbound(tx:TransactionSql,id:string,readOnly=false):Promise<{id:string,businessDate:string,sourceReference:string,status:string,correctionVersion:number,lines:{id:string,quantity:number,snapshot:any}[]}>{
 const [document]=await tx`SELECT id,business_date::text AS "businessDate",source_reference AS "sourceReference",status,correction_version AS "correctionVersion" FROM studio_os.product_stock_effective_documents WHERE id=${id} AND operation='inbound'`;
 if(!document)throw new NotFoundException('请引用已保存的商品入库单');if(!readOnly&&document.status!=='active')throw new ConflictException('该入库单已作废，原采购金额保留历史，不能继续确认成本');
 const lines=await tx`SELECT id,quantity,item_snapshot AS snapshot FROM studio_os.product_stock_cost_movements WHERE product_stock_document_id=${id} ORDER BY id`;
 return {...document,lines} as unknown as {id:string,businessDate:string,sourceReference:string,status:string,correctionVersion:number,lines:{id:string,quantity:number,snapshot:any}[]};
}
function canonical(value:unknown):unknown {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)]));
 return value;
}
export class ProductPurchases {
 constructor(private readonly db:StudioDatabase){}
 async state(who:Identity,id:string){
  await currentPermission(this.db,who,'finance');id=uuid(id);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const document=await inbound(tx,id,true);
   const [batch]=await tx`SELECT id,code FROM studio_os.product_purchase_batches WHERE inbound_document_id=${id}`;
   const [record]=batch?await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.product_purchase_versions v WHERE v.batch_id=${batch.id} ORDER BY v.version DESC LIMIT 1`:[];
   const expense=record?.expenseId?await purchaseExpense(tx,record.expenseId):null;
   return {document,batch:batch??null,record:record??null,linkedExpense:expense,sourceChanged:document.status==='void'||!!record&&record.stockCorrectionVersion!==document.correctionVersion||!!expense&&expense.version!==record.expenseSnapshot.version};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);
  const b=objectInput(value,['requestKey','expectedVersion','code','purchaseDate','supplier','expenseId','expenseVersion','reason','lines','stockCorrectionVersion']);
  const key=uuid(b.requestKey),code=shortText(b.code,64),date=purchaseDay(b.purchaseDate),supplier=shortText(b.supplier,150),reason=longText(b.reason,2000);
  if(!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||Number(b.expectedVersion)>MAX||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)throw new BadRequestException();
  const expenseId=b.expenseId===null?null:uuid(b.expenseId),expenseVersion=expenseId?version(b.expenseVersion):null;
  if(!expenseId&&b.expenseVersion!==null)throw new BadRequestException();
  const lines=b.lines.map(value=>{
   const line=objectInput(value,['movementId','unitPrice','additionalAmount']),unit=optionalMoney(line.unitPrice),additional=optionalMoney(line.additionalAmount);
   if(unit===null||additional===null)throw new BadRequestException('请明确采购单价和附加费用，确认免费或无附加费用时填写零');
   return {movementId:uuid(line.movementId),unit,additional};
  });
  if(new Set(lines.map(line=>line.movementId)).size!==lines.length)throw new BadRequestException('入库明细不能重复');
  const hash=createHash('sha256').update(JSON.stringify({id,body:canonical(b)})).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'product-purchase:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT inbound_document_id,request_hash,result FROM studio_os.product_purchase_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.inbound_document_id!==id||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他采购内容');return old.result;}
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'product-stock-document:'+id},0))`;
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'product-purchase-document:'+id},0))`;
   const document=await inbound(tx,id);
   if((b.stockCorrectionVersion??0)!==document.correctionVersion)throw new ConflictException('入库单数量或业务事实已更正，请重新核对采购金额');
   const byId=new Map(document.lines.map(line=>[line.id,line]));
   if(lines.length!==document.lines.length||lines.some(line=>!byId.has(line.movementId)))throw new BadRequestException('采购成本须覆盖该入库单的全部原明细');
   let [batch]=await tx`SELECT id,code FROM studio_os.product_purchase_batches WHERE inbound_document_id=${id}`;
   const [latest]=batch?await tx`SELECT version FROM studio_os.product_purchase_versions WHERE batch_id=${batch.id} ORDER BY version DESC LIMIT 1`:[];
   if((latest?.version??0)!==b.expectedVersion)throw new ConflictException('采购资料已变化，请重新核对');
   if(batch&&batch.code!==code)throw new ConflictException('采购批次编号保持固定');
   const priced=lines.map(line=>{
    const original=byId.get(line.movementId)!,goods=BigInt(original.quantity)*BigInt(line.unit),total=goods+BigInt(line.additional);
    if(total>BigInt(MAX))throw new BadRequestException('采购金额超过容量');
    return {...line,quantity:original.quantity,snapshot:original.snapshot,goods:Number(goods),total:Number(total)};
   });
   const goods=priced.reduce((sum,line)=>sum+line.goods,0),additional=priced.reduce((sum,line)=>sum+line.additional,0);
   if(goods+additional>MAX)throw new BadRequestException('采购合计金额超过容量');
   const expense=expenseId?await purchaseExpense(tx,expenseId,true):null;
   if(expense&&expense.version!==expenseVersion)throw new ConflictException('关联支出已变化，请重新核对');
   if(!batch)[batch]=await tx`INSERT INTO studio_os.product_purchase_batches(inbound_document_id,code) VALUES(${id},${code}) RETURNING id,code`;
   if(expenseId){
    await tx`INSERT INTO studio_os.product_purchase_expenses(expense_id,batch_id) VALUES(${expenseId},${batch.id}) ON CONFLICT(expense_id) DO NOTHING`;
    const [owner]=await tx`SELECT batch_id FROM studio_os.product_purchase_expenses WHERE expense_id=${expenseId}`;
    if(owner.batch_id!==batch.id)throw new ConflictException('该支出已引用到其他商品采购批次');
   }
   const [record]=await tx`INSERT INTO studio_os.product_purchase_versions(batch_id,version,purchase_date,supplier,goods_cents,additional_cents,total_cents,
    expense_id,expense_snapshot,reason,actor_id,actor_name,stock_correction_version) VALUES(${batch.id},${Number(b.expectedVersion)+1},${date},${supplier},${goods},${additional},${goods+additional},
    ${expenseId},${expense?JSON.stringify(expense):null}::jsonb,${reason},${who.id},${actor.username},${document.correctionVersion}) RETURNING id,version`;
   for(const line of priced)await tx`INSERT INTO studio_os.product_purchase_lines(version_id,movement_id,quantity,unit_cents,goods_cents,additional_cents,total_cents,item_snapshot)
    VALUES(${record.id},${line.movementId},${line.quantity},${line.unit},${line.goods},${line.additional},${line.total},${JSON.stringify(line.snapshot)}::jsonb)`;
   const result={id,batchId:batch.id,recordId:record.id,version:record.version};
   await tx`INSERT INTO studio_os.product_purchase_receipts(actor_id,request_key,inbound_document_id,request_hash,result) VALUES(${who.id},${key},${id},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });}catch(error){if((error as {code?:string}).code==='23505')throw new ConflictException('采购批次编号或来源已被使用');throw error;}
 }
 async history(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);
  const b=objectInput(value,['offset']),offset=Number(b.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.product_purchase_versions v JOIN studio_os.product_purchase_batches b ON b.id=v.batch_id
    WHERE b.inbound_document_id=${id} ORDER BY v.version DESC LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.product_purchase_versions v JOIN studio_os.product_purchase_batches b ON b.id=v.batch_id WHERE b.inbound_document_id=${id}`;
   return {rows,total:count.total,offset,limit:50};
  });
 }
 async receipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'finance');await currentPermission(this.db,who,'resources');id=uuid(id);key=uuid(key);
  const [row]=await this.db.client`SELECT result FROM studio_os.product_purchase_receipts WHERE actor_id=${who.id} AND inbound_document_id=${id} AND request_key=${key}`;
  if(!row)throw new NotFoundException();return row.result;
 }
}
