CREATE TABLE store_month_income_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES stores(id),
 month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),version integer NOT NULL CHECK(version>0),
 amount_cents integer NOT NULL,source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 1 AND 200),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),status text NOT NULL CHECK(status IN('confirmed','withdrawn')),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(store_id,month,version)
);
CREATE TABLE store_month_income_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,store_id uuid NOT NULL REFERENCES stores(id),month text NOT NULL,
 request_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER store_month_income_versions_append_only BEFORE UPDATE OR DELETE ON store_month_income_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER store_month_income_receipts_append_only BEFORE UPDATE OR DELETE ON store_month_income_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
