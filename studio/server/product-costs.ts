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
   const rows=await tx`SELECT m.id,m.type,m.quantity,m.delta,rc.unit_cents AS "referenceUnitCents",rc.id AS "referenceId",
    coalesce(d.business_date,(m.created_at AT TIME ZONE 'Asia/Shanghai')::date)::text AS day,
    to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "postedAt",m.product_stock_document_id AS "documentId",d.operation,
    coalesce(l.total_cents,ol.total_cents) AS "totalCents",CASE WHEN ol.movement_id IS NOT NULL THEN ov.version END AS "openingVersion",r.shipment_movement_id AS "sourceShipmentId",v.version AS "purchaseVersion",m.item_snapshot AS snapshot,
    coalesce(e.version<>(v.expense_snapshot->>'version')::int,false) AS "sourceChanged",
    (m.type='opening' AND m.packaging_balance_id IS NOT NULL AND EXISTS(SELECT 1 FROM studio_os.warehouse_movements old
     WHERE old.item_id=m.item_id AND old.type='opening' AND old.packaging_balance_id IS NULL)) AS "duplicateOpening",
    EXISTS(SELECT 1 FROM studio_os.packaging_stock_transfers t WHERE t.inbound_movement_id=m.id OR t.outbound_movement_id=m.id) AS "internalTransfer"
    FROM studio_os.warehouse_movements m LEFT JOIN studio_os.product_stock_documents d ON d.id=m.product_stock_document_id
    LEFT JOIN studio_os.product_purchase_batches b ON b.inbound_document_id=d.id
    LEFT JOIN LATERAL(SELECT * FROM studio_os.product_purchase_versions pv WHERE pv.batch_id=b.id ORDER BY pv.version DESC LIMIT 1) v ON true
    LEFT JOIN studio_os.product_purchase_lines l ON l.version_id=v.id AND l.movement_id=m.id
    LEFT JOIN studio_os.expense_records e ON e.id=v.expense_id
    LEFT JOIN LATERAL(SELECT * FROM studio_os.product_opening_cost_versions o WHERE o.item_id=m.item_id ORDER BY o.version DESC LIMIT 1) ov ON true
    LEFT JOIN studio_os.product_opening_cost_lines ol ON ol.version_id=ov.id AND ol.movement_id=m.id
    LEFT JOIN studio_os.product_stock_returns r ON r.return_movement_id=m.id
    LEFT JOIN LATERAL(SELECT * FROM studio_os.product_reference_costs ref WHERE ref.sku_id=${id}
      AND ref.effective_month<=to_char(coalesce(d.business_date,(m.created_at AT TIME ZONE 'Asia/Shanghai')::date),'YYYY-MM')
      ORDER BY ref.effective_month DESC,ref.version DESC LIMIT 1) rc ON true
    WHERE m.item_id=${sku.itemId}`;
   const dropship=await tx`SELECT l.id,d.id AS "documentId",d.code,d.business_date::text AS day,l.quantity,l.snapshot,
    c.value->>'basis' AS basis,(c.value->>'amountCents')::bigint::text AS "amountCents",v.version
    FROM studio_os.dropship_cost_lines l JOIN studio_os.dropship_cost_documents d ON d.id=l.document_id
    JOIN LATERAL(SELECT * FROM studio_os.dropship_cost_versions v WHERE v.document_id=d.id ORDER BY version DESC LIMIT 1) v ON true
    JOIN LATERAL jsonb_array_elements(v.lines) c(value) ON c.value->>'lineId'=l.id::text
    WHERE l.sku_id=${id} AND to_char(d.business_date,'YYYY-MM')=${month} ORDER BY d.business_date,d.id,l.position`;
   const refunds=await tx`SELECT r.id,d.id AS "documentId",d.code,r.business_date::text AS day,r.quantity,v.amount_cents AS "amountCents",v.version,l.snapshot,r.source_reference AS "sourceReference"
    FROM studio_os.dropship_refunds r JOIN studio_os.dropship_cost_lines l ON l.id=r.line_id JOIN studio_os.dropship_cost_documents d ON d.id=l.document_id
    JOIN LATERAL(SELECT * FROM studio_os.dropship_refund_versions v WHERE v.refund_id=r.id ORDER BY version DESC LIMIT 1) v ON true
    WHERE l.sku_id=${id} AND to_char(r.business_date,'YYYY-MM')=${month} ORDER BY r.business_date,r.id`;
   const sum=(list:any[])=>list.reduce((n,r)=>n+BigInt(r.amountCents),0n).toString();
   const actual=dropship.every(r=>r.basis==='actual');
   const dropSummary={rows:dropship,refunds,actualCents:actual?sum(dropship):null,indicativeCents:sum(dropship),refundCents:sum(refunds),
    estimatedRows:dropship.filter(r=>r.basis==='reference').length,netCents:actual?(BigInt(sum(dropship))-BigInt(sum(refunds))).toString():null,
    indicativeNetCents:(BigInt(sum(dropship))-BigInt(sum(refunds))).toString()};
   return {sku,dropship:dropSummary,reference:await referenceAt(tx,id,month),method:'moving-average',...movingCosts(rows as unknown as CostMovement[],month)};
  });
 }
}
