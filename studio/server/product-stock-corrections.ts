import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission,livePermission} from './permissions';
import {objectInput,uuid,longText,optionalLongText} from './validation';
import {purchaseDay} from './equipment-purchase';
const MAX=2147483647;
const integer=(v:unknown,min=0)=>{if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>MAX)throw new BadRequestException();return Number(v);};
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const projection=`id,version,status,business_date::text AS "businessDate",source_reference AS "sourceReference",reason,lines,actor_name AS actor,created_at AS "createdAt"`;
async function document(tx:TransactionSql,id:string){const [d]=await tx`SELECT id,operation,business_date::text AS "businessDate",source_reference AS "sourceReference",source_shipment_id AS "sourceShipmentId",status,correction_version AS version FROM studio_os.product_stock_effective_documents WHERE id=${id}`;if(!d)throw new NotFoundException();return d;}
async function lines(tx:TransactionSql,id:string){return tx`SELECT m.id,m.item_id AS "itemId",m.packaging_balance_id AS "balanceId",m.quantity,m.delta,m.business_store_id AS "businessStoreId",m.item_snapshot AS snapshot,
 b.store_id AS "inventoryStoreId",b.quantity AS "currentQuantity",b.version AS "balanceVersion",w.quantity AS "itemQuantity",w.version AS "itemVersion",
 EXISTS(SELECT 1 FROM studio_os.warehouse_movements audit WHERE audit.item_id=m.item_id AND (audit.packaging_balance_id IS NULL OR audit.packaging_balance_id=m.packaging_balance_id) AND audit.created_at>m.created_at
 AND (audit.type='stocktake' OR audit.corrects_movement_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM studio_os.product_stock_correction_adjustments a WHERE a.movement_id=audit.id)) AS "quantityLocked"
 FROM studio_os.product_stock_cost_movements m JOIN studio_os.packaging_balances b ON b.id=m.packaging_balance_id JOIN studio_os.warehouse_items w ON w.id=m.item_id WHERE m.product_stock_document_id=${id} ORDER BY m.id`;}
