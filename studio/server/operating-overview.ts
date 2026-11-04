import {inventoryCostSummary} from './inventory-cost-summary';
import type {StudioDatabase} from './database';
import type {Identity} from './auth';
import {currentPermission} from './permissions';
import {objectInput} from './validation';
import {attendanceMonth} from './attendance-monthly';
import {stockCostMovements} from './product-cost-sources';
import {operatingOverview} from './operating-overview-model';
export class OperatingOverview{
 constructor(private readonly db:StudioDatabase){}
 async read(who:Identity,value:unknown){
  await currentPermission(this.db,who,'finance');const q=objectInput(value,['month']),month=attendanceMonth(q.month);
  return this.db.client.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
   const stores=await tx`SELECT id,name,active FROM studio_os.stores ORDER BY name,id`;
   const incomes=await tx`SELECT DISTINCT ON(store_id) id,store_id AS "storeId",version,amount_cents AS "amountCents",source_reference AS "sourceReference",status FROM studio_os.store_month_income_versions WHERE month=${month} ORDER BY store_id,version DESC`;
   const expenses=await tx`SELECT e.id,e.version,e.store_id AS "storeId",e.expense_scope AS "expenseScope",e.expense_use AS "expenseUse",e.amount_cents AS "amountCents",to_char(e.expense_date,'YYYY-MM') AS month,
    (EXISTS(SELECT 1 FROM studio_os.product_purchase_versions p WHERE p.expense_id=e.id AND p.version=(SELECT max(v.version) FROM studio_os.product_purchase_versions v WHERE v.batch_id=p.batch_id))
    OR EXISTS(SELECT 1 FROM studio_os.packaging_purchases p WHERE p.expense_id=e.id)
    OR EXISTS(SELECT 1 FROM studio_os.inventory_cost_evidence_versions p WHERE p.expense_id=e.id AND p.mode='basis' AND p.version=(SELECT max(v.version) FROM studio_os.inventory_cost_evidence_versions v WHERE v.movement_id=p.movement_id))
    OR EXISTS(SELECT 1 FROM studio_os.equipment_purchase_versions p WHERE p.expense_id=e.id AND p.version=(SELECT max(v.version) FROM studio_os.equipment_purchase_versions v WHERE v.equipment_id=p.equipment_id))) AS "purchaseLinked"
    FROM studio_os.expense_records e WHERE to_char(e.expense_date,'YYYY-MM')=${month} OR e.id IN(SELECT expense_id FROM studio_os.operating_finance_records WHERE expense_id IS NOT NULL) OR e.id IN(SELECT expense_id FROM studio_os.inventory_cost_evidence_versions WHERE expense_id IS NOT NULL)`;
   const operating=await tx`SELECT r.id,r.kind,r.store_id AS "storeId",r.expense_id AS "expenseId",v.amount_cents AS "amountCents",coalesce(e.version<>(v.expense_snapshot->>'version')::int,false) AS "sourceChanged"
    FROM studio_os.operating_finance_records r JOIN LATERAL(SELECT * FROM studio_os.operating_finance_versions v WHERE v.record_id=r.id ORDER BY version DESC LIMIT 1) v ON true
    LEFT JOIN studio_os.expense_records e ON e.id=r.expense_id WHERE v.status='active' AND to_char(v.business_date,'YYYY-MM')=${month}`;
   const dropship=await tx`SELECT d.id AS "documentId",l.store_id AS "storeId",c.value->>'basis' AS basis,c.value->>'amountCents' AS "amountCents"
    FROM studio_os.dropship_cost_lines l JOIN studio_os.dropship_cost_documents d ON d.id=l.document_id
    JOIN LATERAL(SELECT * FROM studio_os.dropship_cost_versions v WHERE v.document_id=d.id ORDER BY version DESC LIMIT 1) v ON true
    JOIN LATERAL jsonb_array_elements(v.lines) c(value) ON c.value->>'lineId'=l.id::text WHERE to_char(d.business_date,'YYYY-MM')=${month}`;
   const refunds=await tx`SELECT d.id AS "documentId",l.store_id AS "storeId",v.amount_cents AS "amountCents"
    FROM studio_os.dropship_refunds r JOIN studio_os.dropship_cost_lines l ON l.id=r.line_id JOIN studio_os.dropship_cost_documents d ON d.id=l.document_id
    JOIN LATERAL(SELECT * FROM studio_os.dropship_refund_versions v WHERE v.refund_id=r.id ORDER BY version DESC LIMIT 1) v ON true WHERE to_char(r.business_date,'YYYY-MM')=${month}`;
   const inventoryCosts=await inventoryCostSummary(tx,month);
   return operatingOverview({stores,incomes,expenses,fees:operating.filter(r=>r.kind==='fee'),daily:operating.filter(r=>r.kind!=='fee'),dropship,refunds,movements:await stockCostMovements(tx),packaging:[],inventoryCosts},month);
  });
 }
}
