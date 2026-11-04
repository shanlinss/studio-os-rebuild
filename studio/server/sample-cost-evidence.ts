import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,longText} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {optionalMoney} from './money';
import {purchaseExpense} from './equipment-purchase';
import {sampleCostSources,replaySampleCosts} from './sample-cost-sources';
const MAX=2147483647;
const projection=`id,version,mode,amount_cents AS "amountCents",scope,store_id AS "storeId",expense_id AS "expenseId",expense_snapshot AS "expenseSnapshot",source_reference AS "sourceReference",reason,loss_kind AS "lossKind",event_snapshot AS "eventSnapshot",actor_name AS actor,created_at AS "createdAt"`;
const page=(v:unknown)=>{const n=Number(v??0);if(!Number.isSafeInteger(n)||n<0||n>MAX)throw new BadRequestException();return n;};
function publicRow(r:any){return {id:r.id,sampleId:r.sampleId,mode:r.mode,action:r.action,delta:r.delta,day:r.day,snapshot:r.snapshot,note:r.note,movementId:r.movementId,costCents:r.costCents,sourceChanged:r.sourceChanged,attributionChanged:r.attributionChanged,costToken:r.costToken,version:r.version??null,scope:r.scope??null,storeId:r.storeId??null,lossKind:r.lossKind??null};}
export class SampleCostEvidence{
 constructor(private readonly db:StudioDatabase){}
 async list(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month','q','offset']),month=attendanceMonth(q.month),offset=page(q.offset),search=q.q?shortText(q.q,100).toLowerCase():'';
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const result=replaySampleCosts(await sampleCostSources(tx),month),rows=result.rows.filter(r=>JSON.stringify(r.snapshot).toLowerCase().includes(search)).sort((a,b)=>b.postedAt.localeCompare(a.postedAt)||a.id.localeCompare(b.id));
   return {rows:rows.slice(offset,offset+50).map(publicRow),total:rows.length,offset,limit:50,month,assetCents:result.assetCents,pendingAssets:result.pendingAssets};
  });
 }
 async state(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['offset']),offset=page(q.offset);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [item]=await tx`SELECT sample_id FROM studio_os.shooting_sample_events WHERE id=${id}`;if(!item)throw new NotFoundException();
   const rows=await sampleCostSources(tx,item.sample_id),source=rows.find(r=>r.id===id);if(!source)throw new NotFoundException();
   const priced=replaySampleCosts(rows,source.day.slice(0,7)).rows.find(r=>r.id===id)!;
   const [record]=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.sample_cost_evidence_versions WHERE event_id=${id} ORDER BY version DESC LIMIT 1`;
   const history=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.sample_cost_evidence_versions WHERE event_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.sample_cost_evidence_versions WHERE event_id=${id}`;
   const stores=await tx`SELECT id,name,active FROM studio_os.stores ORDER BY name,id`;
   return {source:publicRow(priced),balance:replaySampleCosts(rows,source.day.slice(0,7)).balances.find(r=>r.sampleId===item.sample_id),record:record??null,stores,history:{rows:history,total:count.total,offset,limit:50}};
  });
 }
 async save(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','amount','scope','storeId','expenseId','expenseVersion','costToken','lossKind','sourceReference','reason']);
  const key=uuid(b.requestKey),expected=Number(b.expectedVersion),amount=optionalMoney(b.amount),store=b.storeId===null?null:uuid(b.storeId),expenseId=b.expenseId===null?null:uuid(b.expenseId),reference=shortText(b.sourceReference,200),reason=longText(b.reason,2000);
  if(!Number.isSafeInteger(b.expectedVersion)||expected<0||expected>=MAX)throw new BadRequestException();
  const hash=createHash('sha256').update(JSON.stringify({id,expected,amount,scope:b.scope,store,expenseId,expenseVersion:b.expenseVersion,costToken:b.costToken,lossKind:b.lossKind,reference,reason})).digest('hex');
  return this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');
   const [movement]=await tx`SELECT sample_id FROM studio_os.shooting_sample_events WHERE id=${id}`;if(!movement)throw new NotFoundException();
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'sample-cost-pool:'+movement.sample_id},0))`;
   await tx`SELECT id FROM studio_os.shooting_samples WHERE id=${movement.sample_id} FOR SHARE`;
   const rows=await sampleCostSources(tx,movement.sample_id),source=rows.find(r=>r.id===id);if(!source)throw new NotFoundException();
   if(!['basis','outflow'].includes(source.mode))throw new ConflictException('转入样品沿用原商品成本，不能在此重复登记');
   if(source.mode==='basis')await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'sample-evidence-request:'+who.id+':'+key},0))`;
   const [receipt]=await tx`SELECT event_id,request_hash,result FROM studio_os.sample_cost_evidence_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(receipt){if(receipt.event_id!==id||receipt.request_hash!==hash)throw new ConflictException();return receipt.result;}
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'sample-evidence-movement:'+id},0))`;
   const [latest]=await tx`SELECT version FROM studio_os.sample_cost_evidence_versions WHERE event_id=${id} ORDER BY version DESC LIMIT 1`;
   if((latest?.version??0)!==expected)throw new ConflictException('样品成本依据或归属已有新版本');
   const priced=replaySampleCosts(rows,source.day.slice(0,7)).rows.find(r=>r.id===id)!;
   if(typeof b.costToken!=='string'||!/^[a-f0-9]{64}$/.test(b.costToken))throw new BadRequestException();
   if(priced.costToken!==b.costToken)throw new ConflictException('样品成本来源已变化，请重新核对');
   if(source.mode==='basis'){
    if(amount===null||b.scope!==null||store!==null||b.lossKind!==null)throw new BadRequestException('只登记本次增加样品数量的总成本');
   }else if(b.amount!==null||typeof b.scope!=='string'||!['public','store','unclassified'].includes(b.scope)||b.scope==='store'&&!store||b.scope!=='store'&&store!==null||typeof b.lossKind!=='string'||!['loss','scrap'].includes(b.lossKind))throw new BadRequestException('损耗或报废成本按原样品资产计算，只核对原因与归属');
   if(store&&!(await tx`SELECT id FROM studio_os.stores WHERE id=${store} FOR SHARE`).length)throw new BadRequestException();
   if(expenseId)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'inventory-sample-cost-expense:'+expenseId},0))`;
   const expense=expenseId?await purchaseExpense(tx,expenseId,true):null;
   if(expense){
    if(expense.version!==b.expenseVersion)throw new ConflictException('引用支出已变化');
    const [classification]=await tx`SELECT expense_scope,expense_use,store_id FROM studio_os.expense_records WHERE id=${expenseId}`;
    if(source.mode==='basis'){if(classification.expense_use!=='inventory'||expense.amountCents!==amount)throw new ConflictException('入库依据引用整笔库存采购支出，请先核对用途和金额');}
    else {if(!expense.expenseDate.startsWith(source.day.slice(0,7)))throw new ConflictException('样品损耗引用支出须在同一业务月份，避免跨月重复核算');if(classification.expense_use!=='operating'||classification.expense_scope!==b.scope||classification.store_id!==store)throw new ConflictException('原支出的运营用途与归属须一致');const cost=priced.costCents;if(cost===null||priced.sourceChanged||cost!==String(expense.amountCents))throw new ConflictException('原支出金额须与该样品损耗的实际成本一致');}
    if((await tx`SELECT expense_id FROM studio_os.inventory_cost_expense_links WHERE expense_id=${expenseId}`).length)throw new ConflictException('该支出已关联库存成本流水');
    await tx`INSERT INTO studio_os.sample_cost_expense_links(expense_id,event_id) VALUES(${expenseId},${id}) ON CONFLICT(expense_id) DO NOTHING`;
    const [link]=await tx`SELECT event_id FROM studio_os.sample_cost_expense_links WHERE expense_id=${expenseId}`;if(link.event_id!==id)throw new ConflictException('该整笔支出已核对到其他库存流水');
   }else if(b.expenseVersion!==null)throw new BadRequestException();
   const snapshot={id:source.id,sampleId:source.sampleId,action:source.action,delta:source.delta,day:source.day,snapshot:source.snapshot,costToken:priced.costToken,exact:priced.exact};
   const [saved]=await tx`INSERT INTO studio_os.sample_cost_evidence_versions(event_id,version,mode,amount_cents,scope,store_id,expense_id,expense_snapshot,source_reference,reason,loss_kind,event_snapshot,actor_id,actor_name)
    VALUES(${id},${expected+1},${source.mode},${amount},${b.scope===null?null:String(b.scope)},${store},${expenseId},${expense?JSON.stringify(expense):null}::jsonb,${reference},${reason},${b.lossKind===null?null:String(b.lossKind)},${JSON.stringify(snapshot)}::jsonb,${who.id},${actor.username}) RETURNING id,version`;
   const result={id,recordId:saved.id,version:saved.version};
   await tx`INSERT INTO studio_os.sample_cost_evidence_receipts(actor_id,request_key,event_id,request_hash,result) VALUES(${who.id},${key},${id},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });
 }
 async receipt(who:Identity,id:string,key:string){
  await currentPermission(this.db,who,'finance');id=uuid(id);key=uuid(key);
  const [r]=await this.db.client`SELECT result FROM studio_os.sample_cost_evidence_receipts WHERE actor_id=${who.id} AND event_id=${id} AND request_key=${key}`;
  if(!r)throw new NotFoundException();const [v]=await this.db.client`SELECT mode FROM studio_os.sample_cost_evidence_versions WHERE id=${r.result.recordId}`;
  if(v?.mode==='basis')await currentPermission(this.db,who,'resources');return r.result;
 }
}
