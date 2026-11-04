-- Correct business facts and current quantity through explicit, immutable adjustments.
CREATE TABLE product_stock_correction_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES product_stock_documents(id),
 version integer NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN('active','void')),
 business_date date NOT NULL,source_reference text NOT NULL CHECK(length(source_reference)<=200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 100),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(document_id,version)
);
CREATE TABLE product_stock_correction_adjustments (
 movement_id uuid PRIMARY KEY REFERENCES warehouse_movements(id),version_id uuid NOT NULL REFERENCES product_stock_correction_versions(id),
 source_movement_id uuid NOT NULL REFERENCES warehouse_movements(id),UNIQUE(version_id,source_movement_id)
);
CREATE TABLE product_stock_correction_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,document_id uuid NOT NULL REFERENCES product_stock_documents(id),
 operation text NOT NULL CHECK(operation IN('correct','void')),request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER product_stock_corrections_append_only BEFORE UPDATE OR DELETE ON product_stock_correction_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_stock_adjustments_append_only BEFORE UPDATE OR DELETE ON product_stock_correction_adjustments FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_stock_correction_receipts_append_only BEFORE UPDATE OR DELETE ON product_stock_correction_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE VIEW product_stock_effective_documents AS
 SELECT d.id,d.operation,coalesce(c.business_date,d.business_date) AS business_date,coalesce(c.source_reference,d.source_reference) AS source_reference,
 d.reason,d.actor_id,d.created_at,d.source_shipment_id,d.resellable_confirmed,coalesce(c.status,'active') AS status,coalesce(c.version,0) AS correction_version
 FROM product_stock_documents d LEFT JOIN LATERAL(SELECT * FROM product_stock_correction_versions c WHERE c.document_id=d.id ORDER BY version DESC LIMIT 1) c ON true;
CREATE VIEW product_stock_cost_movements AS
 SELECT effective.*,(coalesce(c.status='void',false) OR EXISTS(SELECT 1 FROM product_stock_correction_adjustments a WHERE a.movement_id=m.id)) AS cost_excluded
 FROM warehouse_movements m LEFT JOIN product_stock_documents d ON d.id=m.product_stock_document_id
 LEFT JOIN LATERAL(SELECT * FROM product_stock_correction_versions c WHERE c.document_id=d.id ORDER BY version DESC LIMIT 1) c ON true
 LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(c.lines) f(value) WHERE value->>'id'=m.id::text) f ON true
 LEFT JOIN product_stock_returns r ON r.return_movement_id=m.id
 LEFT JOIN warehouse_movements parent ON parent.id=r.shipment_movement_id
 LEFT JOIN LATERAL(SELECT * FROM product_stock_correction_versions pc WHERE pc.document_id=parent.product_stock_document_id ORDER BY version DESC LIMIT 1) pc ON true
 LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(pc.lines) pf(value) WHERE value->>'id'=parent.id::text) pf ON true
 CROSS JOIN LATERAL jsonb_populate_record(NULL::warehouse_movements,to_jsonb(m)||
  CASE WHEN f.value IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('quantity',(f.value->>'quantity')::int,'delta',(f.value->>'quantity')::int*CASE WHEN d.operation='shipment' THEN -1 ELSE 1 END,
   'business_store_id',f.value->'businessStoreId','item_snapshot',f.value->'snapshot') END||
  CASE WHEN d.operation<>'return' OR d.operation IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('business_store_id',coalesce(pf.value->'businessStoreId',to_jsonb(parent.business_store_id)),
   'item_snapshot',coalesce(f.value->'snapshot',m.item_snapshot)||jsonb_build_object('businessStoreId',coalesce(pf.value->'businessStoreId',to_jsonb(parent.business_store_id)),
    'businessStoreName',coalesce(pf.value->'snapshot'->'businessStoreName',parent.item_snapshot->'businessStoreName'))) END) effective;
ALTER TABLE product_purchase_versions ADD COLUMN stock_correction_version integer NOT NULL DEFAULT 0 CHECK(stock_correction_version>=0);
