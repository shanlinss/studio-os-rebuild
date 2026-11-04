CREATE TABLE product_purchase_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 inbound_document_id uuid NOT NULL UNIQUE REFERENCES product_stock_documents(id) ON DELETE RESTRICT,
 code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 64)
);
CREATE UNIQUE INDEX product_purchase_batch_code ON product_purchase_batches(lower(code));
CREATE TABLE product_purchase_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES product_purchase_batches(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 purchase_date date NOT NULL CHECK(purchase_date>='0001-01-01'::date),
 supplier text NOT NULL CHECK(length(btrim(supplier)) BETWEEN 1 AND 150),
 goods_cents integer NOT NULL CHECK(goods_cents>=0),
 additional_cents integer NOT NULL CHECK(additional_cents>=0),
 total_cents integer NOT NULL CHECK(total_cents::bigint=goods_cents::bigint+additional_cents),
 expense_id uuid REFERENCES expense_records(id) ON DELETE RESTRICT,
 expense_snapshot jsonb,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,version),
 CHECK((expense_id IS NULL)=(expense_snapshot IS NULL))
);
CREATE TABLE product_purchase_lines (
 version_id uuid NOT NULL REFERENCES product_purchase_versions(id) ON DELETE RESTRICT,
 movement_id uuid NOT NULL REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 quantity integer NOT NULL CHECK(quantity>0),
 unit_cents integer NOT NULL CHECK(unit_cents>=0),
 goods_cents integer NOT NULL CHECK(goods_cents::bigint=quantity::bigint*unit_cents),
 additional_cents integer NOT NULL CHECK(additional_cents>=0),
 total_cents integer NOT NULL CHECK(total_cents::bigint=goods_cents::bigint+additional_cents),
 item_snapshot jsonb NOT NULL,
 PRIMARY KEY(version_id,movement_id)
);
CREATE TABLE product_purchase_expenses (
 expense_id uuid PRIMARY KEY REFERENCES expense_records(id) ON DELETE RESTRICT,
 batch_id uuid NOT NULL REFERENCES product_purchase_batches(id) ON DELETE RESTRICT
);
CREATE TABLE product_purchase_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 inbound_document_id uuid NOT NULL REFERENCES product_stock_documents(id),
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER product_purchase_batches_append_only BEFORE UPDATE OR DELETE ON product_purchase_batches FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_purchase_versions_append_only BEFORE UPDATE OR DELETE ON product_purchase_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_purchase_lines_append_only BEFORE UPDATE OR DELETE ON product_purchase_lines FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_purchase_expenses_append_only BEFORE UPDATE OR DELETE ON product_purchase_expenses FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_purchase_receipts_append_only BEFORE UPDATE OR DELETE ON product_purchase_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
