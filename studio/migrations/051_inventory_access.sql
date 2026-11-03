-- Scope configuration only. Original item balances and movement facts are untouched.
CREATE TABLE inventory_access_grants (
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 store_id uuid REFERENCES stores(id) ON DELETE RESTRICT,
 scope_key text GENERATED ALWAYS AS (coalesce(store_id::text,'public')) STORED,
 can_move boolean NOT NULL DEFAULT false,
 PRIMARY KEY(account_id,scope_key)
);
CREATE TABLE inventory_access_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 actor_name text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 before_value jsonb NOT NULL,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_access_events_account ON inventory_access_events(account_id,created_at DESC,id);
CREATE TRIGGER inventory_access_events_append_only BEFORE UPDATE OR DELETE ON inventory_access_events
FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
CREATE TABLE inventory_access_receipts (
 actor_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 request_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER inventory_access_receipts_append_only BEFORE UPDATE OR DELETE ON inventory_access_receipts
FOR EACH ROW EXECUTE FUNCTION warehouse_keep_movement_history();
