-- Valuation evidence only; original opening quantities and stock movements remain authoritative.
CREATE TABLE product_opening_cost_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>0),
 total_cents integer NOT NULL CHECK(total_cents>=0),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(item_id,version)
);
CREATE TABLE product_opening_cost_lines (
 version_id uuid NOT NULL REFERENCES product_opening_cost_versions(id) ON DELETE RESTRICT,
 movement_id uuid NOT NULL REFERENCES warehouse_movements(id) ON DELETE RESTRICT,
 quantity integer NOT NULL CHECK(quantity>0),
 total_cents integer NOT NULL CHECK(total_cents>=0),
 item_snapshot jsonb NOT NULL,
 PRIMARY KEY(version_id,movement_id)
);
CREATE TABLE product_opening_cost_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),
 request_key uuid NOT NULL,
 sku_id uuid NOT NULL REFERENCES product_skus(id),
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER product_opening_cost_versions_append_only BEFORE UPDATE OR DELETE ON product_opening_cost_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_opening_cost_lines_append_only BEFORE UPDATE OR DELETE ON product_opening_cost_lines FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_opening_cost_receipts_append_only BEFORE UPDATE OR DELETE ON product_opening_cost_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
