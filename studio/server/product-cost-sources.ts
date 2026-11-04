import type {TransactionSql} from 'postgres';
import type {CostMovement} from './product-cost-engine';
export async function stockCostMovements(tx:TransactionSql,itemId?:string){
   const rows=await tx`SELECT coalesce(k.id,m.item_id) AS "skuId",m.item_id AS "itemId",'product' AS "inventoryKind",ev.version AS "evidenceVersion",m.business_store_id AS "businessStoreId",m.id,m.type,m.quantity,m.delta,rc.unit_cents AS "referenceUnitCents",rc.id AS "referenceId",
    coalesce(d.business_date,(m.created_at AT TIME ZONE 'Asia/Shanghai')::date)::text AS day,
    to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "postedAt",m.product_stock_document_id AS "documentId",coalesce(d.operation,CASE WHEN m.type='inbound' THEN 'inbound' END) AS operation,
    CASE WHEN b.id IS NOT NULL AND coalesce(v.stock_correction_version,0)<>coalesce(d.correction_version,0) THEN NULL ELSE coalesce(l.total_cents,ol.total_cents,ev.amount_cents) END AS "totalCents",CASE WHEN ol.movement_id IS NOT NULL THEN ov.version END AS "openingVersion",r.shipment_movement_id AS "sourceShipmentId",v.version AS "purchaseVersion",m.item_snapshot AS snapshot,
    (NOT m.cost_excluded AND (coalesce(b.id IS NOT NULL AND v.stock_correction_version<>d.correction_version,false) OR coalesce(e.version<>(v.expense_snapshot->>'version')::int,false) OR coalesce(eb.version<>(ev.expense_snapshot->>'version')::int,false))) AS "sourceChanged",
    (m.type='opening' AND m.packaging_balance_id IS NOT NULL AND EXISTS(SELECT 1 FROM studio_os.warehouse_movements old
     WHERE old.item_id=m.item_id AND old.type='opening' AND old.packaging_balance_id IS NULL)) AS "duplicateOpening",
    (m.cost_excluded OR EXISTS(SELECT 1 FROM studio_os.packaging_stock_transfers t WHERE t.inbound_movement_id=m.id OR t.outbound_movement_id=m.id)) AS "internalTransfer"
    FROM studio_os.product_stock_cost_movements m LEFT JOIN studio_os.product_skus k ON k.warehouse_item_id=m.item_id LEFT JOIN studio_os.product_stock_effective_documents d ON d.id=m.product_stock_document_id
    LEFT JOIN studio_os.product_purchase_batches b ON b.inbound_document_id=d.id
    LEFT JOIN LATERAL(SELECT * FROM studio_os.product_purchase_versions pv WHERE pv.batch_id=b.id ORDER BY pv.version DESC LIMIT 1) v ON true
    LEFT JOIN studio_os.product_purchase_lines l ON l.version_id=v.id AND l.movement_id=m.id
    LEFT JOIN studio_os.expense_records e ON e.id=v.expense_id
    LEFT JOIN LATERAL(SELECT * FROM studio_os.product_opening_cost_versions o WHERE o.item_id=m.item_id ORDER BY o.version DESC LIMIT 1) ov ON true
    LEFT JOIN studio_os.product_opening_cost_lines ol ON ol.version_id=ov.id AND ol.movement_id=m.id
    LEFT JOIN studio_os.product_stock_returns r ON r.return_movement_id=m.id
    LEFT JOIN LATERAL(SELECT * FROM studio_os.product_reference_costs ref WHERE ref.sku_id=k.id
      AND ref.effective_month<=to_char(coalesce(d.business_date,(m.created_at AT TIME ZONE 'Asia/Shanghai')::date),'YYYY-MM')
      ORDER BY ref.effective_month DESC,ref.version DESC LIMIT 1) rc ON true
    JOIN studio_os.warehouse_items wi ON wi.id=m.item_id
    LEFT JOIN LATERAL(SELECT amount_cents,version,expense_id,expense_snapshot FROM studio_os.inventory_cost_evidence_versions ev WHERE ev.movement_id=m.id AND mode='basis' ORDER BY version DESC LIMIT 1) ev ON true
    LEFT JOIN studio_os.expense_records eb ON eb.id=ev.expense_id
    WHERE wi.kind='product' AND (${itemId??null}::uuid IS NULL OR m.item_id=${itemId??null})`;
 return rows as unknown as (CostMovement&{skuId:string,businessStoreId:string|null})[];
}
