import {stockCostMovements} from './product-cost-sources';
import {BadRequestException,NotFoundException} from '@nestjs/common';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import {currentPermission} from './permissions';
import {objectInput,uuid} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {referenceAt} from './product-reference-costs';
import {movingCosts,CostMovement} from './product-cost-engine';
export class ProductCosts{
 constructor(private readonly db:StudioDatabase){}
 async catalog(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['offset']),offset=Number(q.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=await tx`SELECT k.id,k.code,coalesce(w.name,p.name) AS name,k.specification,k.unit,k.active,w.quantity FROM studio_os.product_skus k
    JOIN studio_os.products p ON p.id=k.product_id LEFT JOIN studio_os.warehouse_items w ON w.id=k.warehouse_item_id ORDER BY k.code,k.id LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.product_skus`;
   return {rows,total:count.total,offset,limit:50};
  });
 }
 async review(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['month']);const month=attendanceMonth(q.month);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [sku]=await tx`SELECT k.id,k.code,w.id AS "itemId",coalesce(w.name,p.name) AS name,k.specification,k.unit FROM studio_os.product_skus k
    JOIN studio_os.products p ON p.id=k.product_id LEFT JOIN studio_os.warehouse_items w ON w.id=k.warehouse_item_id WHERE k.id=${id}`;
   if(!sku)throw new NotFoundException();
   const rows=sku.itemId?await stockCostMovements(tx,sku.itemId):[];
   const dropship=await tx`SELECT l.id,d.id AS "documentId",d.code,d.business_date::text AS day,l.quantity,l.snapshot,
    c.value->>'basis' AS basis,(c.value->>'amountCents')::bigint::text AS "amountCents",v.version,(SELECT count(*)>1 FROM studio_os.dropship_effective_documents other JOIN LATERAL(SELECT status FROM studio_os.dropship_cost_versions ov WHERE ov.document_id=other.id ORDER BY version DESC LIMIT 1) ov ON true WHERE ov.status='active' AND lower(btrim(other.supplier))=lower(btrim(d.supplier)) AND lower(btrim(other.source_reference))=lower(btrim(d.source_reference))) AS "sourceConflict"
    FROM studio_os.dropship_effective_lines l JOIN studio_os.dropship_effective_documents d ON d.id=l.document_id
    JOIN LATERAL(SELECT * FROM studio_os.dropship_cost_versions v WHERE v.document_id=d.id ORDER BY version DESC LIMIT 1) v ON true
    JOIN LATERAL jsonb_array_elements(v.lines) c(value) ON c.value->>'lineId'=l.id::text
    WHERE v.status='active' AND l.sku_id=${id} AND to_char(d.business_date,'YYYY-MM')=${month} ORDER BY d.business_date,d.id,l.position`;
   const refunds=await tx`SELECT r.id,d.id AS "documentId",d.code,r.business_date::text AS day,r.quantity,v.amount_cents AS "amountCents",v.version,l.snapshot,r.source_reference AS "sourceReference",(SELECT count(*)>1 FROM studio_os.dropship_effective_documents other JOIN LATERAL(SELECT status FROM studio_os.dropship_cost_versions ov WHERE ov.document_id=other.id ORDER BY version DESC LIMIT 1) ov ON true WHERE ov.status='active' AND lower(btrim(other.supplier))=lower(btrim(d.supplier)) AND lower(btrim(other.source_reference))=lower(btrim(d.source_reference))) AS "sourceConflict"
    FROM studio_os.dropship_refunds r JOIN studio_os.dropship_effective_lines l ON l.id=r.line_id JOIN studio_os.dropship_effective_documents d ON d.id=l.document_id
    JOIN LATERAL(SELECT * FROM studio_os.dropship_refund_versions v WHERE v.refund_id=r.id ORDER BY version DESC LIMIT 1) v ON true
    JOIN LATERAL(SELECT status FROM studio_os.dropship_cost_versions dv WHERE dv.document_id=d.id ORDER BY version DESC LIMIT 1) dv ON true
    WHERE v.status='active' AND dv.status='active' AND l.sku_id=${id} AND to_char(r.business_date,'YYYY-MM')=${month} ORDER BY r.business_date,r.id`;
   const sum=(list:any[])=>list.reduce((n,r)=>n+BigInt(r.amountCents),0n).toString();
   const actual=dropship.every(r=>r.basis==='actual'&&!r.sourceConflict)&&refunds.every(r=>!r.sourceConflict);
   const dropSummary={rows:dropship,refunds,actualCents:actual?sum(dropship):null,indicativeCents:sum(dropship),refundCents:sum(refunds),
    estimatedRows:dropship.filter(r=>r.basis==='reference').length,netCents:actual?(BigInt(sum(dropship))-BigInt(sum(refunds))).toString():null,
    indicativeNetCents:(BigInt(sum(dropship))-BigInt(sum(refunds))).toString()};
   const stocked=movingCosts(rows as unknown as CostMovement[],month);return {sku,dropship:dropSummary,reference:await referenceAt(tx,id,month),method:'moving-average',...stocked,issues:[...stocked.issues,...([...dropship,...refunds].some(r=>r.sourceConflict)?['代发来源重复，请核对原批次']:[])]};
  });
 }
}