const token=(d:any,rows:any[])=>createHash('sha256').update(JSON.stringify({d,rows})).digest('hex');
export class ProductStockCorrections{
 constructor(private readonly db:StudioDatabase){}
 private async grants(who:Identity){await currentPermission(this.db,who,'finance');await currentPermission(this.db,who,'resources');}
 async state(who:Identity,id:string,value:unknown){
  await this.grants(who);id=uuid(id);const q=objectInput(value,['offset']),offset=Number(q.offset??0);integer(offset);
  return this.db.client.begin(async tx=>{await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;const d=await document(tx,id),rows=await lines(tx,id),history=await tx`SELECT ${tx.unsafe(projection)} FROM studio_os.product_stock_correction_versions WHERE document_id=${id} ORDER BY version DESC LIMIT 50 OFFSET ${offset}`, [n]=await tx`SELECT count(*)::int AS total FROM studio_os.product_stock_correction_versions WHERE document_id=${id}`;
   const stores=await tx`SELECT id,name,active FROM studio_os.stores ORDER BY name,id`;return {document:d,lines:rows,token:token(d,rows),stores,history:{rows:history,total:n.total,offset,limit:50}};});
 }
 async save(who:Identity,id:string,value:unknown,voided=false){
  id=uuid(id);const b=objectInput(value,voided?['requestKey','expectedVersion','token','reason']:['requestKey','expectedVersion','token','businessDate','sourceReference','reason','lines']),key=uuid(b.requestKey),expected=integer(b.expectedVersion),reason=longText(b.reason,2000).trim(),operation=voided?'void':'correct';
  if(expected>=MAX||!reason||typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))throw new BadRequestException();
  const day=voided?null:purchaseDay(b.businessDate),reference=voided?null:optionalLongText(b.sourceReference,200);
  if(!voided&&(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100))throw new BadRequestException();
  const input=voided?[]:(b.lines as unknown[]).map(v=>{const l=objectInput(v,['movementId','quantity','businessStoreId']);return {id:uuid(l.movementId),quantity:integer(l.quantity,1),storeId:l.businessStoreId===null?null:uuid(l.businessStoreId)};});
  const hash=createHash('sha256').update(JSON.stringify(canonical({id,operation,b}))).digest('hex');
  return this.db.client.begin(async tx=>{
   const actor=await livePermission(tx,who.id,'finance');await livePermission(tx,who.id,'resources');await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'product-stock-correction-request:'+who.id+':'+key},0))`;
   const [receipt]=await tx`SELECT document_id,operation,request_hash,result FROM studio_os.product_stock_correction_receipts WHERE actor_id=${who.id} AND request_key=${key}`;if(receipt){if(receipt.document_id!==id||receipt.operation!==operation||receipt.request_hash!==hash)throw new ConflictException();return receipt.result;}
   const [lookup]=await tx`SELECT source_shipment_id FROM studio_os.product_stock_documents WHERE id=${id}`;if(!lookup)throw new NotFoundException();
   if(lookup.source_shipment_id)await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'product-stock-document:'+lookup.source_shipment_id},0))`;
   await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'product-stock-document:'+id},0))`;
   const d=await document(tx,id);if(d.version!==expected||d.status!=='active')throw new ConflictException('原单据已更正或作废');
   const raw=await tx`SELECT DISTINCT item_id FROM studio_os.warehouse_movements WHERE product_stock_document_id=${id}`;
   const items=await tx`SELECT id,quantity,version FROM studio_os.warehouse_items WHERE id=ANY(${tx.array(raw.map(r=>r.item_id))}::uuid[]) ORDER BY id FOR UPDATE`;
   await tx`SELECT id FROM studio_os.packaging_balances WHERE item_id=ANY(${tx.array(items.map(r=>r.id))}::uuid[]) ORDER BY id FOR UPDATE`;
   const original=await lines(tx,id);if(token(d,original)!==b.token)throw new ConflictException('库存或原单据已变化，请重新核对');
   if(!voided&&(input.length!==original.length||new Set(input.map(l=>l.id)).size!==input.length||input.some(l=>!original.some(o=>o.id===l.id))))throw new BadRequestException('更正须完整对应原明细，不增删或换库存来源');
   const prepared:any[]=[];const deltas=new Map<string,number>();
   for(const old of original){const line=voided?{id:old.id,quantity:old.quantity,storeId:old.businessStoreId}:input.find(l=>l.id===old.id)!,newDelta=voided?0:(d.operation==='shipment'?-line.quantity:line.quantity),adjustment=newDelta-old.delta;
    if(adjustment&&old.quantityLocked)throw new ConflictException('原单之后已有盘点或人工纠错，数量可能已校正；不能再次直接冲减，请核对实物与后续调整');
    if(old.inventoryStoreId&&line.storeId!==old.inventoryStoreId||d.operation==='shipment'&&!line.storeId)throw new BadRequestException('店铺库存须保持实际归属，公共库存发货须明确业务店铺');
    const [store]=line.storeId?await tx`SELECT name,active FROM studio_os.stores WHERE id=${line.storeId} FOR SHARE`:[];if(line.storeId&&(!store||!store.active&&line.storeId!==old.businessStoreId))throw new ConflictException('不能改选停用店铺');
    if(d.operation==='shipment'){const [r]=await tx`SELECT coalesce(sum(m.quantity),0)::text AS quantity,min(rd.business_date)::text AS day FROM studio_os.product_stock_returns r JOIN studio_os.product_stock_cost_movements m ON m.id=r.return_movement_id JOIN studio_os.product_stock_effective_documents rd ON rd.id=m.product_stock_document_id WHERE r.shipment_movement_id=${old.id} AND NOT m.cost_excluded`;
     if(voided&&BigInt(r.quantity)>0n||!voided&&(BigInt(line.quantity)<BigInt(r.quantity)||r.day&&day!>r.day))throw new ConflictException('原发货已有真实退货，更正后数量不得少于已退数量、日期不得晚于退货日期；不能连带作废真实退货');
    }
    if(d.operation==='return'){const [parent]=await tx`SELECT sm.id,sm.quantity,sm.business_store_id AS "storeId",sd.business_date::text AS day,sd.status FROM studio_os.product_stock_returns r JOIN studio_os.product_stock_cost_movements sm ON sm.id=r.shipment_movement_id JOIN studio_os.product_stock_effective_documents sd ON sd.id=sm.product_stock_document_id WHERE r.return_movement_id=${old.id}`;
     if(!parent||parent.status!=='active'||!voided&&(day!<parent.day||line.storeId!==parent.storeId))throw new ConflictException('退货须沿用有效原发货及业务店铺，退货日期不能早于发货');
     if(!voided){const [other]=await tx`SELECT coalesce(sum(m.quantity),0)::text AS quantity FROM studio_os.product_stock_returns r JOIN studio_os.product_stock_cost_movements m ON m.id=r.return_movement_id WHERE r.shipment_movement_id=${parent.id} AND m.id<>${old.id} AND NOT m.cost_excluded`;if(BigInt(line.quantity)+BigInt(other.quantity)>BigInt(parent.quantity))throw new ConflictException('累计可售退货数量超过原发货');}
    }
    const balanceAfter=old.currentQuantity+adjustment;if(balanceAfter<0||balanceAfter>MAX)throw new ConflictException('当前归属库存不足以执行更正，不能使用后续或其他归属库存强行冲减');
    deltas.set(old.itemId,(deltas.get(old.itemId)??0)+adjustment);prepared.push({...old,quantity:line.quantity,businessStoreId:line.storeId,snapshot:{...old.snapshot,businessStoreId:line.storeId,businessStoreName:store?.name??null},adjustment,balanceAfter});
   }
   for(const item of items){const next=item.quantity+(deltas.get(item.id)??0);if(next<0||next>MAX)throw new ConflictException('商品总库存数量超出范围');}
   const facts=prepared.map(l=>({id:l.id,itemId:l.itemId,balanceId:l.balanceId,quantity:l.quantity,businessStoreId:l.businessStoreId,snapshot:l.snapshot,previousQuantity:original.find(o=>o.id===l.id)!.quantity,adjustment:l.adjustment,balanceBefore:l.currentQuantity,balanceAfter:l.balanceAfter}));
   const [saved]=await tx`INSERT INTO studio_os.product_stock_correction_versions(document_id,version,status,business_date,source_reference,reason,lines,actor_id,actor_name) VALUES(${id},${expected+1},${voided?'void':'active'},${day??d.businessDate},${reference??d.sourceReference},${reason},${JSON.stringify(facts)}::jsonb,${who.id},${actor.username}) RETURNING id`;
   for(const l of prepared)if(l.adjustment){const movementId=randomUUID();await tx`INSERT INTO studio_os.warehouse_movements(id,item_id,packaging_balance_id,type,quantity,delta,before_quantity,after_quantity,reason,source_reference,corrects_movement_id,item_snapshot,actor_id) VALUES(${movementId},${l.itemId},${l.balanceId},${l.adjustment>0?'inbound':'outbound'},${Math.abs(l.adjustment)},${l.adjustment},${l.currentQuantity},${l.balanceAfter},${voided?'商品错误单据作废数量冲回':'商品单据数量更正差额'},${reference??d.sourceReference},NULL,${JSON.stringify(l.snapshot)}::jsonb,${who.id})`;await tx`INSERT INTO studio_os.product_stock_correction_adjustments(movement_id,version_id,source_movement_id) VALUES(${movementId},${saved.id},${l.id})`;await tx`UPDATE studio_os.packaging_balances SET quantity=${l.balanceAfter},version=version+1 WHERE id=${l.balanceId}`;}
   for(const item of items)if(prepared.some(l=>l.itemId===item.id&&l.adjustment))await tx`UPDATE studio_os.warehouse_items SET quantity=quantity+${deltas.get(item.id)??0},version=version+1,updated_at=now() WHERE id=${item.id}`;
   await this.checkReplay(tx,items.map(i=>i.id));
   const result={id,recordId:saved.id,version:expected+1};await tx`INSERT INTO studio_os.product_stock_correction_receipts(actor_id,request_key,document_id,operation,request_hash,result) VALUES(${who.id},${key},${id},${operation},${hash},${JSON.stringify(result)}::jsonb)`;return result;
  });
 }
 private async checkReplay(tx:TransactionSql,itemIds:string[]){
  const rows=await tx`SELECT m.id,m.item_id AS "itemId",m.packaging_balance_id AS "balanceId",m.type,m.delta,coalesce(d.business_date,(m.created_at AT TIME ZONE 'Asia/Shanghai')::date)::text AS day,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS posted,
   (m.type='opening' AND m.packaging_balance_id IS NOT NULL AND EXISTS(SELECT 1 FROM studio_os.warehouse_movements old WHERE old.item_id=m.item_id AND old.type='opening' AND old.packaging_balance_id IS NULL)) AS duplicate,
   EXISTS(SELECT 1 FROM studio_os.packaging_stock_transfers t WHERE t.inbound_movement_id=m.id OR t.outbound_movement_id=m.id) AS transfer
   FROM studio_os.product_stock_cost_movements m LEFT JOIN studio_os.product_stock_effective_documents d ON d.id=m.product_stock_document_id WHERE m.item_id=ANY(${tx.array(itemIds)}::uuid[]) AND NOT m.cost_excluded ORDER BY day,posted,m.id`;
  const totals=new Map<string,number>(),balances=new Map<string,number>();
  for(const r of rows){if(!r.duplicate&&!r.transfer){const qty=(totals.get(r.itemId)??0)+r.delta;if(qty<0)throw new ConflictException('更正后按业务日期重放会出现负库存，请先核对日期、发货及后续使用');totals.set(r.itemId,qty);}if(r.balanceId){const qty=(balances.get(r.balanceId)??0)+r.delta;if(qty<0)throw new ConflictException('更正后该库存归属的历史数量不足，请核对单据日期');balances.set(r.balanceId,qty);}}
  const actual=await tx`SELECT id,quantity FROM studio_os.warehouse_items WHERE id=ANY(${tx.array(itemIds)}::uuid[])`;for(const r of actual)if(totals.get(r.id)!==r.quantity)throw new ConflictException('更正后的数量重放与当前总库存不一致，请核对原流水');
  const actualBalances=await tx`SELECT id,quantity FROM studio_os.packaging_balances WHERE item_id=ANY(${tx.array(itemIds)}::uuid[])`;for(const r of actualBalances)if((balances.get(r.id)??0)!==r.quantity)throw new ConflictException('更正后的归属库存重放与当前余额不一致，请核对原流水');
 }
 async receipt(who:Identity,id:string,key:string){await this.grants(who);id=uuid(id);key=uuid(key);const [r]=await this.db.client`SELECT result FROM studio_os.product_stock_correction_receipts WHERE actor_id=${who.id} AND document_id=${id} AND request_key=${key}`;if(!r)throw new NotFoundException();return r.result;}
}
