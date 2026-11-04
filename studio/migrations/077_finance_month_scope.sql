-- Only the explicitly reviewed set of operating stores. No closing lock or money posting.
CREATE TABLE finance_month_scope_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),month text NOT NULL CHECK(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 version integer NOT NULL CHECK(version>0),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 actor_id uuid NOT NULL REFERENCES accounts(id),actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(month,version)
);
CREATE TABLE finance_month_scope_stores (
 version_id uuid NOT NULL REFERENCES finance_month_scope_versions(id),store_id uuid NOT NULL REFERENCES stores(id),
 store_name text NOT NULL,PRIMARY KEY(version_id,store_id)
);
CREATE TABLE finance_month_scope_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id),request_key uuid NOT NULL,month text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER finance_scope_versions_append_only BEFORE UPDATE OR DELETE ON finance_month_scope_versions FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER finance_scope_stores_append_only BEFORE UPDATE OR DELETE ON finance_month_scope_stores FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TRIGGER finance_scope_receipts_append_only BEFORE UPDATE OR DELETE ON finance_month_scope_receipts FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
