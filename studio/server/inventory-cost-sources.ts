import type {TransactionSql} from 'postgres';
import {stockCostMovements} from './product-cost-sources';
import {movingCosts,costAmount,fraction,type CostMovement} from './product-cost-engine';
export function roundedCost(exact:{n:string,d:string}|null):string|null{if(!exact)return null;const a=costAmount(fraction(BigInt(exact.n),BigInt(exact.d)))!,negative=a.startsWith('-'),[whole,part]=a.replace('-','').split('.');return String((BigInt(whole)*100n+BigInt(part))*(negative?-1n:1n));}
export async function inventoryCostSources(tx:TransactionSql,itemId?:string){
 const products=await stockCostMovements(tx,itemId);
 const packaging=await tx`SELECT m.item_id AS "skuId",m.item_id AS "itemId",'packaging' AS "inventoryKind",m.id,m.type,m.quantity,m.delta,
  (m.created_at AT TIME ZONE 'Asia/Shanghai')::date::text AS day,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "postedAt",
  NULL::uuid AS "documentId",CASE WHEN m.type='inbound' THEN 'inbound' ELSE NULL END AS operation,
  coalesce(ev.amount_cents,CASE WHEN p.id IS NOT NULL THEN m.quantity::bigint*p.unit_cents END)::int AS "totalCents",NULL::uuid AS "sourceShipmentId",NULL::int AS "purchaseVersion",
  ev.version AS "evidenceVersion",p.id AS "packagingPurchaseId",p.purchase_date::text AS "purchaseDate",p.unit_cents AS "purchaseUnitCents",p.expense_id AS "purchaseExpenseId",e.version AS "purchaseSourceVersion",
  (CASE WHEN ev.version IS NOT NULL THEN e.version IS DISTINCT FROM (ev.movement_snapshot->>'purchaseSourceVersion')::int ELSE coalesce(e.version<>(p.expense_snapshot->>'version')::int,false) END OR coalesce(eb.version<>(ev.expense_snapshot->>'version')::int,false)) AS "sourceChanged",m.item_snapshot AS snapshot,
  (m.type='opening' AND m.packaging_balance_id IS NOT NULL AND EXISTS(SELECT 1 FROM studio_os.warehouse_movements old WHERE old.item_id=m.item_id AND old.type='opening' AND old.packaging_balance_id IS NULL)) AS "duplicateOpening",
  EXISTS(SELECT 1 FROM studio_os.packaging_stock_transfers t WHERE t.outbound_movement_id=m.id OR t.inbound_movement_id=m.id) AS "internalTransfer"
  FROM studio_os.warehouse_movements m JOIN studio_os.warehouse_items w ON w.id=m.item_id
  LEFT JOIN studio_os.packaging_purchase_allocations a ON a.movement_id=m.id LEFT JOIN studio_os.packaging_purchases p ON p.id=a.purchase_id
  LEFT JOIN studio_os.expense_records e ON e.id=p.expense_id
  LEFT JOIN LATERAL(SELECT amount_cents,version,expense_id,expense_snapshot,movement_snapshot FROM studio_os.inventory_cost_evidence_versions ev WHERE ev.movement_id=m.id AND mode='basis' ORDER BY version DESC LIMIT 1) ev ON true
  LEFT JOIN studio_os.expense_records eb ON eb.id=ev.expense_id
  WHERE w.kind='packaging' AND (${itemId??null}::uuid IS NULL OR w.id=${itemId??null})`;
 const facts=await tx`SELECT m.id,m.item_id AS "itemId",w.kind,m.type,m.quantity,m.delta,m.item_snapshot AS snapshot,m.packaging_consumption_id AS "consumptionId",m.used_store_id AS "usedStoreId",k.id AS "actualSkuId",m.product_stock_document_id AS "productDocumentId",
  d.operation AS "documentOperation",EXISTS(SELECT 1 FROM studio_os.warehouse_sample_transfers t WHERE t.movement_id=m.id) AS "sampleTransfer",
  ev.id AS "evidenceId",ev.version AS "attributionVersion",ev.scope,ev.store_id AS "costStoreId",ev.expense_id AS "expenseId",ev.expense_snapshot AS "expenseSnapshot",
  EXISTS(SELECT 1 FROM studio_os.operating_finance_records f JOIN LATERAL(SELECT status FROM studio_os.operating_finance_versions fv WHERE fv.record_id=f.id ORDER BY version DESC LIMIT 1) fv ON true WHERE f.expense_id=ev.expense_id AND fv.status='active') AS "expenseLinkedElsewhere",e.version AS "currentExpenseVersion",e.amount_cents AS "currentExpenseCents",e.expense_scope AS "currentExpenseScope",e.expense_use AS "currentExpenseUse",e.store_id AS "currentExpenseStoreId",to_char(e.expense_date,'YYYY-MM') AS "expenseMonth"
  FROM studio_os.warehouse_movements m JOIN studio_os.warehouse_items w ON w.id=m.item_id LEFT JOIN studio_os.product_skus k ON k.warehouse_item_id=w.id
  LEFT JOIN studio_os.product_stock_documents d ON d.id=m.product_stock_document_id
  LEFT JOIN LATERAL(SELECT * FROM studio_os.inventory_cost_evidence_versions v WHERE v.movement_id=m.id ORDER BY version DESC LIMIT 1) ev ON true
  LEFT JOIN studio_os.expense_records e ON e.id=ev.expense_id WHERE (${itemId??null}::uuid IS NULL OR w.id=${itemId??null})`;
 const byId=new Map(facts.map(f=>[f.id,f]));
 const rows=[...products,...packaging].map(row=>({...row,...byId.get(row.id)})) as any[];
 for(const row of rows){row.mode=row.internalTransfer||row.duplicateOpening||row.delta===0?'excluded':row.delta<0?row.consumptionId?'automatic':row.documentOperation==='shipment'?'external':row.sampleTransfer?'asset':'outflow':row.kind==='product'&&(row.type==='opening'||row.productDocumentId)?'external':'basis';}
 return rows;
}
export function priceInventorySources(rows:any[],month:string){
 const grouped=new Map<string,any[]>();for(const row of rows){if(!grouped.has(row.itemId))grouped.set(row.itemId,[]);grouped.get(row.itemId)!.push(row);}
 const byId=new Map<string,any>();
 for(const group of grouped.values())for(const priced of movingCosts(group as CostMovement[],month).rows)byId.set(priced.id,priced);
 return rows.filter(r=>r.day.startsWith(month)).map(r=>({...r,priced:byId.get(r.id)??null}));
}
