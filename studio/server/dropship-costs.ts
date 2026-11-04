import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,shortText,longText} from './validation';
import {optionalMoney} from './money';
import {purchaseDay} from './equipment-purchase';
import {referenceAt,costSku} from './product-reference-costs';
const MAX=2147483647;
const offset=(v:unknown)=>{const n=Number(v??0);if(!Number.isSafeInteger(n)||n<0||n>MAX)throw new BadRequestException();return n;};
const quantity=(v:unknown)=>{if(!Number.isSafeInteger(v)||Number(v)<1||Number(v)>MAX)throw new BadRequestException();return Number(v);};
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const projection=`v.id,v.version,v.lines,v.reason,v.actor_name AS actor,v.created_at AS "createdAt"`;
export class DropshipCosts{
 constructor(private readonly db:StudioDatabase){}
 private async write(who:Identity,operation:string,target:string|null,key:string,body:unknown,fn:(tx:TransactionSql,actor:string)=>Promise<any>){
  const hash=createHash('sha256').update(JSON.stringify(canonical({operation,target,body}))).digest('hex');
  try{return await this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');await livePermission(tx,who.id,'resources');
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'dropship-request:'+who.id+':'+key},0))`;
   const [old]=await tx`SELECT operation,target_id,request_hash,result FROM studio_os.dropship_cost_receipts WHERE actor_id=${who.id} AND request_key=${key}`;
   if(old){if(old.operation!==operation||old.target_id!==target||old.request_hash!==hash)throw new ConflictException('请求标识已用于其他代发内容');return old.result;}
   if(target)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'dropship-document:'+target},0))`;
   const result=await fn(tx,actor.username);
   await tx`INSERT INTO studio_os.dropship_cost_receipts(actor_id,request_key,operation,target_id,request_hash,result) VALUES(${who.id},${key},${operation},${target},${hash},${JSON.stringify(result)}::jsonb)`;
   return result;
  });}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('代发批次编号或该明细的退款来源已使用');throw e;}
 }
 async options(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['q','offset']),start=offset(q.offset),search=q.q?shortText(q.q,100):'';
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=await tx`SELECT k.id,k.code,k.unit,k.specification,p.name FROM studio_os.product_skus k JOIN studio_os.products p ON p.id=k.product_id WHERE k.active AND p.active AND strpos(lower(concat_ws(' ',k.code,k.specification,p.name)),lower(${search}))>0 ORDER BY k.code,k.id LIMIT 50 OFFSET ${start}`;
   const stores=await tx`SELECT id,name FROM studio_os.stores WHERE active ORDER BY name,id`;
   return {rows,stores,offset:start,limit:50};
  });
 }
 async list(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['offset']),start=offset(q.offset);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=await tx`SELECT id,code,business_date::text AS "businessDate",supplier FROM studio_os.dropship_cost_documents ORDER BY created_at DESC,id LIMIT 50 OFFSET ${start}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.dropship_cost_documents`;
   return {rows,total:count.total,offset:start,limit:50};
  });
 }
 async detail(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['offset']),start=offset(q.offset);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [document]=await tx`SELECT id,code,business_date::text AS "businessDate",supplier,source_reference AS "sourceReference" FROM studio_os.dropship_cost_documents WHERE id=${id}`;
   if(!document)throw new NotFoundException();
   const lines=await tx`SELECT l.id,l.sku_id AS "skuId",l.store_id AS "storeId",l.quantity,l.snapshot,
    coalesce((SELECT sum(r.quantity) FROM studio_os.dropship_refunds r WHERE r.line_id=l.id),0)::int AS "returnedQuantity"
    FROM studio_os.dropship_cost_lines l WHERE document_id=${id} ORDER BY position`;
   const [record]=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.dropship_cost_versions v WHERE document_id=${id} ORDER BY version DESC LIMIT 1`;
   const history=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.dropship_cost_versions v WHERE document_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${start}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.dropship_cost_versions WHERE document_id=${id}`;
   const refunds=await tx`SELECT r.id,r.line_id AS "lineId",r.quantity,r.business_date::text AS "businessDate",r.source_reference AS "sourceReference",
    (SELECT jsonb_agg(jsonb_build_object('version',v.version,'amountCents',v.amount_cents,'reason',v.reason,'actor',v.actor_name,'createdAt',v.created_at) ORDER BY v.version DESC) FROM studio_os.dropship_refund_versions v WHERE v.refund_id=r.id) AS history
    FROM studio_os.dropship_refunds r JOIN studio_os.dropship_cost_lines l ON l.id=r.line_id WHERE l.document_id=${id} ORDER BY r.business_date,r.id`;
   return {document,lines,record,refunds,history:{rows:history,total:count.total,offset:start,limit:50}};
  });
 }
 private costs(value:unknown){
  if(!Array.isArray(value)||!value.length||value.length>100)throw new BadRequestException();
  return value.map(v=>{const b=objectInput(v,['lineId','basis','amount']);if(typeof b.basis!=='string'||!['actual','reference'].includes(b.basis))throw new BadRequestException();
   const amount=optionalMoney(b.amount);if(b.basis==='actual'&&amount===null||b.basis==='reference'&&b.amount!==null)throw new BadRequestException('实际成本须明确金额，参考估算请留空实际金额');
   return {lineId:uuid(b.lineId),basis:String(b.basis),amount};
  });
 }
 private async priced(tx:TransactionSql,day:string,original:any[],costs:{lineId:string,basis:string,amount:number|null}[]){
  if(original.length!==costs.length||new Set(costs.map(c=>c.lineId)).size!==costs.length||costs.some(c=>!original.some(l=>l.id===c.lineId)))throw new BadRequestException('成本须完整对应原批次全部明细');
  const result=[];let total=0;
  for(const cost of costs){const line=original.find(l=>l.id===cost.lineId)!,reference=cost.basis==='reference'?await referenceAt(tx,line.sku_id,day.slice(0,7)):null;
   if(cost.basis==='reference'&&reference?.unitCents==null)throw new ConflictException('该月份的 SKU 参考单价尚未填写');
   const amount=cost.basis==='actual'?cost.amount!:Number(BigInt(line.quantity)*BigInt(reference!.unitCents));
   total+=amount;if(!Number.isSafeInteger(amount)||total>MAX)throw new BadRequestException('代发成本超过容量');
   result.push({lineId:line.id,basis:cost.basis,amountCents:amount,reference});
  }
  return result;
 }
 async create(who:Identity,value:unknown){
  const b=objectInput(value,['requestKey','code','businessDate','supplier','sourceReference','reason','lines']),key=uuid(b.requestKey),code=shortText(b.code,64),day=purchaseDay(b.businessDate),supplier=shortText(b.supplier,150),source=shortText(b.sourceReference,200),reason=longText(b.reason,2000).trim();
  if(!reason||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)throw new BadRequestException();
  const lines=b.lines.map(v=>{const l=objectInput(v,['skuCode','storeId','quantity','basis','amount']);return {basis:l.basis,amount:l.amount,skuCode:shortText(l.skuCode,64),storeId:uuid(l.storeId),quantity:quantity(l.quantity)};});
  // Validate monetary inputs before creating any source rows.
  this.costs(lines.map(l=>({lineId:key,basis:l.basis,amount:l.amount})));
  return this.write(who,'create',null,key,b,async(tx,actor)=>{
   const [doc]=await tx`INSERT INTO studio_os.dropship_cost_documents(code,business_date,supplier,source_reference,actor_id) VALUES(${code},${day},${supplier},${source},${who.id}) RETURNING id`;
   const original=[],prices=[];
   for(const [index,line] of lines.entries()){
    const [found]=await tx`SELECT id FROM studio_os.product_skus WHERE code=${line.skuCode}`;if(!found)throw new BadRequestException('SKU 编号不存在');
    const sku=await costSku(tx,found.id,true);if(!sku.active||!sku.productActive)throw new ConflictException('只能新增启用的正式 SKU');
    const [store]=await tx`SELECT id,name FROM studio_os.stores WHERE id=${line.storeId} AND active FOR SHARE`;if(!store)throw new ConflictException('请选择启用的业务店铺');
    const [saved]=await tx`INSERT INTO studio_os.dropship_cost_lines(document_id,position,sku_id,store_id,quantity,snapshot)
     VALUES(${doc.id},${index},${sku.id},${store.id},${line.quantity},${JSON.stringify({skuId:sku.id,skuCode:sku.code,name:sku.name,specification:sku.specification,unit:sku.unit,storeId:store.id,storeName:store.name})}::jsonb) RETURNING id,sku_id,quantity`;
    original.push(saved);prices.push({lineId:saved.id,basis:line.basis,amount:line.amount});
   }
   const priced=await this.priced(tx,day,original,this.costs(prices));
   const [record]=await tx`INSERT INTO studio_os.dropship_cost_versions(document_id,version,lines,reason,actor_id,actor_name) VALUES(${doc.id},1,${JSON.stringify(priced)}::jsonb,${reason},${who.id},${actor}) RETURNING id`;
   return {id:doc.id,recordId:record.id,version:1};
  });
 }
 async revise(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','expectedVersion','reason','lines']),key=uuid(b.requestKey),expected=quantity(b.expectedVersion),reason=longText(b.reason,2000).trim(),costs=this.costs(b.lines);
  if(!reason||expected>=MAX)throw new BadRequestException();
  return this.write(who,'revise',id,key,b,async(tx,actor)=>{
   const [doc]=await tx`SELECT business_date::text AS day FROM studio_os.dropship_cost_documents WHERE id=${id}`;if(!doc)throw new NotFoundException();
   const [last]=await tx`SELECT max(version)::int AS version FROM studio_os.dropship_cost_versions WHERE document_id=${id}`;if(last.version!==expected)throw new ConflictException('代发成本已变化，请重新核对');
   const original=await tx`SELECT id,sku_id,quantity FROM studio_os.dropship_cost_lines WHERE document_id=${id} ORDER BY position`;
   const priced=await this.priced(tx,doc.day,original,costs);
   const [r]=await tx`INSERT INTO studio_os.dropship_cost_versions(document_id,version,lines,reason,actor_id,actor_name) VALUES(${id},${expected+1},${JSON.stringify(priced)}::jsonb,${reason},${who.id},${actor}) RETURNING id`;
   return {id,recordId:r.id,version:expected+1};
  });
 }
 async refund(who:Identity,id:string,value:unknown){
  id=uuid(id);const b=objectInput(value,['requestKey','refundId','expectedVersion','lineId','quantity','businessDate','sourceReference','amount','reason']);
  const key=uuid(b.requestKey),refundId=b.refundId===null?null:uuid(b.refundId),lineId=uuid(b.lineId),qty=quantity(b.quantity),day=purchaseDay(b.businessDate),source=shortText(b.sourceReference,200),amount=optionalMoney(b.amount),reason=longText(b.reason,2000).trim();
  const expected=Number(b.expectedVersion);if(!Number.isSafeInteger(b.expectedVersion)||expected<0||expected>=MAX||(!refundId&&expected!==0)||amount===null||!reason)throw new BadRequestException();
  return this.write(who,'refund',id,key,b,async(tx,actor)=>{
   const [line]=await tx`SELECT l.quantity,d.business_date::text AS day FROM studio_os.dropship_cost_lines l JOIN studio_os.dropship_cost_documents d ON d.id=l.document_id WHERE l.id=${lineId} AND l.document_id=${id}`;
   if(!line)throw new NotFoundException();if(day<line.day)throw new BadRequestException('退款日期不能早于原代发日期');
   let original;
   if(refundId){[original]=await tx`SELECT id,line_id,quantity,business_date::text AS day,source_reference FROM studio_os.dropship_refunds WHERE id=${refundId}`;
    if(!original||original.line_id!==lineId||original.quantity!==qty||original.day!==day||original.source_reference!==source)throw new ConflictException('修正金额时保持原退款数量、日期和来源固定');
   }else{
    const [used]=await tx`SELECT coalesce(sum(quantity),0)::int AS quantity FROM studio_os.dropship_refunds WHERE line_id=${lineId}`;
    if(qty>line.quantity-used.quantity)throw new ConflictException('累计退货数量不能超过原代发数量');
    [original]=await tx`INSERT INTO studio_os.dropship_refunds(line_id,quantity,business_date,source_reference) VALUES(${lineId},${qty},${day},${source}) RETURNING id`;
   }
   const [latest]=await tx`SELECT coalesce(max(version),0)::int AS version FROM studio_os.dropship_refund_versions WHERE refund_id=${original.id}`;
   if(latest.version!==expected)throw new ConflictException('退款依据已变化');
   const [r]=await tx`INSERT INTO studio_os.dropship_refund_versions(refund_id,version,amount_cents,reason,actor_id,actor_name) VALUES(${original.id},${expected+1},${amount},${reason},${who.id},${actor}) RETURNING id`;
   return {id,refundId:original.id,recordId:r.id,version:expected+1};
  });
 }
 async receipt(who:Identity,key:string,operation:string,target:string|null){
  await currentPermission(this.db,who,'finance');await currentPermission(this.db,who,'resources');key=uuid(key);if(target)target=uuid(target);
  const [r]=await this.db.client`SELECT result FROM studio_os.dropship_cost_receipts WHERE actor_id=${who.id} AND request_key=${key} AND operation=${operation} AND target_id IS NOT DISTINCT FROM ${target}::uuid`;
  if(!r)throw new NotFoundException();return r.result;
 }
}
