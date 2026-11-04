CREATE TABLE product_stock_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation text NOT NULL CHECK(operation IN('inbound','shipment')),
 business_date date NOT NULL CHECK(business_date>='0001-01-01'::date),
 source_reference text NOT NULL DEFAULT '' CHECK(length(source_reference)<=200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE warehouse_movements
 ADD COLUMN product_stock_document_id uuid REFERENCES product_stock_documents(id) ON DELETE RESTRICT,
 ADD COLUMN business_store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 ADD CHECK ((product_stock_document_id IS NULL AND business_store_id IS NULL)
  OR (product_stock_document_id IS NOT NULL AND packaging_balance_id IS NOT NULL
   AND (type='inbound' OR (type='outbound' AND business_store_id IS NOT NULL))));
CREATE UNIQUE INDEX product_stock_document_balance ON warehouse_movements(product_stock_document_id,packaging_balance_id)
 WHERE product_stock_document_id IS NOT NULL;
CREATE TRIGGER product_stock_documents_append_only BEFORE UPDATE OR DELETE ON product_stock_documents
 FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
