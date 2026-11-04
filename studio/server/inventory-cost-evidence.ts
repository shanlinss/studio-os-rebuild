import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,longText} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {optionalMoney} from './money';
import {purchaseExpense} from './equipment-purchase';
import {inventoryCostSources,priceInventorySources,roundedCost} from './inventory-cost-sources';
const MAX=2147483647;
const projection=`id,version,mode,amount_cents AS "amountCents",scope,store_id AS "storeId",expense_id AS "expenseId",expense_snapshot AS "expenseSnapshot",source_reference AS "sourceReference",reason,movement_snapshot AS "movementSnapshot",actor_name AS actor,created_at AS "createdAt"`;
const page=(v:unknown)=>{const n=Number(v??0);if(!Number.isSafeInteger(n)||n<0||n>MAX)throw new BadRequestException();return n;};
function publicRow(r:any){return {id:r.id,itemId:r.itemId,kind:r.kind,mode:r.mode,type:r.type,quantity:r.quantity,delta:r.delta,day:r.day,snapshot:r.snapshot,actualSkuId:r.actualSkuId??null,productDocumentId:r.productDocumentId??null,consumptionId:r.consumptionId??null,usedStoreId:r.usedStoreId??null,packagingPurchaseId:r.packagingPurchaseId??null,purchaseSourceVersion:r.purchaseSourceVersion??null,costCents:roundedCost(r.priced?.exactCost??null),sourceChanged:r.sourceChanged,attributionVersion:r.attributionVersion??null};}
export class InventoryCostEvidence{
 constructor(private readonly db:StudioDatabase){}
 async list(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month','kind','mode','q','offset']),month=attendanceMonth(q.month),offset=page(q.offset),kind=q.kind??'all',mode=q.mode??'all',search=q.q?shortText(q.q,100).toLowerCase():'';
  if(!['all','product','packaging'].includes(String(kind))||typeof kind!=='string'||!['all','basis','outflow','automatic','external','asset'].includes(String(mode))||typeof mode!=='string')throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=priceInventorySources(await inventoryCostSources(tx),month).filter(r=>r.mode!=='excluded'&&(kind==='all'||r.kind===kind)&&(mode==='all'||r.mode===mode)&&JSON.stringify(r.snapshot).toLowerCase().includes(search)).sort((a,b)=>b.day.localeCompare(a.day)||b.postedAt.localeCompare(a.postedAt)||a.id.localeCompare(b.id));
   return {rows:rows.slice(offset,offset+50).map(publicRow),total:rows.length,offset,limit:50,month};
  });
 }
 async state(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['offset']),offset=page(q.offset);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [item]=await tx`SELECT item_id FROM studio_os.warehouse_movements WHERE id=${id}`;if(!item)throw new NotFoundException();
   const rows=await inventoryCostSources(tx,item.item_id),source=rows.find(r=>r.id===id);if(!source)throw new NotFoundException();
   const priced=priceInventorySources(rows,source.day.slice(0,7)).find(r=>r.id===id)!;
   const [record]=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.inventory_cost_evidence_versions WHERE movement_id=${id} ORDER BY version DESC LIMIT 1`;
   const history=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.inventory_cost_evidence_versions WHERE movement_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.inventory_cost_evidence_versions WHERE movement_id=${id}`;
   const stores=await tx`SELECT id,name,active FROM studio_os.stores ORDER BY name,id`;
   return {source:publicRow(priced),record:record??null,stores,history:{rows:history,total:count.total,offset,limit:50}};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','amount','scope','storeId','expenseId','expenseVersion','purchaseSourceVersion','sourceReference','reason']);
  const key=uuid(b.requestKey),expected=Number(b.expectedVersion),amount=optionalMoney(b.amount),store=b.storeId===null?null:uuid(b.storeId),expenseId=b.expenseId===null?null:uuid(b.expenseId),reference=shortText(b.sourceReference,200),reason=longText(b.reason,2000);
  if(!Number.isSafeInteger(b.expectedVersion)||expected<0||expected>=MAX)throw new BadRequestException();
  const hash=createHash('sha256').update(JSON.stringify({id,expected,amount,scope:b.scope,store,expenseId,expenseVersion:b.expenseVersion,purchaseSourceVersion:b.purchaseSourceVersion,reference,reason})).digest('hex');
  return this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');
   const [movement]=await tx`SELECT item_id FROM studio_os.warehouse_movements WHERE id=${id}`;if(!movement)throw new NotFoundException();
   const rows=await inventoryCostSources(tx,movement.item_id),source=rows.find(r=>r.id===id);if(!source)throw new NotFoundException();
   if(!['basis','outflow'].includes(source.mode))throw new ConflictException('该流水沿用原单据成本或自动领用归属，不能在此重复登记');
   if(source.mode==='basis')await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'inventory-evidence-request:'+who.id+':'+key},0))`;
   const [receipt]=await tx`SELECT movement_id,request_hash,result FROM studio_os.inventory_cost_evidence_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(receipt){if(receipt.movement_id!==id||receipt.request_hash!==hash)throw new ConflictException();return receipt.result;}
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'inventory-evidence-movement:'+id},0))`;
   const [latest]=await tx`SELECT version FROM studio_os.inventory_cost_evidence_versions WHERE movement_id=${id} ORDER BY version DESC LIMIT 1`;
   if((latest?.version??0)!==expected)throw new ConflictException('成本依据或归属已有新版本');
   if(source.mode==='basis'){
    if(amount===null||b.scope!==null||store!==null)throw new BadRequestException('本次增加库存须填写总成本，不登记费用归属');
    if(source.packagingPurchaseId&&expenseId)throw new BadRequestException('已有采购来源保持原关联，无需另选支出');
    if((source.purchaseSourceVersion??null)!==b.purchaseSourceVersion)throw new ConflictException('原采购支出版本已变化');
    if(source.purchaseExpenseId){const locked=await purchaseExpense(tx,source.purchaseExpenseId,true);if(locked.version!==b.purchaseSourceVersion)throw new ConflictException('原采购支出版本已变化');}
   }else if(b.amount!==null||typeof b.scope!=='string'||!['public','store','unclassified'].includes(b.scope)||b.scope==='public'&&store!==null||b.scope==='store'&&!store||b.purchaseSourceVersion!==null)throw new BadRequestException('出库只核对归属，成本按原库存依据自动计算');
   if(store&&!(await tx`SELECT id FROM studio_os.stores WHERE id=${store} FOR SHARE`).length)throw new BadRequestException();
   if(expenseId)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'inventory-sample-cost-expense:'+expenseId},0))`;
   const expense=expenseId?await purchaseExpense(tx,expenseId,true):null;
   if(expense){
    if(expense.version!==b.expenseVersion)throw new ConflictException('引用支出已变化');
    const [classification]=await tx`SELECT expense_scope,expense_use,store_id FROM studio_os.expense_records WHERE id=${expenseId}`;
    if(source.mode==='basis'){if(classification.expense_use!=='inventory'||expense.amountCents!==amount)throw new ConflictException('入库依据引用整笔库存采购支出，请先核对用途和金额');}
    else {if(!expense.expenseDate.startsWith(source.day.slice(0,7)))throw new ConflictException('出库费用引用支出须在同一业务月份，避免跨月重复核算');if(classification.expense_use!=='operating'||classification.expense_scope!==b.scope||classification.store_id!==store)throw new ConflictException('原支出的运营用途与归属须一致');const priced=priceInventorySources(rows,source.day.slice(0,7)).find(r=>r.id===id),cost=roundedCost(priced?.priced?.exactCost??null);if(cost!==null&&cost!==String(expense.amountCents))throw new ConflictException('原支出金额须与该出库的实际成本一致');}
    if((await tx`SELECT expense_id FROM studio_os.sample_cost_expense_links WHERE expense_id=${expenseId}`).length)throw new ConflictException('该支出已关联样品成本流水');
    await tx`INSERT INTO studio_os.inventory_cost_expense_links(expense_id,movement_id) VALUES(${expenseId},${id}) ON CONFLICT(expense_id) DO NOTHING`;
    const [link]=await tx`SELECT movement_id FROM studio_os.inventory_cost_expense_links WHERE expense_id=${expenseId}`;if(link.movement_id!==id)throw new ConflictException('该整笔支出已核对到其他库存流水');
   }else if(b.expenseVersion!==null)throw new BadRequestException();
   const snapshot={id:source.id,itemId:source.itemId,type:source.type,quantity:source.quantity,delta:source.delta,day:source.day,snapshot:source.snapshot,purchaseSourceVersion:source.purchaseSourceVersion??null};
   const [saved]=await tx`INSERT INTO studio_os.inventory_cost_evidence_versions(movement_id,version,mode,amount_cents,scope,store_id,expense_id,expense_snapshot,source_reference,reason,movement_snapshot,actor_id,actor_name)
    VALUES(${id},${expected+1},${source.mode},${amount},${b.scope===null?null:String(b.scope)},${store},${expenseId},${expense?JSON.stringify(expense):null}::jsonb,${reference},${reason},${JSON.stringify(snapshot)}::jsonb,${who.id},${actor.username}) RETURNING id,version`;
   const result={id,recordId:saved.id,version:saved.version};
   await tx`INSERT INTO studio_os.inventory_cost_evidence_receipts(actor_id,request_key,movement_id,request_hash,result) VALUES(${who.id},${key},${id},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });
 }
 async receipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'finance');id=uuid(id);key=uuid(key);
  const [r]=await this.db.client`SELECT result FROM studio_os.inventory_cost_evidence_receipts WHERE actor_id=${who.id} AND movement_id=${id} AND request_key=${key}`;
  if(!r)throw new NotFoundException();const [v]=await this.db.client`SELECT mode FROM studio_os.inventory_cost_evidence_versions WHERE id=${r.result.recordId}`;
  if(v?.mode==='basis')await currentPermission(this.db,who,'resources');return r.result;
 }
}
