import {BadRequestException,NotFoundException} from '@nestjs/common';
import type {Identity} from './auth';
import type {StudioDatabase} from './database';
import {currentPermission} from './permissions';
import {objectInput,uuid} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {movingCosts,CostMovement} from './product-cost-engine';
export class ProductCosts{
 constructor(private readonly db:StudioDatabase){}
 async catalog(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['offset']),offset=Number(q.offset??0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>2147483647)throw new BadRequestException();
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const rows=await tx`SELECT k.id,k.code,w.name,w.specification,w.unit,k.active,w.quantity FROM studio_os.product_skus k
    JOIN studio_os.warehouse_items w ON w.id=k.warehouse_item_id ORDER BY k.code,k.id LIMIT 50 OFFSET ${offset}`;
   const [count]=await tx`SELECT count(*)::int AS total FROM studio_os.product_skus WHERE warehouse_item_id IS NOT NULL`;
   return {rows,total:count.total,offset,limit:50};
  });
 }
 async review(who:Identity,id:string,value:unknown){
  await currentPermission(this.db,who,'finance');id=uuid(id);const q=objectInput(value,['month']);const month=attendanceMonth(q.month);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const [sku]=await tx`SELECT k.id,k.code,w.id AS "itemId",w.name,w.specification,w.unit FROM studio_os.product_skus k
    JOIN studio_os.warehouse_items w ON w.id=k.warehouse_item_id WHERE k.id=${id}`;
   if(!sku)throw new NotFoundException();
   const rows=await tx`SELECT m.id,m.type,m.quantity,m.delta,
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
    WHERE m.item_id=${sku.itemId}`;
   return {sku,method:'moving-average',...movingCosts(rows as unknown as CostMovement[],month)};
  });
 }
}
