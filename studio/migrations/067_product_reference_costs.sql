CREATE TABLE product_reference_costs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sku_id uuid NOT NULL REFERENCES product_skus(id),
 version integer NOT NULL CHECK(version>0),
 effective_month text NOT NULL CHECK(effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 unit_cents integer CHECK(unit_cents>=0),
 fulfillment_mode text NOT NULL CHECK(fulfillment_mode IN('stocked','dropship')),
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(sku_id,version)
);
CREATE INDEX product_reference_effective ON product_reference_costs(sku_id,effective_month DESC,version DESC);
CREATE TABLE product_reference_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,sku_id uuid NOT NULL REFERENCES product_skus(id),
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER product_reference_costs_append_only BEFORE UPDATE OR DELETE ON product_reference_costs FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER product_reference_receipts_append_only BEFORE UPDATE OR DELETE ON product_reference_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
